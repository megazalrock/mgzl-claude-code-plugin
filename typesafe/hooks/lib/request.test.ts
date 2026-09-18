import { describe, expect, test } from "bun:test";
import { buildToolRequest, TOOL_INPUT_CHARS } from "./request.ts";

describe("buildToolRequest", () => {
  test("Bash は description と command を行で並べる", () => {
    expect(
      buildToolRequest({
        toolName: "Bash",
        toolInput: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
      }),
    ).toBe(
      'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
    );
  });

  test("Agent は description と prompt を行で並べる", () => {
    expect(
      buildToolRequest({
        toolName: "Agent",
        toolInput: {
          description: "Write the implementation plan",
          prompt: "設計書から実装計画を書いてください",
          subagent_type: "general-purpose",
        },
      }),
    ).toBe(
      "The assistant is about to perform this action:\nWrite the implementation plan\n設計書から実装計画を書いてください",
    );
  });

  test("description が無ければその行を省く", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { command: "ls typesafe/hooks" } })).toBe(
      "The assistant is about to perform this action:\nls typesafe/hooks",
    );
  });

  test("description が空文字でもその行を省く", () => {
    expect(
      buildToolRequest({ toolName: "Bash", toolInput: { description: "", command: "ls" } }),
    ).toBe("The assistant is about to perform this action:\nls");
  });

  test("description が文字列でなければその行を省く", () => {
    expect(
      buildToolRequest({ toolName: "Bash", toolInput: { description: 42, command: "ls" } }),
    ).toBe("The assistant is about to perform this action:\nls");
  });

  test("body は TOOL_INPUT_CHARS で切り詰める", () => {
    const long = "a".repeat(TOOL_INPUT_CHARS + 500);
    const built = buildToolRequest({ toolName: "Agent", toolInput: { prompt: long } });
    expect(built).toBe(`The assistant is about to perform this action:\n${"a".repeat(TOOL_INPUT_CHARS)}`);
  });

  test("TOOL_INPUT_CHARS は 2000", () => {
    expect(TOOL_INPUT_CHARS).toBe(2000);
  });

  test("Bash で command が無ければ undefined", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { description: "何かする" } })).toBeUndefined();
  });

  test("Agent で prompt が無ければ undefined", () => {
    expect(buildToolRequest({ toolName: "Agent", toolInput: { description: "何かする" } })).toBeUndefined();
  });

  test("command が空文字なら undefined", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { command: "" } })).toBeUndefined();
  });

  test("対象外のツール名なら undefined", () => {
    expect(
      buildToolRequest({ toolName: "Edit", toolInput: { file_path: "/x", old_string: "a", new_string: "b" } }),
    ).toBeUndefined();
  });
});
