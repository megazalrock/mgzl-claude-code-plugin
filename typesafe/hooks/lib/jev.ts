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

/** API との往復 1 回ぶんの生の記録。ヘッダは API キーが載るため一切残さない */
export type JevCall = {
  url: string;
  /** 送信した body をオブジェクトのまま */
  request: { model: string; state: Record<string, string>; questions: Record<string, Question> };
  /** 応答が得られなかった場合は null */
  response: { status: number; body: unknown } | null;
  /** 失敗した経路の文言。成功時は無し */
  error?: string;
  elapsedMs: number;
};

export type JevOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** 成否によらず往復ごとに 1 回呼ばれる。ここで投げた例外は無視される */
  onCall?: (call: JevCall) => void;
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

  const url = `${baseUrl}/v1/systemone`;
  const request = { model, state, questions };
  const startedAt = Date.now();
  const report = (call: Omit<JevCall, "elapsedMs">): void => {
    if (options.onCall === undefined) return;
    try {
      options.onCall({ ...call, elapsedMs: Date.now() - startedAt });
    } catch {
      // 記録の失敗で提案そのものを落とさない
    }
  };

  let response: Response;
  let text: string;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 本文は 1 度しか読めないので、ここで文字列にして記録と解析の両方に使い回す
    text = await response.text();
  } catch (e) {
    report({ url, request, response: null, error: messageOf(e) });
    throw e;
  }

  const body = parseBody(text);
  if (!response.ok) {
    const error = `TypeSafe System One returned ${response.status}`;
    report({ url, request, response: { status: response.status, body }, error });
    throw new Error(error);
  }
  try {
    const parsed = parseResponse(body);
    report({ url, request, response: { status: response.status, body } });
    return parsed;
  } catch (e) {
    report({ url, request, response: { status: response.status, body }, error: messageOf(e) });
    throw e;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** JSON として読めない本文は生の文字列のまま記録に残す */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
