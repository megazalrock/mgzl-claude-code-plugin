import {
  type Answer,
  askSystemOne,
  type ChoiceAnswer,
  type JevOptions,
  type Question,
} from "./jev.ts";
import type { RosterEntry } from "./roster.ts";

/** Call 1 から Call 2 に渡す候補数 */
export const SHORTLIST = 3;
/** Call 2 の criteria に入れる SKILL.md 冒頭の文字数 */
export const EXCERPT_CHARS = 700;
/** gate の平均。これ未満なら提案しない */
export const GATE_THRESHOLD = 0.3;
/** fits の最大値。これ未満ならショートリストごと破棄する */
export const FITS_THRESHOLD = 0.3;

export type Outcome = "suggested" | "gate_quiet" | "no_fit";

/** Call 1 に載せる Noul 1 問。invert が true なら平均に入れる前に 1 - noul へ反転する */
export type GateSpec = { key: string; instructions: string; invert: boolean };

/** 判定の枠組み。プロンプト向けと行為向けで質問文と gate の構成が変わる */
export type Framing = {
  /** Call 1 の choice 質問文 */
  wide: string;
  /** Call 2 の choice 質問文 */
  rerank: string;
  /** Call 2 の候補ごとの noul 質問文 */
  fits: (name: string, description: string) => string;
  gates: readonly GateSpec[];
};

export type GateScores = {
  /** gate 質問キー → 反転前の生の noul。framing ごとにキーが変わる */
  scores: Record<string, number>;
  /** invert 適用後の平均 */
  mean: number;
};

export type ShortlistItem = {
  name: string;
  wideProbability: number;
  rerankProbability?: number;
  fits?: number;
};

export type SuggestResult = {
  outcome: Outcome;
  winner: string | null;
  gate: GateScores;
  shortlist: ShortlistItem[];
  rerankConfidence?: number;
  elapsedMs: number;
};

const WIDE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?";
const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.";
const GATE_ACTS =
  "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?";
const GATE_PROCEDURE =
  "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?";
const GATE_PROSE =
  "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?";

/** UserPromptSubmit 向け。ユーザーの依頼文を材料にする従来の枠組み */
export const PROMPT_FRAMING: Framing = {
  wide: WIDE_INSTRUCTIONS,
  rerank: RERANK_INSTRUCTIONS,
  fits: (name, description) =>
    `Does the skill '${name}' do the specific thing the user's request asks for? It is described as: ${description}`,
  gates: [
    { key: "gate::acts_on_user_system", instructions: GATE_ACTS, invert: false },
    { key: "gate::would_follow_documented_procedure", instructions: GATE_PROCEDURE, invert: false },
    // 「文章で足りる」ほど提案が不要になるため反転して平均に入れる
    { key: "gate::prose_suffices", instructions: GATE_PROSE, invert: true },
  ],
};

const TOOL_WIDE_INSTRUCTIONS =
  "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?";
const TOOL_RERANK_INSTRUCTIONS =
  "Exactly one of these skills documents the procedure for the action the assistant is about to take. Which one? Read what each actually does, not just its name.";
const GATE_ROUTINE_STEP =
  "Is this action a routine inspection step, such as listing, reading, or checking state, that any careful assistant would do without consulting a documented procedure?";

/**
 * PreToolUse 向け。プロンプト向けの gate 3 問は Bash 実行直前には自明に同じ答えになり
 * 判別力が無いため、「ただの確認作業か」を問う 1 問だけにする。
 */
export const TOOL_FRAMING: Framing = {
  wide: TOOL_WIDE_INSTRUCTIONS,
  rerank: TOOL_RERANK_INSTRUCTIONS,
  fits: (name, description) =>
    `Does the skill '${name}' actually cover the action the assistant is about to take, rather than a merely similar topic? It is described as: ${description}`,
  gates: [{ key: "gate::routine_step", instructions: GATE_ROUTINE_STEP, invert: true }],
};

function noulOf(answers: Record<string, Answer>, key: string): number {
  const answer = answers[key];
  if (answer === undefined || answer.type !== "noul") {
    throw new Error(`Jev did not answer the noul question '${key}'`);
  }
  return answer.noul;
}

function choiceOf(answers: Record<string, Answer>, key: string): ChoiceAnswer | undefined {
  const answer = answers[key];
  return answer !== undefined && answer.type === "choice" ? answer : undefined;
}

