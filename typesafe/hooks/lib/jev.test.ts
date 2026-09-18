import { describe, expect, test } from "bun:test";
import { askSystemOne, type FetchLike, type JevCall, type SystemOneResponse } from "./jev.ts";

const RESPONSE: SystemOneResponse = {
  model: "jev-latest",
  answers: { q: { type: "noul", noul: 0.42 } },
};

type Captured = { url: string; init: RequestInit };

function capturingFetch(): { fetchImpl: FetchLike; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, captured };
}

describe("askSystemOne", () => {
  test("既定のエンドポイントとヘッダとボディで POST する", async () => {
    const { fetchImpl, captured } = capturingFetch();
    const result = await askSystemOne(
      { request: "この差分をレビューして", recent_context: "" },
      { q: { type: "noul", instructions: "Is this a request?" } },
      { apiKey: "sk-test", fetchImpl },
    );

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      model: "jev-latest",
      state: { request: "この差分をレビューして", recent_context: "" },
      questions: { q: { type: "noul", instructions: "Is this a request?" } },
    });
    expect(result.answers["q"]).toEqual({ type: "noul", noul: 0.42 });
  });

  test("baseUrl と model の指定が反映される", async () => {
    const { fetchImpl, captured } = capturingFetch();
    await askSystemOne(
      { request: "x", recent_context: "" },
      { q: { type: "noul", instructions: "Is this a request?" } },
      { apiKey: "sk-test", baseUrl: "http://127.0.0.1:9999", model: "jev-1.13", fetchImpl },
    );
    expect(captured[0]?.url).toBe("http://127.0.0.1:9999/v1/systemone");
    expect(JSON.parse(String(captured[0]?.init.body)).model).toBe("jev-1.13");
  });

  test("非 2xx は例外になる", async () => {
    const fetchImpl: FetchLike = async () => new Response("nope", { status: 500 });
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl },
      ),
    ).rejects.toThrow("TypeSafe System One returned 500");
  });

  test("タイムアウトは例外になる", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl, timeoutMs: 10 },
      ),
    ).rejects.toThrow("aborted");
  });

  test("リトライしない（失敗しても fetch は 1 回だけ）", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("nope", { status: 503 });
    };
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("askSystemOne の onCall", () => {
  const QUESTIONS = { q: { type: "noul", instructions: "Is this a request?" } } as const;
  const STATE = { request: "x", recent_context: "" };

  test("成功時に 1 回だけ、送信内容と応答をそのまま渡す", async () => {
    const { fetchImpl } = capturingFetch();
    const calls: JevCall[] = [];
    await askSystemOne(STATE, QUESTIONS, {
      apiKey: "sk-test",
      fetchImpl,
      onCall: (call) => calls.push(call),
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.request.model).toBe("jev-latest");
    expect(call?.request.state).toEqual(STATE);
    expect(call?.request.questions).toEqual(QUESTIONS);
    expect(call?.response?.status).toBe(200);
    expect(call?.response?.body).toEqual(RESPONSE);
    expect(call?.error).toBeUndefined();
    expect(call?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("非 2xx でも 1 回呼ばれ、status と error が載る", async () => {
    const fetchImpl: FetchLike = async () => new Response("nope", { status: 500 });
    const calls: JevCall[] = [];
    await expect(
      askSystemOne(STATE, QUESTIONS, { apiKey: "sk-test", fetchImpl, onCall: (c) => calls.push(c) }),
    ).rejects.toThrow("TypeSafe System One returned 500");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.response?.status).toBe(500);
    // JSON でない本文は生の文字列のまま残す
    expect(calls[0]?.response?.body).toBe("nope");
    expect(calls[0]?.error).toBe("TypeSafe System One returned 500");
  });

  test("fetch が落ちたら response は null で error だけが載る", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("aborted");
    };
    const calls: JevCall[] = [];
    await expect(
      askSystemOne(STATE, QUESTIONS, { apiKey: "sk-test", fetchImpl, onCall: (c) => calls.push(c) }),
    ).rejects.toThrow("aborted");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.response).toBeNull();
    expect(calls[0]?.error).toBe("aborted");
    expect(calls[0]?.request.state).toEqual(STATE);
  });

  test("応答の形が想定外でも 1 回呼ばれ、受け取った本文と error が載る", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ model: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const calls: JevCall[] = [];
    await expect(
      askSystemOne(STATE, QUESTIONS, { apiKey: "sk-test", fetchImpl, onCall: (c) => calls.push(c) }),
    ).rejects.toThrow("unexpected payload");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.response).toEqual({ status: 200, body: { model: "test" } });
    expect(calls[0]?.error).toBe("TypeSafe System One returned an unexpected payload");
  });

  test("onCall が例外を投げても呼び出し自体は成功する", async () => {
    const { fetchImpl } = capturingFetch();
    const result = await askSystemOne(STATE, QUESTIONS, {
      apiKey: "sk-test",
      fetchImpl,
      onCall: () => {
        throw new Error("ログ側の都合");
      },
    });
    expect(result.answers["q"]).toEqual({ type: "noul", noul: 0.42 });
  });
});
