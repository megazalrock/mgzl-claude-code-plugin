import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeMemory } from "./frontmatter.ts";
import { ensureDirs, expireMemories, loadMemories, purgeTrash } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-26T00:00:00.000Z");

function setup() {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  const paths = dataPaths("/proj", home);
  ensureDirs(paths);
  return paths;
}

function writeMemory(dir: string, slug: string, createdMs: number, permanent = false) {
  const iso = new Date(createdMs).toISOString();
  writeFileSync(
    join(dir, `${slug}.md`),
    serializeMemory({
      meta: {
        title: slug,
        created: iso,
        updated: iso,
        lastReferenced: null,
        score: 0,
        permanent,
        related: [],
      },
      body: "b",
    }),
  );
}

describe("loadMemories", () => {
  test("正常なファイルと不正なファイルを分けて返す", () => {
    const paths = setup();
    writeMemory(paths.memoriesDir, "good", NOW);
    writeFileSync(join(paths.memoriesDir, "bad.md"), "frontmatter なし");
    const { memories, malformed } = loadMemories(paths);
    expect(memories.map((m) => m.slug)).toEqual(["good"]);
    expect(malformed).toEqual(["bad.md"]);
  });
});

describe("expireMemories", () => {
  test("期限切れだけを trash へ移動する", () => {
    const paths = setup();
    writeMemory(paths.memoriesDir, "old", NOW - 31 * DAY);
    writeMemory(paths.memoriesDir, "fresh", NOW - 1 * DAY);
    writeMemory(paths.memoriesDir, "keep", NOW - 400 * DAY, true);
    expect(expireMemories(paths, NOW)).toEqual(["old"]);
    expect(loadMemories(paths).memories.map((m) => m.slug).sort()).toEqual(["fresh", "keep"]);
    expect(existsSync(join(paths.trashDir, `${NOW}__old.md`))).toBe(true);
  });
});

describe("purgeTrash", () => {
  test("保持期間を過ぎたファイルだけ完全削除する", () => {
    const paths = setup();
    writeFileSync(join(paths.trashDir, `${NOW - 31 * DAY}__a.md`), "x");
    writeFileSync(join(paths.trashDir, `${NOW - 1 * DAY}__b.md`), "x");
    writeFileSync(join(paths.trashDir, "manual.md"), "x");
    expect(purgeTrash(paths, NOW)).toEqual([`${NOW - 31 * DAY}__a.md`]);
    expect(readdirSync(paths.trashDir).sort()).toEqual([`${NOW - 1 * DAY}__b.md`, "manual.md"]);
  });
});
