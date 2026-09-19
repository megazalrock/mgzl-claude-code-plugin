/**
 * 既存記憶同士の重複候補を Jev で洗い出す基礎実験（issue #55）。
 * 記憶 i を候補、i より後ろの記憶を criteria にして片方向だけ問う。
 * 組み立てと集計（純粋）と API 呼び出し（不純）を分けてある。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkDuplicates,
  type DedupCandidateResult,
  type DedupVerdict,
  type MemoryEntry,
} from "../../../fading-memory/hooks/lib/dedup.ts";
import { ensureDirs, loadMemories } from "../../../fading-memory/hooks/lib/maintenance.ts";
import { dataPaths } from "../../../fading-memory/hooks/lib/paths.ts";

/** 候補 1 件と、その相手になる既存記憶の集合 */
export type Pairing = { candidate: MemoryEntry; others: MemoryEntry[] };

export type SelfDedupRow = {
  slug: string;
  title: string;
  verdict: DedupVerdict;
  noneProbability: number;
  confidence: number;
  top: { slug: string; probability: number }[];
  elapsedMs: number;
};

export type Summary = {
  candidates: number;
  verdicts: Record<DedupVerdict, number>;
  requests: number;
  totalElapsedMs: number;
  avgElapsedMs: number;
};

const VERDICTS: readonly DedupVerdict[] = ["duplicate", "ambiguous", "new"];

/** 候補ごとの所要時間の内訳を並列実行の実時間と混ぜないため、待ち時間の合計だけを集計する */
export function summarize(rows: readonly SelfDedupRow[]): Summary {
  const verdicts: Record<DedupVerdict, number> = { duplicate: 0, ambiguous: 0, new: 0 };
  let totalElapsedMs = 0;
  for (const row of rows) {
    verdicts[row.verdict] += 1;
    totalElapsedMs += row.elapsedMs;
  }
  return {
    candidates: rows.length,
    verdicts,
    // 候補 1 件につき checkDuplicates を 1 回呼ぶので、リクエスト数は候補数と一致する
    requests: rows.length,
    totalElapsedMs,
    avgElapsedMs: rows.length === 0 ? 0 : totalElapsedMs / rows.length,
  };
}

/**
 * slug 昇順に並べ、記憶 i と「i より後ろ」の組を作る。
 * 重複は対称なので片方向で足り、同じ組を二度判定しない。
 * 最後の記憶は相手がいないので組を作らない。
 */
export function buildPairings(entries: readonly MemoryEntry[]): Pairing[] {
  const sorted = [...entries].sort((left, right) => left.slug.localeCompare(right.slug));
  const pairings: Pairing[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const candidate = sorted[i];
    if (candidate === undefined) continue;
    pairings.push({ candidate, others: sorted.slice(i + 1) });
  }
  return pairings;
}

export function formatTop(top: readonly { slug: string; probability: number }[]): string {
  if (top.length === 0) return "-";
  return top.map((item) => `${item.slug}:${item.probability.toFixed(2)}`).join(",");
}

export function formatRow(row: SelfDedupRow): string {
  // title は空白を含みうるため行末に置く
  return `slug=${row.slug} verdict=${row.verdict} none_p=${row.noneProbability.toFixed(2)} confidence=${row.confidence.toFixed(2)} elapsed_ms=${row.elapsedMs} top=${formatTop(row.top)} title=${row.title}`;
}

export function formatSummary(summary: Summary): string {
  const verdicts = VERDICTS.map((verdict) => `${verdict}=${summary.verdicts[verdict]}`).join(" ");
  return [
    `candidates=${summary.candidates}`,
    verdicts,
    `requests=${summary.requests}`,
    `total_elapsed_ms=${summary.totalElapsedMs}`,
    `avg_elapsed_ms=${summary.avgElapsedMs.toFixed(1)}`,
  ].join(" ");
}

function fail(reason: string): never {
  console.log(`self_dedup=unavailable reason=${reason}`);
  process.exit(1);
}

/** 上限 concurrency の単純なワーカープール。1 件でも判定できなければ全体を失敗にする */
async function runAll(
  pairings: readonly Pairing[],
  apiKey: string,
  concurrency: number,
): Promise<SelfDedupRow[]> {
  const rows: SelfDedupRow[] = new Array(pairings.length);
  let next = 0;
  let failure: string | undefined;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failure !== undefined) return;
      const index = next++;
      const pairing = pairings[index];
      if (pairing === undefined) return;
      const startedAt = Date.now();
      const outcome = await checkDuplicates([pairing.candidate.title], pairing.others, { apiKey });
      const elapsedMs = Date.now() - startedAt;
      if (outcome.status === "unavailable") {
        failure = outcome.reason;
        return;
      }
      const result: DedupCandidateResult | undefined = outcome.results[0];
      if (result === undefined) {
        failure = "empty-result";
        return;
      }
      rows[index] = {
        slug: pairing.candidate.slug,
        title: pairing.candidate.title,
        verdict: result.verdict,
        noneProbability: result.noneProbability,
        confidence: result.confidence,
        top: result.top,
        elapsedMs,
      };
    }
  };

  const workers = Math.min(Math.max(1, concurrency), Math.max(1, pairings.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failure !== undefined) fail(failure);
  return rows;
}

if (import.meta.main) {
  const projectDir = process.argv[2] ?? process.cwd();

  const apiKey = process.env["TYPESAFE_API_KEY"];
  if (apiKey === undefined || apiKey === "") fail("no-api-key");

  const paths = dataPaths(projectDir);
  ensureDirs(paths);
  const { memories } = loadMemories(paths);
  const entries: MemoryEntry[] = memories.map((memory) => ({
    slug: memory.slug,
    title: memory.meta.title,
  }));
  const pairings = buildPairings(entries);
  if (pairings.length === 0) fail("not-enough-memories");

  const rows = await runAll(pairings, apiKey, 3);

  console.log("self_dedup=ok");
  for (const row of rows) console.log(formatRow(row));
  console.log(formatSummary(summarize(rows)));

  const resultsDir = join(import.meta.dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  // コロンを含む ISO 時刻はファイル名に向かないため置き換える
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(resultsDir, `self-dedup-${stamp}.jsonl`);
  await Bun.write(outFile, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  console.log(`output=${outFile}`);
}
