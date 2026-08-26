import { describe, expect, test } from "bun:test";
import { dataPaths, projectSlug } from "./paths.ts";

describe("projectSlug", () => {
  test("パス区切りとドットを - に置換する", () => {
    expect(projectSlug("/Users/otto/work.space/foo")).toBe("-Users-otto-work-space-foo");
  });
});

describe("dataPaths", () => {
  test("home 配下の .claude/fading-memory/<slug>/ を指す", () => {
    const p = dataPaths("/proj/a", "/home/u");
    expect(p.root).toBe("/home/u/.claude/fading-memory/-proj-a");
    expect(p.memoriesDir).toBe("/home/u/.claude/fading-memory/-proj-a/memories");
    expect(p.trashDir).toBe("/home/u/.claude/fading-memory/-proj-a/trash");
    expect(p.indexFile).toBe("/home/u/.claude/fading-memory/-proj-a/INDEX.md");
    expect(p.stateFile).toBe("/home/u/.claude/fading-memory/-proj-a/state.json");
    expect(p.errorLog).toBe("/home/u/.claude/fading-memory/-proj-a/error.log");
  });
});