/**
 * Call 1。全件を description だけで浅く読み、
 * 同時に「そもそもスキルが要るターンか」を framing の gate で測る。
 */
function wideQuestions(
  roster: readonly RosterEntry[],
  framing: Framing,
): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of roster) criteria[entry.name] = entry.description;
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: framing.wide, criteria },
  };
  for (const gate of framing.gates) {
    questions[gate.key] = { type: "noul", instructions: gate.instructions };
  }
  return questions;
}

function rerankQuestions(
  candidates: readonly RosterEntry[],
  framing: Framing,
): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of candidates) {
    criteria[entry.name] = `${entry.description} — ${entry.body.slice(0, EXCERPT_CHARS)}`;
  }
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: framing.rerank, criteria },
  };
  for (const entry of candidates) {
    questions[`fits::${entry.name}`] = {
      type: "noul",
      instructions: framing.fits(entry.name, entry.description),
    };
  }
  return questions;
}

function computeGate(answers: Record<string, Answer>, gates: readonly GateSpec[]): GateScores {
  const scores: Record<string, number> = {};
  let total = 0;
  for (const gate of gates) {
    const raw = noulOf(answers, gate.key);
    scores[gate.key] = raw;
    total += gate.invert ? 1 - raw : raw;
  }
  // gate が 0 問の framing は想定しないが、0 除算で NaN を混ぜないよう 0 を返す
  return { scores, mean: gates.length === 0 ? 0 : total / gates.length };
}

export async function suggest(
  prompt: string,
  roster: readonly RosterEntry[],
  options: JevOptions,
  framing: Framing = PROMPT_FRAMING,
): Promise<SuggestResult> {
  const startedAt = Date.now();
  const state = { request: prompt, recent_context: "" };

  const wide = await askSystemOne(state, wideQuestions(roster, framing), options);
  const wideWhich = choiceOf(wide.answers, "which");
  if (wideWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question (call 1)");
  }

  const gate = computeGate(wide.answers, framing.gates);

  const byName = new Map(roster.map((entry) => [entry.name, entry]));
  const candidates = Object.entries(wideWhich.probabilities)
    .sort(([, left], [, right]) => right - left)
    .flatMap(([name, probability]) => {
      const entry = byName.get(name);
      return entry === undefined ? [] : [{ entry, probability }];
    })
    .slice(0, SHORTLIST);

  if (gate.mean < GATE_THRESHOLD) {
    // Call 2 は呼ばないが、gate が黙らせた依頼でも Call 1 の上位候補は評価の材料として残す
    return {
      outcome: "gate_quiet",
      winner: null,
      gate,
      shortlist: candidates.map(({ entry, probability }) => ({
        name: entry.name,
        wideProbability: probability,
      })),
      elapsedMs: Date.now() - startedAt,
    };
  }

  if (candidates.length === 0) {
    throw new Error("Jev ranked no roster entry in call 1");
  }

  const rerank = await askSystemOne(
    state,
    rerankQuestions(
      candidates.map((candidate) => candidate.entry),
      framing,
    ),
    options,
  );
  const rerankWhich = choiceOf(rerank.answers, "which");
  if (rerankWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question (call 2)");
  }
  const candidateNames = new Set(candidates.map((candidate) => candidate.entry.name));
  if (!candidateNames.has(rerankWhich.choice)) {
    throw new Error(`Jev chose '${rerankWhich.choice}' which is not in the shortlist`);
  }

  // fits は noulOf 内で必ず数値が返るか例外になるため、この時点では number 確定
  const rankedShortlist = candidates.map(({ entry, probability }) => ({
    name: entry.name,
    wideProbability: probability,
    rerankProbability: rerankWhich.probabilities[entry.name],
    fits: noulOf(rerank.answers, `fits::${entry.name}`),
  }));
  const shortlist: ShortlistItem[] = rankedShortlist;

  const maxFits = rankedShortlist.reduce((max, item) => Math.max(max, item.fits), 0);
  const elapsedMs = Date.now() - startedAt;
  if (maxFits < FITS_THRESHOLD) {
    return { outcome: "no_fit", winner: null, gate, shortlist, elapsedMs };
  }
  return {
    outcome: "suggested",
    winner: rerankWhich.choice,
    gate,
    shortlist,
    rerankConfidence: rerankWhich.confidence,
    elapsedMs,
  };
}
