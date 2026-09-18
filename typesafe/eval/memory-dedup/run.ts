import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemory } from "../../../fading-memory/hooks/lib/frontmatter.ts";
import { askSystemOne, type Question } from "../../hooks/lib/jev.ts";

/** 「既存のどれでもない」を表す criteria のキー。slug と同じ名前空間に置く */
export const NONE_KEY = "none";
/** 関連記憶の提示用途を測るために残す上位候補の件数 */
export const SHORTLIST = 3;

/** criteria が数十件になるため、既定の 3 秒では応答が返りきらない */
const TIMEOUT_MS = 15000;

const DEFAULT_MEMORIES_DIR =
  "/Users/otto/.claude/fading-memory/-Users-otto-workspace-mgzl-claude-code-plugin/memories";

export type Kind = "paraphrase" | "novel" | "sibling" | "ambiguous" | "boundary";
const KINDS: readonly Kind[] = ["paraphrase", "novel", "sibling", "ambiguous", "boundary"];

export type GoldenCase = {
  /** 新しく保存しようとしている記憶の title 文 */
  candidate: string;
  expected: string | null;
  /** expected 以外にも妥当と言える slug。省略時は expected 1 件だけが妥当とみなされる */
  acceptable?: readonly string[];
  kind: Kind;
};

export type MemoryEntry = { slug: string; title: string };

export type EvalRow = {
  candidate: string;
  expected: string | null;
  acceptable?: readonly string[];
  kind: Kind;
  choice: string | null;
  noneProbability: number;
  /** none を除いた確率上位 SHORTLIST 件の slug */
  top3: string[];
  /** Jev が返す選択の迷いの指標。閾値運用に使えるか見るために記録する */
  confidence: number;
  /** none を除いた確率の 1 位と 2 位。差が小さければ Claude 側での二次判定が要る */
  top1Probability: number;
  top2Probability: number;
  elapsedMs: number;
  /** API 呼び出しが失敗したケースのメッセージ。成功時は undefined */
  error?: string;
};

export type Args = { memories: string; golden: string; concurrency: number; details: boolean };

const INSTRUCTIONS =
  "A new memory is about to be saved. Its title is in the state. Which of the existing memories, if any, covers the same concern — that is, the new memory would duplicate it or should update it instead of being saved separately? Choose none if the new memory is about a topic none of them covers.";

const NONE_DESCRIPTION =
  "既存のどの記憶とも同じ関心ではない。新しい話題なので別の記憶として保存してよい。";

