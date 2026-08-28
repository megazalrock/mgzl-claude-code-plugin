import { describe, expect, test } from "bun:test";
import { memoryDir, projectSlug } from "./paths.ts";

describe("projectSlug", () => {
  test("英数字以外の文字をすべて - に置換する", () => {
    expect(projectSlug("/Users/otto/.config/herdr")).toBe("-Users-otto--config-herdr");
  });

  test("ハイフンはそのまま残る", () => {
    expect(projectSlug("/Users/otto/workspace/mgzl-claude-code-plugin")).toBe(
      "-Users-otto-workspace-mgzl-claude-code-plugin",
    );
  });
});

describe("memoryDir", () => {
  test("home 配下の .claude/projects/<slug>/memory を指す", () => {
    expect(memoryDir("/proj/a", "/home/u")).toBe("/home/u/.claude/projects/-proj-a/memory");
  });
});
