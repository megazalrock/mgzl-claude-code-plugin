import { describe, expect, test } from "bun:test";
import type { FetchLike, SystemOneResponse } from "./jev.ts";
import type { RosterEntry } from "./roster.ts";
import {
  FITS_THRESHOLD,
  GATE_THRESHOLD,
  PROMPT_FRAMING,
  SHORTLIST,
  suggest,
  TOOL_FRAMING,
} from "./pipeline.ts";

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

function call1(gate: [number, number, number], probabilities: Record<string, number>, choice: string): SystemOneResponse {
  return {
    model: "jev-latest",
    answers: {
      which: { type: "choice", choice, confidence: 0.6, probabilities },
      "gate::acts_on_user_system": { type: "noul", noul: gate[0] },
      "gate::would_follow_documented_procedure": { type: "noul", noul: gate[1] },
      "gate::prose_suffices": { type: "noul", noul: gate[2] },
    },
  };
}

const OPTIONS = { apiKey: "sk-test", baseUrl: "http://127.0.0.1:9", model: "jev-latest" };

describe("suggest", () => {
  test("gate が閾値未満なら gate_quiet で終わり Call 2 を呼ばない", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    const result = await suggest("モナドとは何ですか", ROSTER, { ...OPTIONS, fetchImpl });

    expect(result.outcome).toBe("gate_quiet");
    expect(result.winner).toBeNull();
    // gate で黙っても Call 1 の上位候補は評価用に残す（rerank / fits は無い）
    expect(result.shortlist).toEqual([{ name: "mgzl:commiting-to-git", wideProbability: 0.4 }]);
    expect(result.gate.mean).toBeCloseTo((0.1 + 0.1 + (1 - 0.9)) / 3, 10);
    expect(result.gate.mean).toBeLessThan(GATE_THRESHOLD);
    // 反転前の生の noul を key ごとに残す
    expect(result.gate.scores).toEqual({
      "gate::acts_on_user_system": 0.1,
      "gate::would_follow_documented_procedure": 0.1,
      "gate::prose_suffices": 0.9,
    });
    expect(bodies).toHaveLength(1);
  });

  test("Call 1 は全件を description で問い、gate 3 問を同じリクエストに載せる", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl });

    const body = bodies[0];
    expect(body?.state).toEqual({ request: "この変更をコミットして", recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual([
      "which",
      "gate::acts_on_user_system",
      "gate::would_follow_documented_procedure",
      "gate::prose_suffices",
    ]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Which of these skills, if any, is the right one to load to help with the user's latest request?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
      },
    });
    expect(body?.questions["gate::acts_on_user_system"]).toEqual({
      type: "noul",
      instructions:
        "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?",
    });
    expect(body?.questions["gate::would_follow_documented_procedure"]).toEqual({
      type: "noul",
      instructions:
        "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?",
    });
    expect(body?.questions["gate::prose_suffices"]).toEqual({
      type: "noul",
      instructions:
        "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
    });
  });

  test("fits の最大値が閾値未満なら no_fit", async () => {
    const { fetchImpl } = queuedFetch([
      call1(
        [0.9, 0.9, 0.1],
        {
          "mgzl:commiting-to-git": 0.5,
          "reviewview:reviewview-prepare": 0.3,
          "fading-memory:remember": 0.15,
          "superpowers:writing-plans": 0.05,
        },
        "mgzl:commiting-to-git",
      ),
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.4,
            probabilities: {
              "mgzl:commiting-to-git": 0.6,
              "reviewview:reviewview-prepare": 0.3,
              "fading-memory:remember": 0.1,
            },
          },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.2 },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.1 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.05 },
        },
      },
    ]);

    const result = await suggest("Slack にこの結果を投稿して", ROSTER, { ...OPTIONS, fetchImpl });
    expect(result.outcome).toBe("no_fit");
    expect(result.winner).toBeNull();
    expect(result.shortlist).toHaveLength(SHORTLIST);
    expect(Math.max(...result.shortlist.map((item) => item.fits ?? 0))).toBeLessThan(FITS_THRESHOLD);
  });

  test("fits が閾値以上なら Call 2 の choice を勝者にする", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1(
        [0.9, 0.8, 0.1],
        {
          "mgzl:commiting-to-git": 0.2,
          "reviewview:reviewview-prepare": 0.5,
          "fading-memory:remember": 0.2,
          "superpowers:writing-plans": 0.1,
        },
        "reviewview:reviewview-prepare",
      ),
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "reviewview:reviewview-prepare",
            confidence: 0.87,
            probabilities: {
              "reviewview:reviewview-prepare": 0.8,
              "mgzl:commiting-to-git": 0.15,
              "fading-memory:remember": 0.05,
            },
          },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.91 },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.12 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.04 },
        },
      },
    ]);

    const result = await suggest(
      "このブランチのレビュー結果をトリアージに回して",
      ROSTER,
      { ...OPTIONS, fetchImpl },
    );

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("reviewview:reviewview-prepare");
    expect(result.rerankConfidence).toBe(0.87);
    expect(result.shortlist.map((item) => item.name)).toEqual([
      "reviewview:reviewview-prepare",
      "mgzl:commiting-to-git",
      "fading-memory:remember",
    ]);
    expect(result.shortlist[0]?.wideProbability).toBe(0.5);
    expect(result.shortlist[0]?.rerankProbability).toBe(0.8);
    expect(result.shortlist[0]?.fits).toBe(0.91);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const body = bodies[1];
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.",
      criteria: {
        "reviewview:reviewview-prepare":
          "レビュー結果を人間にトリアージ依頼する — トリアージ依頼の本文。",
        "mgzl:commiting-to-git":
          "差分を分析しコミットメッセージを生成してコミットする — コミット手順の本文。",
        "fading-memory:remember": "セッションの内容から記憶を作成する — 記憶作成の本文。",
      },
    });
    expect(body?.questions["fits::reviewview:reviewview-prepare"]).toEqual({
      type: "noul",
      instructions:
        "Does the skill 'reviewview:reviewview-prepare' do the specific thing the user's request asks for? It is described as: レビュー結果を人間にトリアージ依頼する",
    });
  });

  test("which の答えが欠けていたら例外にする", async () => {
    const { fetchImpl } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          "gate::acts_on_user_system": { type: "noul", noul: 0.9 },
          "gate::would_follow_documented_procedure": { type: "noul", noul: 0.9 },
          "gate::prose_suffices": { type: "noul", noul: 0.1 },
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev did not answer the 'which' choice question (call 1)",
    );
  });

  test("gate の Noul 回答が欠けていたら例外にし Call 2 は呼ばない", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.6,
            probabilities: { "mgzl:commiting-to-git": 0.4 },
          },
          "gate::acts_on_user_system": { type: "noul", noul: 0.9 },
          "gate::would_follow_documented_procedure": { type: "noul", noul: 0.9 },
          // gate::prose_suffices が欠落
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev did not answer the noul question 'gate::prose_suffices'",
    );
    expect(bodies).toHaveLength(1);
  });

  test("Call 2 の choice がショートリスト外なら例外にする", async () => {
    const { fetchImpl } = queuedFetch([
      call1(
        [0.9, 0.8, 0.1],
        {
          "mgzl:commiting-to-git": 0.5,
          "reviewview:reviewview-prepare": 0.3,
          "fading-memory:remember": 0.2,
        },
        "mgzl:commiting-to-git",
      ),
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "superpowers:writing-plans", // ショートリストに入っていない候補
            confidence: 0.5,
            probabilities: { "superpowers:writing-plans": 0.5 },
          },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.9 },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.1 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.05 },
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev chose 'superpowers:writing-plans' which is not in the shortlist",
    );
  });

  test("Call 1 の probabilities が roster に無い名前しか含まなければ例外にし Call 2 は呼ばない", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1([0.9, 0.9, 0.1], { "unknown:skill": 0.9 }, "unknown:skill"),
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev ranked no roster entry in call 1",
    );
    expect(bodies).toHaveLength(1);
  });

  test("framing を省略すると PROMPT_FRAMING と同じ質問が送られる（後方互換）", async () => {
    const { fetchImpl: implA, bodies: bodiesA } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implA });

    const { fetchImpl: implB, bodies: bodiesB } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implB }, PROMPT_FRAMING);

    expect(bodiesA[0]).toEqual(bodiesB[0]);
  });

  test("TOOL_FRAMING の Call 1 は行為向けの which と gate 1 問になる", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.6,
            probabilities: { "mgzl:commiting-to-git": 0.4 },
          },
          "gate::routine_step": { type: "noul", noul: 0.9 },
        },
      },
    ]);
    const request =
      'The assistant is about to perform this action:\nList files\nls typesafe/hooks';
    const result = await suggest(request, ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING);

    const body = bodies[0];
    expect(body?.state).toEqual({ request, recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual(["which", "gate::routine_step"]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
      },
    });
    expect(body?.questions["gate::routine_step"]).toEqual({
      type: "noul",
      instructions:
        "Is this action a routine inspection step, such as listing, reading, or checking state, that any careful assistant would do without consulting a documented procedure?",
    });
    // invert: true なので 0.9 は 0.1 として平均に入り、閾値 0.3 を下回る
    expect(result.gate.mean).toBeCloseTo(0.1, 10);
    expect(result.gate.scores).toEqual({ "gate::routine_step": 0.9 });
    expect(result.outcome).toBe("gate_quiet");
    expect(bodies).toHaveLength(1);
  });

  test("TOOL_FRAMING の gate が低ければ Call 2 に進み、行為向けの文言で問う", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.7,
            probabilities: {
              "mgzl:commiting-to-git": 0.6,
              "reviewview:reviewview-prepare": 0.2,
              "fading-memory:remember": 0.1,
              "superpowers:writing-plans": 0.1,
            },
          },
          "gate::routine_step": { type: "noul", noul: 0.05 },
        },
      },
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.92,
            probabilities: {
              "mgzl:commiting-to-git": 0.9,
              "reviewview:reviewview-prepare": 0.07,
              "fading-memory:remember": 0.03,
            },
          },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.88 },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.05 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.02 },
        },
      },
    ]);
    const request =
      'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"';
    const result = await suggest(request, ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING);

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("mgzl:commiting-to-git");
    expect(result.gate.mean).toBeCloseTo(0.95, 10);

    const body = bodies[1];
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Exactly one of these skills documents the procedure for the action the assistant is about to take. Which one? Read what each actually does, not just its name.",
      criteria: {
        "mgzl:commiting-to-git":
          "差分を分析しコミットメッセージを生成してコミットする — コミット手順の本文。",
        "reviewview:reviewview-prepare":
          "レビュー結果を人間にトリアージ依頼する — トリアージ依頼の本文。",
        "fading-memory:remember": "セッションの内容から記憶を作成する — 記憶作成の本文。",
      },
    });
    expect(body?.questions["fits::mgzl:commiting-to-git"]).toEqual({
      type: "noul",
      instructions:
        "Does the skill 'mgzl:commiting-to-git' actually cover the action the assistant is about to take, rather than a merely similar topic? It is described as: 差分を分析しコミットメッセージを生成してコミットする",
    });
  });

  test("TOOL_FRAMING で gate の Noul 回答が欠けていたら例外にする", async () => {
    const { fetchImpl } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.6,
            probabilities: { "mgzl:commiting-to-git": 0.4 },
          },
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING)).rejects.toThrow(
      "Jev did not answer the noul question 'gate::routine_step'",
    );
  });
});
