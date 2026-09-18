import { join } from "node:path";
import { suggest } from "../hooks/lib/pipeline.ts";
import { discover } from "../hooks/lib/roster.ts";

export type GoldenCase = { request: string; expected: string | null };

export type EvalRow = {
  request: string;
  expected: string | null;
  winner: string | null;
  /** gate 3 問の平均 */
  gateMean: number;
  /** ショートリスト内の fits の最大値。提案なしのときは 0 */
  maxFits: number;
  /** suggest が例外を投げたケースのメッセージ。正常終了時は undefined */
  error?: string;
};

export type Args = { cwd: string; golden: string; concurrency: number };

const BAND_COUNT = 10;
const REQUEST_HEAD = 60;

export function parseArgs(argv: readonly string[]): Args {
  let cwd: string | undefined;
  let golden = join(import.meta.dir, "golden.json");
  let concurrency = 4;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (flag === "--cwd") cwd = value;
    if (flag === "--golden") golden = value;
    if (flag === "--concurrency") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) throw new Error(`--concurrency must be a number, got '${value}'`);
      concurrency = parsed;
    }
  }
  if (cwd === undefined) throw new Error("--cwd is required");
  return { cwd, golden, concurrency };
}

/** error があるケースは winner が null でも「たまたま expected: null と一致した」扱いにしない */
function isCorrect(row: EvalRow): boolean {
  return row.error === undefined && row.winner === row.expected;
}

function bandIndex(fits: number): number {
  return Math.min(Math.floor(fits * BAND_COUNT), BAND_COUNT - 1);
}

function bandLabel(index: number): string {
  return `${(index / BAND_COUNT).toFixed(1)}-${((index + 1) / BAND_COUNT).toFixed(1)}`;
}

function rate(hits: number, total: number): string {
  return total === 0 ? "0.000" : (hits / total).toFixed(3);
}

/** 集計結果を key=value の簡素形式で組み立てる */
export function buildReport(rows: readonly EvalRow[]): string {
  const withSkill = rows.filter((row) => row.expected !== null);
  const withoutSkill = rows.filter((row) => row.expected === null);
  const errored = rows.filter((row) => row.error !== undefined);
  // 例外になった行は「合っていた/間違っていた」を判定できないため、両方の率の分母・分子から除外する
  const withSkillNoError = withSkill.filter((row) => row.error === undefined);
  const withoutSkillNoError = withoutSkill.filter((row) => row.error === undefined);
  const wrong = withSkillNoError.filter((row) => row.winner !== row.expected);
  const unneeded = withoutSkillNoError.filter((row) => row.winner !== null);

  const lines: string[] = [
    `total=${rows.length}`,
    `with_skill=${withSkill.length}`,
    `without_skill=${withoutSkill.length}`,
    `errors=${errored.length}`,
    `wrong_suggestion_rate=${rate(wrong.length, withSkillNoError.length)}`,
    `unneeded_suggestion_rate=${rate(unneeded.length, withoutSkillNoError.length)}`,
  ];

  // error があった行は fits を持たないため帯の分母から除外する
  const suggested = rows.filter((row) => row.winner !== null && row.error === undefined);
  for (let index = 0; index < BAND_COUNT; index++) {
    const inBand = suggested.filter((row) => bandIndex(row.maxFits) === index);
    if (inBand.length === 0) continue;
    const correct = inBand.filter(isCorrect);
    lines.push(
      `band=${bandLabel(index)} count=${inBand.length} accuracy=${rate(correct.length, inBand.length)}`,
    );
  }

  for (const row of rows) {
    if (isCorrect(row)) continue;
    const errorSuffix = row.error === undefined ? "" : ` error="${row.error}"`;
    lines.push(
      `mismatch request="${row.request.slice(0, REQUEST_HEAD)}" expected=${row.expected ?? "null"} winner=${row.winner ?? "null"} gate=${row.gateMean.toFixed(2)} fits=${row.maxFits.toFixed(2)}${errorSuffix}`,
    );
  }

  return lines.join("\n");
}

export function readGolden(parsed: unknown): GoldenCase[] {
  if (!Array.isArray(parsed)) throw new Error("golden must be an array");
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`golden.json entry ${index} is malformed`);
    }
    if (!("request" in item) || typeof item.request !== "string") {
      throw new Error(`golden.json entry ${index} is malformed`);
    }
    if (!("expected" in item)) throw new Error(`golden.json entry ${index} is malformed`);
    const expected = item.expected;
    if (typeof expected !== "string" && expected !== null) {
      throw new Error(`golden.json entry ${index} is malformed`);
    }
    return { request: item.request, expected };
  });
}

/** 上限 concurrency の単純なワーカープールで評価する */
async function runAll(
  cases: readonly GoldenCase[],
  args: Args,
): Promise<{ rows: EvalRow[]; rosterSize: number }> {
  const apiKey = process.env["TYPESAFE_API_KEY"];
  if (apiKey === undefined || apiKey === "") throw new Error("TYPESAFE_API_KEY is required");
  const roster = discover(args.cwd);
  if (roster.length === 0) throw new Error(`roster is empty for cwd ${args.cwd}`);

  const rows: EvalRow[] = new Array(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = cases[index];
      if (item === undefined) return;
      try {
        const result = await suggest(item.request, roster, { apiKey });
        rows[index] = {
          request: item.request,
          expected: item.expected,
          winner: result.winner,
          gateMean: result.gate.mean,
          maxFits: result.shortlist.reduce((max, entry) => Math.max(max, entry.fits ?? 0), 0),
        };
      } catch (error) {
        // Jev が回答を欠いた・ショートリスト外を選んだ等で suggest が例外を投げても、
        // 1 件のケースの失敗として記録し、他のケースの評価は続行する
        rows[index] = {
          request: item.request,
          expected: item.expected,
          winner: null,
          gateMean: 0,
          maxFits: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, () => worker()),
  );
  return { rows, rosterSize: roster.length };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const cases = readGolden(JSON.parse(await Bun.file(args.golden).text()));
  const { rows, rosterSize } = await runAll(cases, args);
  console.log(buildReport(rows));
  console.log(`roster_size=${rosterSize}`);
}
