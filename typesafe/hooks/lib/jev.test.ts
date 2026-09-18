import { describe, expect, test } from "bun:test";
import { askSystemOne, type FetchLike, type SystemOneResponse } from "./jev.ts";

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
