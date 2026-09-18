import { append } from "./lib/log.ts";
import { type SuggestResult, suggest } from "./lib/pipeline.ts";
import { discover } from "./lib/roster.ts";

const SUGGESTED_PREFIX = "Relevant to the current request: ";
const SUGGESTED_SUFFIX =
  ". Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.";
const NO_SUGGESTION =
  "No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.";

type Payload = { prompt: string; cwd: string; sessionId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function parsePayload(raw: string): Payload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const cwd = readString(parsed, "cwd");
  return {
    prompt: readString(parsed, "prompt"),
    cwd: cwd === "" ? process.cwd() : cwd,
    sessionId: readString(parsed, "session_id"),
  };
}

function additionalContext(result: SuggestResult): string | undefined {
  if (result.outcome === "suggested") {
    if (result.winner === null) {
      // pipeline.ts の型上は string | null だが、"suggested" は常に choice の結果を積む契約
      throw new Error("suggest returned outcome 'suggested' without a winner");
    }
    return `<skill_relevance>${SUGGESTED_PREFIX}${result.winner}${SUGGESTED_SUFFIX}</skill_relevance>`;
  }
  if (result.outcome === "gate_quiet" || result.outcome === "no_fit") {
    return `<skill_relevance>${NO_SUGGESTION}</skill_relevance>`;
  }
  return undefined;
}

function emit(context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
}

function logSkipped(payload: Payload | undefined, rosterSize: number): void {
  append({
    session_id: payload?.sessionId ?? "",
    cwd: payload?.cwd ?? "",
    prompt: payload?.prompt ?? "",
    outcome: "skipped",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize,
  });
}

async function main(): Promise<void> {
  const payload = parsePayload(await Bun.stdin.text());
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  if (payload === undefined) {
    // stdin が壊れていて payload が組み立てられない場合も、記録だけは残す
    append({
      session_id: "",
      cwd: "",
      prompt: "",
      outcome: "error",
      winner: null,
      gate: null,
      shortlist: [],
      elapsedMs: 0,
      rosterSize: 0,
      error: "malformed stdin payload",
    });
    return;
  }
  // 明示的なスキル呼び出し（/ 始まり）には提案が不要で、キー未設定なら機能そのものが無効
  if (payload.prompt === "" || payload.prompt.startsWith("/") || apiKey === "") {
    logSkipped(payload, 0);
    return;
  }

  const roster = discover(payload.cwd);
  if (roster.length === 0) {
    logSkipped(payload, 0);
    return;
  }

  const result = await suggest(payload.prompt, roster, { apiKey });
  const context = additionalContext(result);
  if (context !== undefined) emit(context);

  append({
    session_id: payload.sessionId,
    cwd: payload.cwd,
    prompt: payload.prompt,
    outcome: result.outcome,
    winner: result.winner,
    gate: result.gate,
    shortlist: result.shortlist,
    rerankConfidence: result.rerankConfidence,
    elapsedMs: result.elapsedMs,
    rosterSize: roster.length,
  });
}

try {
  await main();
} catch (e) {
  // 提案の失敗でユーザーのターンを止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`typesafe suggest-skill: ${message}\n`);
  append({
    session_id: "",
    cwd: process.cwd(),
    prompt: "",
    outcome: "error",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize: 0,
    error: message,
  });
}
process.exit(0);
