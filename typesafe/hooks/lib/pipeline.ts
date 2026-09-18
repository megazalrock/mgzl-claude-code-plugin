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
/** gate 3 問の平均。これ未満なら提案しない */
export const GATE_THRESHOLD = 0.3;
/** fits の最大値。これ未満ならショートリストごと破棄する */
export const FITS_THRESHOLD = 0.3;

export type Outcome = "suggested" | "gate_quiet" | "no_fit";

export type GateScores = {
  acts_on_user_system: number;
  would_follow_documented_procedure: number;
  prose_suffices: number;
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

function noulOf(answers: Record<string, Answer>, key: string): number {
  const answer = answers[key];
  return answer !== undefined && answer.type === "noul" ? answer.noul : 0;
}

function choiceOf(answers: Record<string, Answer>, key: string): ChoiceAnswer | undefined {
  const answer = answers[key];
  return answer !== undefined && answer.type === "choice" ? answer : undefined;
}

/**
 * Call 1 の 2 コール構成。全件を description だけで浅く読み、
 * 同時に「そもそもスキルが要るターンか」を Noul 3 問で測る。
 */
function wideQuestions(roster: readonly RosterEntry[]): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of roster) criteria[entry.name] = entry.description;
  return {
    which: { type: "choice", instructions: WIDE_INSTRUCTIONS, criteria },
    "gate::acts_on_user_system": { type: "noul", instructions: GATE_ACTS },
    "gate::would_follow_documented_procedure": { type: "noul", instructions: GATE_PROCEDURE },
    "gate::prose_suffices": { type: "noul", instructions: GATE_PROSE },
  };
}

function rerankQuestions(candidates: readonly RosterEntry[]): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of candidates) {
    criteria[entry.name] = `${entry.description} — ${entry.body.slice(0, EXCERPT_CHARS)}`;
  }
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: RERANK_INSTRUCTIONS, criteria },
  };
  for (const entry of candidates) {
    questions[`fits::${entry.name}`] = {
      type: "noul",
      instructions: `Does the skill '${entry.name}' do the specific thing the user's request asks for? It is described as: ${entry.description}`,
    };
  }
  return questions;
}

export async function suggest(
  prompt: string,
  roster: readonly RosterEntry[],
  options: JevOptions,
): Promise<SuggestResult> {
  const startedAt = Date.now();
  const state = { request: prompt, recent_context: "" };

  const wide = await askSystemOne(state, wideQuestions(roster), options);
  const wideWhich = choiceOf(wide.answers, "which");
  if (wideWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question");
  }

  const acts = noulOf(wide.answers, "gate::acts_on_user_system");
  const procedure = noulOf(wide.answers, "gate::would_follow_documented_procedure");
  const prose = noulOf(wide.answers, "gate::prose_suffices");
  // prose_suffices だけは「文章で足りる」ほど提案が不要になるため反転して平均に入れる
  const gate: GateScores = {
    acts_on_user_system: acts,
    would_follow_documented_procedure: procedure,
    prose_suffices: prose,
    mean: (acts + procedure + (1 - prose)) / 3,
  };

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

  const rerank = await askSystemOne(
    state,
    rerankQuestions(candidates.map((candidate) => candidate.entry)),
    options,
  );
  const rerankWhich = choiceOf(rerank.answers, "which");
  if (rerankWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question");
  }

  const shortlist: ShortlistItem[] = candidates.map(({ entry, probability }) => ({
    name: entry.name,
    wideProbability: probability,
    rerankProbability: rerankWhich.probabilities[entry.name],
    fits: noulOf(rerank.answers, `fits::${entry.name}`),
  }));

  const maxFits = shortlist.reduce((max, item) => Math.max(max, item.fits ?? 0), 0);
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
