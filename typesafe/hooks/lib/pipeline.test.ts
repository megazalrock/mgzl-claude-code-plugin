import { describe, expect, test } from "bun:test";
import type { FetchLike, SystemOneResponse } from "./jev.ts";
import type { RosterEntry } from "./roster.ts";
import { NONE_KEY, PROMPT_FRAMING, SHORTLIST, suggest, TOOL_FRAMING } from "./pipeline.ts";

const ROSTER: RosterEntry[] = [
  {
    name: "mgzl:commiting-to-git",
    description: "差分を分析しコミットメッセージを生成してコミットする",
    body: "コミット手順の本文。",
    path: "/tmp/a/SKILL.md",
  },
  {
    name: "reviewview:reviewview-prepare",
    description: "レビュー結果を人間にトリアージ依頼する",
    body: "トリアージ依頼の本文。",
    path: "/tmp/b/SKILL.md",
  },
  {
    name: "fading-memory:remember",
    description: "セッションの内容から記憶を作成する",
    body: "記憶作成の本文。",
    path: "/tmp/c/SKILL.md",
  },
  {
    name: "superpowers:writing-plans",
    description: "仕様から実装計画を書く",
    body: "計画作成の本文。",
    path: "/tmp/d/SKILL.md",
  },
];

type Body = { model: string; state: Record<string, string>; questions: Record<string, unknown> };

function queuedFetch(responses: SystemOneResponse[]): {
  fetchImpl: FetchLike;
  bodies: Body[];
} {
  const bodies: Body[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const response = responses[index++];
    if (response === undefined) throw new Error("予定外の fetch 呼び出し");
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, bodies };
}

function answer(choice: string, probabilities: Record<string, number>): SystemOneResponse {
  return {
    model: "jev-latest",
    answers: {
      which: { type: "choice", choice, confidence: 0.6, probabilities },
    },
  };
}

const OPTIONS = { apiKey: "sk-test", baseUrl: "http://127.0.0.1:9", model: "jev-latest" };

describe("suggest", () => {
  test("none が選ばれたら no_fit で winner は null", async () => {
    const { fetchImpl } = queuedFetch([
      answer(NONE_KEY, { none: 0.72, "mgzl:commiting-to-git": 0.18, "fading-memory:remember": 0.1 }),
    ]);
    const result = await suggest("モナドとは何ですか", ROSTER, { ...OPTIONS, fetchImpl });

    expect(result.outcome).toBe("no_fit");
    expect(result.winner).toBeNull();
    expect(result.noneProbability).toBe(0.72);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("スキルが選ばれたら suggested でその名前が勝者になる", async () => {
    const { fetchImpl } = queuedFetch([
      answer("reviewview:reviewview-prepare", {
        "reviewview:reviewview-prepare": 0.81,
        none: 0.09,
        "mgzl:commiting-to-git": 0.07,
        "fading-memory:remember": 0.03,
      }),
    ]);
    const result = await suggest("レビュー結果をトリアージに回して", ROSTER, {
      ...OPTIONS,
      fetchImpl,
    });

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("reviewview:reviewview-prepare");
    expect(result.noneProbability).toBe(0.09);
  });

  test("API 呼び出しはちょうど 1 回で、roster 全件と none を criteria に載せる", async () => {
    const onCalls: number[] = [];
    const { fetchImpl, bodies } = queuedFetch([
      answer("mgzl:commiting-to-git", { "mgzl:commiting-to-git": 0.8, none: 0.2 }),
    ]);
    await suggest("この変更をコミットして", ROSTER, {
      ...OPTIONS,
      fetchImpl,
      onCall: () => onCalls.push(1),
    });

    expect(bodies).toHaveLength(1);
    expect(onCalls).toHaveLength(1);
    const body = bodies[0];
    expect(body?.state).toEqual({ request: "この変更をコミットして", recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual(["which"]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Which of these skills, if any, is the right one to load to help with the user's latest request?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
        none: "None of the listed skills applies. The request can be handled directly without loading any skill.",
      },
    });
  });

  test("shortlist は none を除いた確率上位 3 件", async () => {
    const { fetchImpl } = queuedFetch([
      answer("mgzl:commiting-to-git", {
        none: 0.95,
        "mgzl:commiting-to-git": 0.02,
        "reviewview:reviewview-prepare": 0.015,
        "fading-memory:remember": 0.01,
        "superpowers:writing-plans": 0.005,
      }),
    ]);
    const result = await suggest("x", ROSTER, { ...OPTIONS, fetchImpl });

    expect(result.shortlist).toHaveLength(SHORTLIST);
    expect(result.shortlist).toEqual([
      { name: "mgzl:commiting-to-git", probability: 0.02 },
      { name: "reviewview:reviewview-prepare", probability: 0.015 },
      { name: "fading-memory:remember", probability: 0.01 },
    ]);
  });

  test("none にも roster にも無い名前を選んだら例外にする", async () => {
    const { fetchImpl } = queuedFetch([answer("unknown:skill", { "unknown:skill": 0.9 })]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev chose 'unknown:skill' which is not in the roster",
    );
  });

  test("which の答えが欠けていたら例外にする", async () => {
    const { fetchImpl } = queuedFetch([{ model: "jev-latest", answers: {} }]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev did not answer the 'which' choice question",
    );
  });

  test("roster に none という名前があれば API を呼ぶ前に例外にする", async () => {
    const { fetchImpl, bodies } = queuedFetch([]);
    const roster: RosterEntry[] = [
      ...ROSTER,
      { name: "none", description: "紛らわしい名前のスキル", body: "本文。", path: "/tmp/e/SKILL.md" },
    ];
    await expect(suggest("x", roster, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "A roster entry is named 'none', which collides with the none option",
    );
    expect(bodies).toHaveLength(0);
  });

  test("framing を省略すると PROMPT_FRAMING と同じ質問が送られる", async () => {
    const { fetchImpl: implA, bodies: bodiesA } = queuedFetch([
      answer(NONE_KEY, { none: 0.5, "mgzl:commiting-to-git": 0.5 }),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implA });

    const { fetchImpl: implB, bodies: bodiesB } = queuedFetch([
      answer(NONE_KEY, { none: 0.5, "mgzl:commiting-to-git": 0.5 }),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implB }, PROMPT_FRAMING);

    expect(bodiesA[0]).toEqual(bodiesB[0]);
  });

  test("TOOL_FRAMING は行為向けの instructions と none の説明文になる", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      answer("mgzl:commiting-to-git", { "mgzl:commiting-to-git": 0.9, none: 0.1 }),
    ]);
    const request =
      'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"';
    const result = await suggest(request, ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING);

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("mgzl:commiting-to-git");

    const body = bodies[0];
    expect(body?.state).toEqual({ request, recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual(["which"]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
        none: "None of the listed skills documents a procedure for this action. It can be done directly.",
      },
    });
  });

  test("probabilities に none が無ければ noneProbability は 0 になる", async () => {
    const { fetchImpl } = queuedFetch([
      answer("mgzl:commiting-to-git", { "mgzl:commiting-to-git": 1 }),
    ]);
    const result = await suggest("x", ROSTER, { ...OPTIONS, fetchImpl });
    expect(result.noneProbability).toBe(0);
  });
});