export function parseArgs(argv: readonly string[]): Args {
  let memories = DEFAULT_MEMORIES_DIR;
  let golden = join(import.meta.dir, "golden.json");
  let concurrency = 3;
  let details = false;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === "--details") {
      details = true;
      // 値を取らないフラグなので次の要素を消費しない
      i -= 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (flag === "--memories") memories = value;
    if (flag === "--golden") golden = value;
    if (flag === "--concurrency") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--concurrency must be a number, got '${value}'`);
      }
      concurrency = parsed;
    }
  }
  return { memories, golden, concurrency, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readKind(value: unknown): Kind | undefined {
  return KINDS.find((kind) => kind === value);
}

export function readGolden(parsed: unknown): GoldenCase[] {
  if (!Array.isArray(parsed)) throw new Error("golden must be an array");
  return parsed.map((item, index) => {
    const malformed = new Error(`golden.json entry ${index} is malformed`);
    if (!isRecord(item)) throw malformed;
    const candidate = item["candidate"];
    if (typeof candidate !== "string") throw malformed;
    const expected = item["expected"];
    if (typeof expected !== "string" && expected !== null) throw malformed;
    const kind = readKind(item["kind"]);
    if (kind === undefined) throw malformed;
    const acceptable = item["acceptable"];
    if (acceptable === undefined) return { candidate, expected, kind };
    if (!Array.isArray(acceptable)) throw malformed;
    const slugs: string[] = [];
    for (const slug of acceptable) {
      if (typeof slug !== "string") throw malformed;
      slugs.push(slug);
    }
    return { candidate, expected, acceptable: slugs, kind };
  });
}

/** 記憶ディレクトリから slug と title を読み出す。解析できないファイルは黙って飛ばす */
export function loadEntries(dir: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const doc = parseMemory(readFileSync(join(dir, name), "utf8"));
    if (doc === null) continue;
    entries.push({ slug: name.slice(0, -3), title: doc.meta.title });
  }
  return entries;
}

export function buildQuestion(entries: readonly MemoryEntry[]): Question {
  const criteria: Record<string, string> = {};
  for (const entry of entries) criteria[entry.slug] = entry.title;
  criteria[NONE_KEY] = NONE_DESCRIPTION;
  return { type: "choice", instructions: INSTRUCTIONS, criteria };
}

function rate(hits: number, total: number): string {
  return total === 0 ? "0.000" : (hits / total).toFixed(3);
}

/** expected が null のケースは none を選べたときだけ正解とする */
function isTop1Correct(row: EvalRow): boolean {
  if (row.error !== undefined) return false;
  if (row.expected === null) return row.choice === NONE_KEY;
  return row.choice === row.expected;
}

function isTop3Hit(row: EvalRow): boolean {
  return row.expected !== null && row.top3.includes(row.expected);
}

/** acceptable を持つケースで、選ばれた slug が妥当な兄弟のいずれかに入ったか */
function isAcceptableHit(row: EvalRow): boolean {
  const acceptable = row.acceptable;
  if (acceptable === undefined || row.choice === null) return false;
  return acceptable.includes(row.choice);
}

function mean(values: readonly number[]): string {
  if (values.length === 0) return "0.000";
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3);
}

/** 件数と 2 つの正解率、none 確率の平均をまとめた key=value 断片 */
function counts(rows: readonly EvalRow[]): string {
  const answered = rows.filter((row) => row.error === undefined);
  // top3 は「関連記憶を提示できたか」の指標なので、正解 slug が存在するケースだけを分母にする
  const withExpected = answered.filter((row) => row.expected !== null);
  // acceptable_hit は「妥当な兄弟の集合」を持つケースだけで意味を持つので分母を分ける
  const withAcceptable = answered.filter((row) => row.acceptable !== undefined);
  const noneProbabilities = answered.map((row) => row.noneProbability);
  const top1Probabilities = answered.map((row) => row.top1Probability);
  return [
    `total=${rows.length}`,
    `errors=${rows.length - answered.length}`,
    `top1_accuracy=${rate(answered.filter(isTop1Correct).length, answered.length)}`,
    `top3_hit=${rate(withExpected.filter(isTop3Hit).length, withExpected.length)}`,
    `top3_total=${withExpected.length}`,
    `acceptable_hit=${rate(withAcceptable.filter(isAcceptableHit).length, withAcceptable.length)}`,
    `acceptable_total=${withAcceptable.length}`,
    `none_p=${mean(noneProbabilities)}`,
    `none_p_min=${min(noneProbabilities)}`,
    `none_p_max=${max(noneProbabilities)}`,
    `top1_p_min=${min(top1Probabilities)}`,
    `top1_p_max=${max(top1Probabilities)}`,
    `confidence_min=${min(answered.map((row) => row.confidence))}`,
    `confidence_mean=${mean(answered.map((row) => row.confidence))}`,
    `confidence_max=${max(answered.map((row) => row.confidence))}`,
  ].join(" ");
}

function min(values: readonly number[]): string {
  return values.length === 0 ? "0.000" : Math.min(...values).toFixed(3);
}

function max(values: readonly number[]): string {
  return values.length === 0 ? "0.000" : Math.max(...values).toFixed(3);
}

function detailLine(row: EvalRow): string {
  const acceptableSuffix =
    row.acceptable === undefined ? "" : ` acceptable_hit=${isAcceptableHit(row) ? "1" : "0"}`;
  return `detail kind=${row.kind} expected=${row.expected ?? "null"} choice=${row.choice ?? "null"} confidence=${row.confidence.toFixed(3)} none_p=${row.noneProbability.toFixed(3)} top1_p=${row.top1Probability.toFixed(3)} top2_p=${row.top2Probability.toFixed(3)}${acceptableSuffix} top3=[${row.top3.join(",")}]`;
}

export function buildReport(rows: readonly EvalRow[], details = false): string {
  const lines: string[] = [`overall ${counts(rows)}`];

  for (const kind of KINDS) {
    const inKind = rows.filter((row) => row.kind === kind);
    if (inKind.length === 0) continue;
    lines.push(`kind=${kind} ${counts(inKind)}`);
  }

  const answered = rows.filter((row) => row.error === undefined);
  lines.push(`avg_elapsed_ms=${mean(answered.map((row) => row.elapsedMs))}`);

  for (const row of rows) {
    if (isTop1Correct(row)) continue;
    const errorSuffix = row.error === undefined ? "" : ` error="${row.error}"`;
    const acceptableSuffix =
      row.acceptable === undefined ? "" : ` acceptable_hit=${isAcceptableHit(row) ? "1" : "0"}`;
    lines.push(
      `mismatch kind=${row.kind} candidate="${row.candidate}" expected=${row.expected ?? "null"} choice=${row.choice ?? "null"} none_p=${row.noneProbability.toFixed(3)}${acceptableSuffix} top3=[${row.top3.join(",")}]${errorSuffix}`,
    );
  }

  if (details) {
    for (const row of rows) {
      if (row.error === undefined) lines.push(detailLine(row));
    }
  }

  return lines.join("\n");
}

async function evaluate(
  item: GoldenCase,
  entries: readonly MemoryEntry[],
  apiKey: string,
): Promise<EvalRow> {
  const startedAt = Date.now();
  const base = {
    candidate: item.candidate,
    expected: item.expected,
    acceptable: item.acceptable,
    kind: item.kind,
  };
  try {
    const response = await askSystemOne(
      { candidate_title: item.candidate },
      { duplicate: buildQuestion(entries) },
      { apiKey, timeoutMs: TIMEOUT_MS },
    );
    const answer = response.answers["duplicate"];
    if (answer === undefined || answer.type !== "choice") {
      throw new Error("Jev did not answer the 'duplicate' choice question");
    }
    const ranked = Object.entries(answer.probabilities)
      .filter(([slug]) => slug !== NONE_KEY)
      .sort(([, left], [, right]) => right - left);
    const top3 = ranked.slice(0, SHORTLIST).map(([slug]) => slug);
    return {
      ...base,
      choice: answer.choice,
      noneProbability: answer.probabilities[NONE_KEY] ?? 0,
      top3,
      confidence: answer.confidence,
      top1Probability: ranked[0]?.[1] ?? 0,
      top2Probability: ranked[1]?.[1] ?? 0,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    // 1 件の失敗で残りの評価を落とさない
    return {
      ...base,
      choice: null,
      noneProbability: 0,
      top3: [],
      confidence: 0,
      top1Probability: 0,
      top2Probability: 0,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 上限 concurrency の単純なワーカープールで評価する */
async function runAll(cases: readonly GoldenCase[], args: Args): Promise<EvalRow[]> {
  const apiKey = process.env["TYPESAFE_API_KEY"];
  if (apiKey === undefined || apiKey === "") throw new Error("TYPESAFE_API_KEY is required");
  const entries = loadEntries(args.memories);
  if (entries.length === 0) throw new Error(`no memories found in ${args.memories}`);

  const rows: EvalRow[] = new Array(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = cases[index];
      if (item === undefined) return;
      rows[index] = await evaluate(item, entries, apiKey);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, () => worker()));
  return rows;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const cases = readGolden(JSON.parse(await Bun.file(args.golden).text()));
  const rows = await runAll(cases, args);
  console.log(buildReport(rows, args.details));
  console.log(`criteria_count=${loadEntries(args.memories).length + 1}`);
}
