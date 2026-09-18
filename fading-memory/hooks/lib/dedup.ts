/**
 * 新しく保存しようとしている記憶が既存記憶の重複かどうかを Jev の choice 質問で判定する。
 * 質問の組み立てと判定規則（純粋）と、API 呼び出し（不純）を分けてある。
 */
import { config } from "./config.ts";
import {
  askSystemOne,
  JevError,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type FetchLike,
} from "./jev.ts";

/** 「既存のどれでもない」を表す criteria のキー。slug と同じ名前空間に置く */
export const NONE_KEY = "none";

const INSTRUCTIONS =
  "A new memory is about to be saved. Its title is in the state. Which of the existing memories, if any, covers the same concern — that is, the new memory would duplicate it or should update it instead of being saved separately? Choose none if the new memory is about a topic none of them covers.";

const NONE_DESCRIPTION =
  "既存のどの記憶とも同じ関心ではない。新しい話題なので別の記憶として保存してよい。";

/** state に載せるキー。新しい記憶の title だけを渡す */
const STATE_KEY = "candidate_title";

export type MemoryEntry = { slug: string; title: string };

export type DedupThresholds = {
  newAbove: number;
  duplicateBelow: number;
  duplicateMinConfidence: number;
  candidateMinProbability: number;
  maxCandidates: number;
};

export type DedupVerdict = "duplicate" | "ambiguous" | "new";

export type DedupJudgement = {
  verdict: DedupVerdict;
  noneProbability: number;
  confidence: number;
  /** Claude に本文を読ませる候補。確率降順 */
  top: { slug: string; probability: number }[];
};

export type DedupCandidateResult = DedupJudgement & { candidate: string };

export type DedupOutcome =
  | { status: "ok"; results: DedupCandidateResult[] }
  | { status: "unavailable"; reason: string };

/** チャンク分割した質問のキー。塊の順序が分かる名前にする */
export function chunkKey(index: number): string {
  return `chunk${index}`;
}

/**
 * 既存記憶の title を criteria にした choice 質問を組み立てる。
 * criteria の件数上限に収まるよう entries を分割し、塊ごとに 1 問を作る。
 * 同じ state への複数質問は 1 リクエストで並列評価されるため、往復は増えない。
 */
export function buildDedupQuestion(
  entries: readonly MemoryEntry[],
  maxCriteriaPerQuestion: number = config.dedup.maxCriteriaPerQuestion,
): Record<string, ChoiceQuestion> {
  const size = Math.max(1, maxCriteriaPerQuestion);
  const questions: Record<string, ChoiceQuestion> = {};
  let index = 0;
  for (let start = 0; start < Math.max(1, entries.length); start += size) {
    const criteria: Record<string, string> = {};
    for (const entry of entries.slice(start, start + size)) criteria[entry.slug] = entry.title;
    criteria[NONE_KEY] = NONE_DESCRIPTION;
    questions[chunkKey(index)] = { type: "choice", instructions: INSTRUCTIONS, criteria };
    index += 1;
  }
  return questions;
}

/**
 * 塊ごとの答えを 1 つの答えへ畳む。
 * 本物の重複を含む塊だけ none が下がり、他の塊は none がほぼ 1.0 になるため、
 * 全体の none 確率は塊ごとの最小値を採る。confidence はその塊のものを引き継ぐ。
 */
export function mergeChunkAnswers(answers: readonly ChoiceAnswer[]): ChoiceAnswer {
  const first = answers[0];
  if (first === undefined) throw new JevError("invalid-response", "no chunk answers to merge");
  // 分割が起きていない場合に判定を変えないよう、そのまま返す
  if (answers.length === 1) return first;

  let noneProbability = Number.POSITIVE_INFINITY;
  let confidence = first.confidence;
  const probabilities: Record<string, number> = {};
  for (const answer of answers) {
    const none = answer.probabilities[NONE_KEY] ?? 0;
    if (none < noneProbability) {
      noneProbability = none;
      confidence = answer.confidence;
    }
    for (const [slug, probability] of Object.entries(answer.probabilities)) {
      if (slug === NONE_KEY) continue;
      probabilities[slug] = probability;
    }
  }
  probabilities[NONE_KEY] = noneProbability;
  const choice =
    Object.entries(probabilities).sort(([, left], [, right]) => right - left)[0]?.[0] ?? NONE_KEY;
  return { type: "choice", choice, confidence, probabilities };
}

/** none 確率と confidence から 3 通りの判定を出し、Claude に渡す候補を選ぶ */
export function classify(
  answer: ChoiceAnswer,
  thresholds: DedupThresholds = config.dedup,
): DedupJudgement {
  const noneProbability = answer.probabilities[NONE_KEY] ?? 0;
  const top = Object.entries(answer.probabilities)
    .filter(
      ([slug, probability]) =>
        slug !== NONE_KEY && probability >= thresholds.candidateMinProbability,
    )
    .sort(([, left], [, right]) => right - left)
    .slice(0, thresholds.maxCandidates)
    .map(([slug, probability]) => ({ slug, probability }));

  const verdict = decide(noneProbability, answer.confidence, thresholds);
  return { verdict, noneProbability, confidence: answer.confidence, top };
}

function decide(
  noneProbability: number,
  confidence: number,
  thresholds: DedupThresholds,
): DedupVerdict {
  if (noneProbability >= thresholds.newAbove) return "new";
  if (
    noneProbability <= thresholds.duplicateBelow &&
    confidence >= thresholds.duplicateMinConfidence
  ) {
    return "duplicate";
  }
  return "ambiguous";
}

export type CheckDuplicatesOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  thresholds?: DedupThresholds;
  maxCriteriaPerQuestion?: number;
  concurrency?: number;
};

/**
 * 候補ごとに 1 リクエストを投げて判定する。
 * 一部だけ判定できても呼び出し側が扱いに困るため、1 件でも失敗したら全体を unavailable にする。
 */
export async function checkDuplicates(
  candidates: readonly string[],
  entries: readonly MemoryEntry[],
  options: CheckDuplicatesOptions,
): Promise<DedupOutcome> {
  const thresholds = options.thresholds ?? config.dedup;
  const questions = buildDedupQuestion(
    entries,
    options.maxCriteriaPerQuestion ?? config.dedup.maxCriteriaPerQuestion,
  );
  const chunkCount = Object.keys(questions).length;
  const results: DedupCandidateResult[] = new Array(candidates.length);
  let failure: string | undefined;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failure !== undefined) return;
      const index = next++;
      const candidate = candidates[index];
      if (candidate === undefined) return;
      try {
        const response = await askSystemOne({ [STATE_KEY]: candidate }, questions, {
          apiKey: options.apiKey,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs ?? config.dedup.timeoutMs,
        });
        const answers: ChoiceAnswer[] = [];
        for (let chunk = 0; chunk < chunkCount; chunk += 1) {
          const answer = response.answers[chunkKey(chunk)];
          if (answer === undefined) {
            throw new JevError("invalid-response", `Jev did not answer ${chunkKey(chunk)}`);
          }
          answers.push(answer);
        }
        results[index] = {
          candidate,
          ...classify(mergeChunkAnswers(answers), thresholds),
        };
      } catch (e) {
        failure = e instanceof JevError ? e.reason : "network";
        return;
      }
    }
  };

  const workers = Math.min(Math.max(1, options.concurrency ?? 3), Math.max(1, candidates.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (failure !== undefined) return { status: "unavailable", reason: failure };
  return { status: "ok", results };
}
