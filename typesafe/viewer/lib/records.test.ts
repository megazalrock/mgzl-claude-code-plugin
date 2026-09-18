import { describe, expect, test } from "bun:test";
import { toViewRecord } from "./records.ts";

/** 実ログと同じ形の suggested レコード。criteria は表示に不要なので 2 件に省いてある */
const SUGGESTED = JSON.stringify({
  ts: "2026-09-18T10:56:20.705Z",
  session_id: "113c9a46",
  cwd: "/Users/otto/workspace/mgzl-claude-code-plugin",
  event: "PreToolUse",
  tool_name: "Bash",
  prompt: "The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m \"fix\"",
  outcome: "suggested",
  winner: "mgzl:commiting-to-git",
  noneProbability: 0.03,
  shortlist: [{ name: "mgzl:commiting-to-git", probability: 0.86 }],
  calls: [
    {
      url: "https://api.typesafe.ai/v1/systemone",
      request: {
        model: "jev-latest",
        state: { request: "…", recent_context: "" },
        questions: {
          which: {
            type: "choice",
            instructions: "Which skill?",
            criteria: { "mgzl:commiting-to-git": "…", none: "…" },
          },
        },
      },
      response: {
        status: 200,
        body: {
          model: "jev-1.13.0",
          answers: {
            which: {
              type: "choice",
              choice: "mgzl:commiting-to-git",
              confidence: 0.85,
              probabilities: {
                "mgzl:commiting-to-git": 0.86,
                "superpowers:verification-before-completion": 0.11,
                none: 0.03,
                "fading-memory:list": 0,
                "nap:create-issue": 0,
              },
            },
          },
          usage: { input_tokens: 5074, output_tokens: 711 },
        },
      },
      elapsedMs: 661,
    },
  ],
  elapsedMs: 661,
  rosterSize: 47,
});

const SKIPPED = JSON.stringify({
  ts: "2026-09-18T13:44:46.451Z",
  session_id: "9dfad3e2",
  cwd: "/Users/otto/workspace/reviewview",
  event: "UserPromptSubmit",
  prompt: "/claude-api",
  outcome: "skipped",
  winner: null,
  noneProbability: null,
  shortlist: [],
  calls: [],
  elapsedMs: 0,
  rosterSize: 0,
});

const ERROR = JSON.stringify({
  ts: "2026-09-18T13:50:00.000Z",
  session_id: "",
  cwd: "",
  event: "UserPromptSubmit",
  prompt: "",
  outcome: "error",
  winner: null,
  noneProbability: null,
  shortlist: [],
  calls: [],
  elapsedMs: 0,
  rosterSize: 0,
  error: "malformed stdin payload",
});

const NO_RESPONSE = JSON.stringify({
  ts: "2026-09-18T14:00:00.000Z",
  session_id: "s",
  cwd: "/tmp",
  event: "PreToolUse",
  tool_name: "Agent",
  agent_type: "Explore",
  prompt: "The assistant is about to perform this action:\nsearch",
  outcome: "no_fit",
  winner: null,
  noneProbability: 0.9,
  shortlist: [],
  calls: [{ url: "https://api.typesafe.ai/v1/systemone", request: { model: "jev-latest", state: {}, questions: {} }, response: null, error: "timeout", elapsedMs: 3000 }],
  elapsedMs: 3000,
  rosterSize: 45,
});

describe("toViewRecord", () => {
  test("suggested: 非ゼロの確率だけを降順に並べ none も含める", () => {
    const view = toViewRecord(SUGGESTED);
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.event).toBe("PreToolUse:Bash");
    expect(view.winner).toBe("mgzl:commiting-to-git");
    expect(view.ranking).toEqual([
      { name: "mgzl:commiting-to-git", probability: 0.86 },
      { name: "superpowers:verification-before-completion", probability: 0.11 },
      { name: "none", probability: 0.03 },
    ]);
    expect(view.confidence).toBe(0.85);
    expect(view.model).toBe("jev-1.13.0");
    expect(view.usage).toEqual({ input_tokens: 5074, output_tokens: 711 });
    expect(view.prompt).toContain("git commit");
    expect("shortlist" in view).toBe(false);
  });

  test("同率の候補は名前順に並ぶ", () => {
    const tie = JSON.parse(SUGGESTED);
    tie.calls[0].response.body.answers.which.probabilities = { b: 0.5, a: 0.5, none: 0 };
    const view = toViewRecord(JSON.stringify(tie));
    expect(view?.ranking.map((item) => item.name)).toEqual(["a", "b"]);
  });

  test("skipped: calls が空なら ranking は空配列で任意項目は省略される", () => {
    const view = toViewRecord(SKIPPED);
    expect(view?.event).toBe("UserPromptSubmit");
    expect(view?.ranking).toEqual([]);
    expect(view?.noneProbability).toBeNull();
    expect(view?.confidence).toBeUndefined();
    expect(view?.model).toBeUndefined();
    expect(view?.usage).toBeUndefined();
  });

  test("error: error フィールドを持ち越す", () => {
    const view = toViewRecord(ERROR);
    expect(view?.outcome).toBe("error");
    expect(view?.error).toBe("malformed stdin payload");
  });

  test("response が null でも落ちず agent_type を持ち越す", () => {
    const view = toViewRecord(NO_RESPONSE);
    expect(view?.event).toBe("PreToolUse:Agent");
    expect(view?.agent_type).toBe("Explore");
    expect(view?.ranking).toEqual([]);
  });

  test("JSON として読めない行は null", () => {
    expect(toViewRecord("{\"ts\":\"2026-")).toBeNull();
    expect(toViewRecord("")).toBeNull();
  });

  test("ts が文字列でない行は null", () => {
    expect(toViewRecord(JSON.stringify({ ts: 123, prompt: "x" }))).toBeNull();
    expect(toViewRecord(JSON.stringify([1, 2]))).toBeNull();
  });
});
