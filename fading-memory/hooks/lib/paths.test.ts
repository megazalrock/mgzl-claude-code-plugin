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

describe("dataPaths (FADING_MEMORY_DIR)", () => {
  test("未設定なら従来の home 配下を使う", () => {
    const p = dataPaths("/proj/a", "/home/u", {});
    expect(p.root).toBe("/home/u/.claude/fading-memory/-proj-a");
  });

  test("空文字・空白のみなら従来の home 配下を使う", () => {
    expect(dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "" }).root).toBe(
      "/home/u/.claude/fading-memory/-proj-a",
    );
    expect(dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "   " }).root).toBe(
      "/home/u/.claude/fading-memory/-proj-a",
    );
  });

  test("~/ 始まりは home に展開する", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "~/mem/store" });
    expect(p.root).toBe("/home/u/mem/store");
  });

  test("~ 単体は home そのものになる", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "~" });
    expect(p.root).toBe("/home/u");
  });

  test("絶対パスはそのまま使う", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "/var/data/fm" });
    expect(p.root).toBe("/var/data/fm");
  });

  test("相対パスは projectDir 基準で解決する", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: ".claude/fading-memory" });
    expect(p.root).toBe("/proj/a/.claude/fading-memory");
  });

  test("パスを正規化する", () => {
    expect(dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "/var//data/../data/fm/" }).root).toBe(
      "/var/data/fm",
    );
    expect(dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "./sub/../.claude/fm" }).root).toBe(
      "/proj/a/.claude/fm",
    );
    expect(dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "~//mem//store/" }).root).toBe(
      "/home/u/mem/store",
    );
  });

  test("前後の空白を無視する", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "  /var/data/fm  " });
    expect(p.root).toBe("/var/data/fm");
  });

  test("指定した root 直下にプロジェクトスラッグを挟まない", () => {
    const p = dataPaths("/proj/a", "/home/u", { FADING_MEMORY_DIR: "/var/data/fm" });
    expect(p.root).toBe("/var/data/fm");
    expect(p.root).not.toContain(projectSlug("/proj/a"));
    expect(p.memoriesDir).toBe("/var/data/fm/memories");
    expect(p.trashDir).toBe("/var/data/fm/trash");
    expect(p.indexFile).toBe("/var/data/fm/INDEX.md");
    expect(p.stateFile).toBe("/var/data/fm/state.json");
    expect(p.errorLog).toBe("/var/data/fm/error.log");
  });
});
