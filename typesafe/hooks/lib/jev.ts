/** Jev に投げる 1 問。Choice は候補ごとの確率、Noul は真偽の確率を返す */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type NoulQuestion = { type: "noul"; instructions: string };
export type Question = ChoiceQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type NoulAnswer = { type: "noul"; noul: number };
export type Answer = ChoiceAnswer | NoulAnswer;

export type SystemOneResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage?: unknown;
};

/** テストで差し替えるための fetch の最小形 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type JevOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * System One に 1 リクエストを投げる。同じ state に対する質問は 1 リクエストにまとめて
 * 並列評価されるため、質問を増やしても往復は増えない。
 */
export async function askSystemOne(
  state: Record<string, string>,
  questions: Record<string, Question>,
  options: JevOptions,
): Promise<SystemOneResponse> {
  const baseUrl = options.baseUrl ?? process.env["TYPESAFE_BASE_URL"] ?? DEFAULT_BASE_URL;
  const model = options.model ?? process.env["TYPESAFE_SKILL_MODEL"] ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await doFetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`TypeSafe System One returned ${response.status}`);
  }
  return parseResponse(await response.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnswer(value: unknown): Answer | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] === "noul" && typeof value["noul"] === "number") {
    return { type: "noul", noul: value["noul"] };
  }
  if (
    value["type"] === "choice" &&
    typeof value["choice"] === "string" &&
    typeof value["confidence"] === "number" &&
    isRecord(value["probabilities"])
  ) {
    const probabilities: Record<string, number> = {};
    for (const [key, probability] of Object.entries(value["probabilities"])) {
      if (typeof probability === "number") probabilities[key] = probability;
    }
    return {
      type: "choice",
      choice: value["choice"],
      confidence: value["confidence"],
      probabilities,
    };
  }
  return undefined;
}

/** 応答の形が想定外なら例外にする。フェイルオープンは入口側でまとめて行う */
function parseResponse(payload: unknown): SystemOneResponse {
  if (!isRecord(payload) || !isRecord(payload["answers"])) {
    throw new Error("TypeSafe System One returned an unexpected payload");
  }
  const answers: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(payload["answers"])) {
    const answer = parseAnswer(value);
    if (answer !== undefined) answers[key] = answer;
  }
  const model = typeof payload["model"] === "string" ? payload["model"] : "";
  return { model, answers, usage: payload["usage"] };
}
