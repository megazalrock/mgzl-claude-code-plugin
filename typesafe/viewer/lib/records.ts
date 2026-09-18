/**
 * ログ 1 行（hooks/lib/log.ts の LogRecord を JSON 化したもの）をブラウザ向けの軽量な形に変換する。
 * 元レコードの型は import せず unknown を型ガードで掘る。ログは過去の版のフックが書いた行も
 * 混ざりうるため、型に合わない行でも落とさず null で捨てたい。
 */

export type RankingItem = { name: string; probability: number };

export type ViewRecord = {
  ts: string;
  session_id: string;
  cwd: string;
  /** "UserPromptSubmit" | "PreToolUse:Bash" | "PreToolUse:Agent" など。tool_name を event に畳み込んだ表示用の値 */
  event: string;
  agent_type?: string;
  prompt: string;
  outcome: string;
  winner: string | null;
  noneProbability: number | null;
  elapsedMs: number;
  rosterSize: number;
  error?: string;
  /** 確率が 0 より大きい候補だけを降順に並べたもの。none も含む。API を呼んでいなければ空 */
  ranking: RankingItem[];
  confidence?: number;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** calls[0].response.body を辞書として取り出す。無ければ undefined */
function firstResponseBody(calls: unknown): Dict | undefined {
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const first: unknown = calls[0];
  if (!isDict(first) || !isDict(first["response"])) return undefined;
  const body = first["response"]["body"];
  return isDict(body) ? body : undefined;
}

function whichAnswer(body: Dict | undefined): Dict | undefined {
  if (body === undefined || !isDict(body["answers"])) return undefined;
  const which = body["answers"]["which"];
  return isDict(which) ? which : undefined;
}

function toRanking(which: Dict | undefined): RankingItem[] {
  if (which === undefined || !isDict(which["probabilities"])) return [];
  const items: RankingItem[] = [];
  for (const [name, probability] of Object.entries(which["probabilities"])) {
    if (typeof probability === "number" && probability > 0) items.push({ name, probability });
  }
  return items.sort((left, right) =>
    right.probability !== left.probability
      ? right.probability - left.probability
      : left.name.localeCompare(right.name),
  );
}

function toUsage(body: Dict | undefined): ViewRecord["usage"] {
  if (body === undefined || !isDict(body["usage"])) return undefined;
  const input = body["usage"]["input_tokens"];
  const output = body["usage"]["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input_tokens: input, output_tokens: output };
}

function toEvent(raw: Dict): string {
  const event = str(raw["event"], "UserPromptSubmit");
  const tool = optStr(raw["tool_name"]);
  return event === "PreToolUse" && tool !== undefined ? `${event}:${tool}` : event;
}

export function toViewRecord(line: string): ViewRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDict(parsed) || typeof parsed["ts"] !== "string") return null;

  const body = firstResponseBody(parsed["calls"]);
  const which = whichAnswer(body);
  const view: ViewRecord = {
    ts: parsed["ts"],
    session_id: str(parsed["session_id"]),
    cwd: str(parsed["cwd"]),
    event: toEvent(parsed),
    prompt: str(parsed["prompt"]),
    outcome: str(parsed["outcome"]),
    winner: optStr(parsed["winner"]) ?? null,
    noneProbability: optNum(parsed["noneProbability"]) ?? null,
    elapsedMs: num(parsed["elapsedMs"]),
    rosterSize: num(parsed["rosterSize"]),
    ranking: toRanking(which),
  };
  const agentType = optStr(parsed["agent_type"]);
  if (agentType !== undefined) view.agent_type = agentType;
  const error = optStr(parsed["error"]);
  if (error !== undefined) view.error = error;
  const confidence = optNum(which?.["confidence"]);
  if (confidence !== undefined) view.confidence = confidence;
  const model = optStr(body?.["model"]);
  if (model !== undefined) view.model = model;
  const usage = toUsage(body);
  if (usage !== undefined) view.usage = usage;
  return view;
}
