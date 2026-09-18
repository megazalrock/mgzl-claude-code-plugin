import { type Answer, askSystemOne, type ChoiceAnswer, type JevOptions, type Question } from "./jev.ts";
import type { RosterEntry } from "./roster.ts";

/** 「どれも該当しない」を表す criteria のキー。roster のスキル名と同じ名前空間に置く */
export const NONE_KEY = "none";
/** 分析用に result へ残す上位候補の件数。判定そのものには使わない */
export const SHORTLIST = 3;

export type Outcome = "suggested" | "no_fit";

/** 判定の枠組み。プロンプト向けと行為向けで choice の質問文と none の説明文が変わる */
export type Framing = {
  /** choice 質問の instructions */
  wide: string;
  /** none の criteria に置く説明文 */
  none: string;
};

export type ShortlistItem = {
  name: string;
  probability: number;
};

export type SuggestResult = {
  outcome: Outcome;
  winner: string | null;
  /** none に割り当てられた確率。閾値には使わないが、判定の自信の指標として残す */
  noneProbability: number;
  shortlist: ShortlistItem[];
  elapsedMs: number;
};

const WIDE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?";

/** UserPromptSubmit 向け。ユーザーの依頼文を材料にする枠組み */
export const PROMPT_FRAMING: Framing = {
  wide: WIDE_INSTRUCTIONS,
  none: "None of the listed skills applies. The request can be handled directly without loading any skill.",
};

const TOOL_WIDE_INSTRUCTIONS =
  "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?";

/** PreToolUse 向け。これから取る行為を材料にする枠組み */
export const TOOL_FRAMING: Framing = {
  wide: TOOL_WIDE_INSTRUCTIONS,
  none: "None of the listed skills documents a procedure for this action. It can be done directly.",
};

function choiceOf(answers: Record<string, Answer>, key: string): ChoiceAnswer | undefined {
  const answer = answers[key];
  return answer !== undefined && answer.type === "choice" ? answer : undefined;
}

/**
 * roster 全件の description に「どれも該当しない」の選択肢を足した Choice 1 問を組み立てる。
 * 明示的な none を同じ選択肢の中で競わせることで、別途の足切り質問を不要にしている。
 */
function wideQuestions(roster: readonly RosterEntry[], framing: Framing): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of roster) criteria[entry.name] = entry.description;
  criteria[NONE_KEY] = framing.none;
  return { which: { type: "choice", instructions: framing.wide, criteria } };
}

export async function suggest(
  prompt: string,
  roster: readonly RosterEntry[],
  options: JevOptions,
  framing: Framing = PROMPT_FRAMING,
): Promise<SuggestResult> {
  // roster に "none" という名前のスキルがあると選択肢が潰れ、提案と「該当なし」を区別できなくなる
  if (roster.some((entry) => entry.name === NONE_KEY)) {
    throw new Error(`A roster entry is named '${NONE_KEY}', which collides with the none option`);
  }

  const startedAt = Date.now();
  const state = { request: prompt, recent_context: "" };

  const response = await askSystemOne(state, wideQuestions(roster, framing), options);
  const which = choiceOf(response.answers, "which");
  if (which === undefined) {
    throw new Error("Jev did not answer the 'which' choice question");
  }

  const names = new Set(roster.map((entry) => entry.name));
  if (which.choice !== NONE_KEY && !names.has(which.choice)) {
    throw new Error(`Jev chose '${which.choice}' which is not in the roster`);
  }

  const shortlist: ShortlistItem[] = Object.entries(which.probabilities)
    .filter(([name]) => name !== NONE_KEY && names.has(name))
    .sort(([, left], [, right]) => right - left)
    .slice(0, SHORTLIST)
    .map(([name, probability]) => ({ name, probability }));

  const noneProbability = which.probabilities[NONE_KEY] ?? 0;
  const elapsedMs = Date.now() - startedAt;
  if (which.choice === NONE_KEY) {
    return { outcome: "no_fit", winner: null, noneProbability, shortlist, elapsedMs };
  }
  return { outcome: "suggested", winner: which.choice, noneProbability, shortlist, elapsedMs };
}
