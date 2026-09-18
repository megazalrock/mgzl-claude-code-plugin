import { describe, expect, test } from "bun:test";
import { config } from "./config.ts";
import {
  buildDedupQuestion,
  checkDuplicates,
  chunkKey,
  classify,
  mergeChunkAnswers,
  NONE_KEY,
} from "./dedup.ts";
import type { ChoiceAnswer, FetchLike } from "./jev.ts";

const THRESHOLDS = config.dedup;

function answer(
  noneProbability: number,
  confidence: number,
  others: Record<string, number> = { "a-slug": 0.5 },
): ChoiceAnswer {
  const probabilities: Record<string, number> = { ...others, [NONE_KEY]: noneProbability };
  const choice =
    Object.entries(probabilities).sort(([, left], [, right]) => right - left)[0]?.[0] ?? NONE_KEY;
  return { type: "choice", choice, confidence, probabilities };
}

function manyEntries(count: number): { slug: string; title: string }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    slug: `slug-${index}`,
    title: `記憶 ${index}`,
  }));
}

describe("buildDedupQuestion", () => {
  test("slug を criteria のキーにし、none を足す", () => {
    const questions = buildDedupQuestion([
      { slug: "a-slug", title: "A の記憶" },
      { slug: "b-slug", title: "B の記憶" },
    ]);
    expect(Object.keys(questions)).toEqual([chunkKey(0)]);
    const question = questions[chunkKey(0)];
    expect(question?.type).toBe("choice");
    expect(question?.criteria["a-slug"]).toBe("A の記憶");
    expect(question?.criteria["b-slug"]).toBe("B の記憶");
    expect(typeof question?.criteria[NONE_KEY]).toBe("string");
    expect((question?.instructions ?? "").length).toBeGreaterThan(0);
  });

  test("記憶 73 件は既定の上限（254）に収まるので 1 問のままにする", () => {
    const questions = buildDedupQuestion(manyEntries(73));
    expect(Object.keys(questions)).toHaveLength(1);
    expect(Object.keys(questions[chunkKey(0)]?.criteria ?? {})).toHaveLength(74);
  });

  test("上限を超える件数は塊に分け、各塊に none を入れる", () => {
    const questions = buildDedupQuestion(manyEntries(12), 5);
    expect(Object.keys(questions)).toEqual([chunkKey(0), chunkKey(1), chunkKey(2)]);
    expect(Object.keys(questions[chunkKey(0)]?.criteria ?? {})).toHaveLength(6);
    expect(Object.keys(questions[chunkKey(2)]?.criteria ?? {})).toHaveLength(3);
    expect(questions[chunkKey(1)]?.criteria["slug-5"]).toBe("記憶 5");
    expect(questions[chunkKey(2)]?.criteria[NONE_KEY]).toBeDefined();
  });

  test("criteria は none を含めて 255 件を超えない", () => {
    for (const question of Object.values(buildDedupQuestion(manyEntries(600)))) {
      expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(255);
    }
  });
});

describe("mergeChunkAnswers", () => {
  test("塊が 1 つならその答えをそのまま返す", () => {
    const only = answer(0.4, 0.8);
    expect(mergeChunkAnswers([only])).toBe(only);
  });

  test("none 確率は塊ごとの最小値を採り、confidence はその塊のものを使う", () => {
    const merged = mergeChunkAnswers([
      answer(0.95, 0.99, { "far-slug": 0.05 }),
      answer(0.12, 0.61, { "near-slug": 0.88 }),
    ]);
    expect(merged.probabilities[NONE_KEY]).toBeCloseTo(0.12);
    expect(merged.confidence).toBeCloseTo(0.61);
    expect(merged.choice).toBe("near-slug");
  });

  test("none 以外の確率は全塊から集める", () => {
    const merged = mergeChunkAnswers([
      answer(0.5, 0.7, { a: 0.3 }),
      answer(0.6, 0.7, { b: 0.25 }),
    ]);
    expect(merged.probabilities["a"]).toBeCloseTo(0.3);
    expect(merged.probabilities["b"]).toBeCloseTo(0.25);
  });
});

describe("classify", () => {
  test("none 確率が閾値ちょうど (0.45) なら new", () => {
    expect(classify(answer(0.45, 0.9), THRESHOLDS).verdict).toBe("new");
  });

  test("none 確率が閾値を上回れば new", () => {
    expect(classify(answer(0.8, 0.9), THRESHOLDS).verdict).toBe("new");
  });

  test("none 確率が 0.30 ちょうど・confidence が 0.55 ちょうどなら duplicate", () => {
    expect(classify(answer(0.3, 0.55), THRESHOLDS).verdict).toBe("duplicate");
  });

  test("none 確率が低くても confidence が閾値未満なら ambiguous", () => {
    expect(classify(answer(0.1, 0.54), THRESHOLDS).verdict).toBe("ambiguous");
  });

  test("none 確率が 0.30 と 0.45 の間なら ambiguous", () => {
    expect(classify(answer(0.44, 0.99), THRESHOLDS).verdict).toBe("ambiguous");
  });

  test("none 確率と confidence をそのまま返す", () => {
    const result = classify(answer(0.12, 0.77), THRESHOLDS);
    expect(result.noneProbability).toBeCloseTo(0.12);
    expect(result.confidence).toBeCloseTo(0.77);
  });

  test("none が probabilities に無ければ 0 とみなす", () => {
    const withoutNone: ChoiceAnswer = {
      type: "choice",
      choice: "a-slug",
      confidence: 0.9,
      probabilities: { "a-slug": 0.9 },
    };
    const result = classify(withoutNone, THRESHOLDS);
    expect(result.noneProbability).toBe(0);
    expect(result.verdict).toBe("duplicate");
  });

  test("top は none を除いた確率降順で、閾値未満を落とす", () => {
    const result = classify(
      answer(0.1, 0.9, { low: 0.019, mid: 0.2, high: 0.5, edge: 0.02 }),
      THRESHOLDS,
    );
    expect(result.top.map((item) => item.slug)).toEqual(["high", "mid", "edge"]);
    expect(result.top.some((item) => item.slug === NONE_KEY)).toBe(false);
  });

  test("top は maxCandidates 件までに切り詰める", () => {
    const result = classify(
      answer(0.05, 0.9, { a: 0.5, b: 0.4, c: 0.3, d: 0.2, e: 0.1 }),
      THRESHOLDS,
    );
    expect(result.top).toHaveLength(THRESHOLDS.maxCandidates);
    expect(result.top.map((item) => item.slug)).toEqual(["a", "b", "c"]);
  });

  test("閾値以上の候補が無ければ top は空になる", () => {
    const result = classify(answer(0.99, 0.9, { a: 0.005 }), THRESHOLDS);
    expect(result.top).toEqual([]);
  });
});

