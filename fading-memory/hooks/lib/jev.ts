/**
 * TypeSafe System One (Jev) へ choice 質問を 1 問投げるだけの最小クライアント。
 *
 * typesafe プラグインの `hooks/lib/jev.ts` を意図的に複製したもの。マーケットプレイス経由で
 * 導入するとプラグインごとに別のディレクトリへ展開されるため、typesafe 側への相対 import は
 * 導入後の配置では解決できない。複製を持つことで fading-memory 単体で完結させる。
 *
 * 失敗はすべて JevError に正規化し、呼び出し側が「API が使えなかった理由」を 1 語で報告できる
 * ようにする。Authorization ヘッダは組み立てるだけで、どこにも記録しない。
 */

/** Jev に投げる 1 問。criteria のキーがそのまま選択肢の識別子になる */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  /** 選択の確からしさ。Jev が返す 0..1 の値 */
  confidence: number;
  probabilities: Record<string, number>;
};

export type SystemOneResponse = {
  model: string;
  /** choice として読めた答えだけが載る */
  answers: Record<string, ChoiceAnswer>;
};

/** テストで差し替えるための fetch の最小形 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** 呼び出し側がそのまま reason= として出力できる粒度の失敗区分 */
export type JevFailureReason = "network" | "timeout" | "invalid-response" | `http-${number}`;

export class JevError extends Error {
  readonly reason: JevFailureReason;

  constructor(reason: JevFailureReason, message: string) {
    super(message);
    this.name = "JevError";
    this.reason = reason;
  }
}

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

/** System One に 1 リクエスト投げる。同じ state への質問は 1 往復で並列に評価される */
export async function askSystemOne(
  state: Record<string, string>,
  questions: Record<string, ChoiceQuestion>,
  options: JevOptions,
): Promise<SystemOneResponse> {
  const baseUrl = options.baseUrl ?? process.env["TYPESAFE_BASE_URL"] ?? DEFAULT_BASE_URL;
  const model = options.model ?? process.env["TYPESAFE_SKILL_MODEL"] ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 中断の理由をあとで見分けるため、signal を手元に残しておく
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await doFetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, state, questions }),
      signal,
    });
    text = await response.text();
  } catch (e) {
    throw new JevError(signal.aborted ? "timeout" : "network", messageOf(e));
  }

  if (!response.ok) {
    throw new JevError(`http-${response.status}`, `TypeSafe System One returned ${response.status}`);
  }
  return parseResponse(parseBody(text));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** JSON として読めない本文は生の文字列のまま返し、形の検査側で弾かせる */
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

function parseAnswer(value: unknown): ChoiceAnswer | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value["type"] !== "choice" ||
    typeof value["choice"] !== "string" ||
    typeof value["confidence"] !== "number" ||
    !isRecord(value["probabilities"])
  ) {
    return undefined;
  }
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

function parseResponse(payload: unknown): SystemOneResponse {
  if (!isRecord(payload) || !isRecord(payload["answers"])) {
    throw new JevError("invalid-response", "TypeSafe System One returned an unexpected payload");
  }
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [key, value] of Object.entries(payload["answers"])) {
    const answer = parseAnswer(value);
    if (answer !== undefined) answers[key] = answer;
  }
  const model = typeof payload["model"] === "string" ? payload["model"] : "";
  return { model, answers };
}
