import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemory } from "./frontmatter.ts";
import { saveManualMemories } from "./manual-save.ts";

const originalDir = process.env["FADING_MEMORY_DIR"];

// saveManualMemories は内部で dataPaths を呼ぶため、保存先の差し替えは環境変数経由になる
function setup(): string {
  const root = mkdtempSync(join(tmpdir(), "fading-manual-"));
  process.env["FADING_MEMORY_DIR"] = root;
  return root;
}

afterEach(() => {
  if (originalDir === undefined) delete process.env["FADING_MEMORY_DIR"];
  else process.env["FADING_MEMORY_DIR"] = originalDir;
});

describe("saveManualMemories", () => {
  test("JSON でない入力は invalid-json で失敗する", () => {
    setup();
    expect(saveManualMemories("/proj", "not json", { permanent: false })).toEqual({
      exitCode: 1,
      lines: ["error=invalid-json"],
    });
  });

  test("形の合わない入力は invalid-input で失敗する", () => {
    setup();
    expect(saveManualMemories("/proj", "[]", { permanent: false })).toEqual({
      exitCode: 1,
      lines: ["error=invalid-input"],
    });
  });

  test("permanent: false で保存し、目次を再生成する", () => {
    const root = setup();
    const result = saveManualMemories(
      "/proj",
      JSON.stringify({
        newMemories: [{ slug: "note-one", title: "t", body: "b" }],
        updatedMemories: [{ slug: "missing", body: "x" }],
      }),
      { permanent: false },
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["created=note-one", "skipped=missing"]);

    const doc = parseMemory(readFileSync(join(root, "memories", "note-one.md"), "utf8"));
    expect(doc?.meta.permanent).toBe(false);
    expect(doc?.meta.origin).toBe("manual");
    expect(readFileSync(join(root, "INDEX.md"), "utf8")).toContain("note-one");
  });

  test("permanent: true で保存すると permanent な記憶になる", () => {
    const root = setup();
    const result = saveManualMemories(
      "/proj",
      JSON.stringify({ newMemories: [{ slug: "note-two", title: "t", body: "b" }], updatedMemories: [] }),
      { permanent: true },
    );
    expect(result.exitCode).toBe(0);

    const doc = parseMemory(readFileSync(join(root, "memories", "note-two.md"), "utf8"));
    expect(doc?.meta.permanent).toBe(true);
  });

  test("usefulMemorySlugs が入力に含まれても加点しない", () => {
    const root = setup();
    saveManualMemories(
      "/proj",
      JSON.stringify({ newMemories: [{ slug: "note-three", title: "t", body: "b" }], updatedMemories: [] }),
      { permanent: false },
    );
    const result = saveManualMemories(
      "/proj",
      JSON.stringify({ newMemories: [], updatedMemories: [], usefulMemorySlugs: ["note-three"] }),
      { permanent: false },
    );
    expect(result.lines).toEqual([]);

    const doc = parseMemory(readFileSync(join(root, "memories", "note-three.md"), "utf8"));
    expect(doc?.meta.score).toBe(0);
  });
});