const ENTRIES = [
  { slug: "a-slug", title: "A の記憶" },
  { slug: "b-slug", title: "B の記憶" },
];

function respondWith(payload: unknown): FetchLike {
  return async () => new Response(JSON.stringify(payload), { status: 200 });
}

describe("checkDuplicates", () => {
  test("候補ごとに 1 リクエストを投げ、判定を並べて返す", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init.body));
      const title = body.state.candidate_title;
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            [chunkKey(0)]: {
              type: "choice",
              choice: title === "重複する記憶" ? "a-slug" : NONE_KEY,
              confidence: 0.9,
              probabilities:
                title === "重複する記憶"
                  ? { "a-slug": 0.9, [NONE_KEY]: 0.1 }
                  : { "a-slug": 0.1, [NONE_KEY]: 0.9 },
            },
          },
        }),
        { status: 200 },
      );
    };

    const outcome = await checkDuplicates(["重複する記憶", "新しい記憶"], ENTRIES, {
      apiKey: "sk-test",
      fetchImpl,
    });

    expect(calls).toBe(2);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]?.candidate).toBe("重複する記憶");
    expect(outcome.results[0]?.verdict).toBe("duplicate");
    expect(outcome.results[0]?.top[0]?.slug).toBe("a-slug");
    expect(outcome.results[1]?.verdict).toBe("new");
  });

  test("1 件でも API が失敗したら全体を unavailable にする", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            model: "jev-latest",
            answers: {
              [chunkKey(0)]: {
                type: "choice",
                choice: NONE_KEY,
                confidence: 0.9,
                probabilities: { [NONE_KEY]: 0.9 },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 502 });
    };

    const outcome = await checkDuplicates(["x", "y"], ENTRIES, { apiKey: "sk-test", fetchImpl });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("http-502");
  });

  test("接続失敗は reason=network の unavailable になる", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const outcome = await checkDuplicates(["x"], ENTRIES, { apiKey: "sk-test", fetchImpl });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("network");
  });

  test("塊の答えが 1 つでも欠けたら invalid-response の unavailable になる", async () => {
    const outcome = await checkDuplicates(["x"], ENTRIES, {
      apiKey: "sk-test",
      fetchImpl: respondWith({ model: "jev-latest", answers: {} }),
    });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("invalid-response");
  });

  test("塊が複数でもリクエストは 1 回で、塊をまたいだ判定に統合する", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body.questions)).toEqual([chunkKey(0), chunkKey(1), chunkKey(2)]);
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            // 重複を含まない塊は none がほぼ 1.0 になる
            [chunkKey(0)]: {
              type: "choice",
              choice: NONE_KEY,
              confidence: 0.95,
              probabilities: { "slug-0": 0.01, [NONE_KEY]: 0.97 },
            },
            [chunkKey(1)]: {
              type: "choice",
              choice: "slug-7",
              confidence: 0.72,
              probabilities: { "slug-7": 0.8, "slug-6": 0.05, [NONE_KEY]: 0.11 },
            },
            [chunkKey(2)]: {
              type: "choice",
              choice: NONE_KEY,
              confidence: 0.9,
              probabilities: { "slug-10": 0.03, [NONE_KEY]: 0.92 },
            },
          },
        }),
        { status: 200 },
      );
    };

    const outcome = await checkDuplicates(["新しい記憶"], manyEntries(12), {
      apiKey: "sk-test",
      fetchImpl,
      maxCriteriaPerQuestion: 5,
    });

    expect(calls).toBe(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const result = outcome.results[0];
    expect(result?.verdict).toBe("duplicate");
    expect(result?.noneProbability).toBeCloseTo(0.11);
    expect(result?.confidence).toBeCloseTo(0.72);
    expect(result?.top.map((item) => item.slug)).toEqual(["slug-7", "slug-6", "slug-10"]);
  });

  test("候補が空なら結果も空で ok", async () => {
    const outcome = await checkDuplicates([], ENTRIES, {
      apiKey: "sk-test",
      fetchImpl: respondWith({ model: "jev-latest", answers: {} }),
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.results).toEqual([]);
  });
});
