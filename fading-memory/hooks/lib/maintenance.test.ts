import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeMemory } from "./frontmatter.ts";
import { ensureDirs, loadMemories, purgeTrash } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-26T00:00:00.000Z");

function setup() {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  const paths = dataPaths("/proj", home);
  ensureDirs(paths);
  return paths;
}

function writeMemory(dir: string, slug: string, createdMs: number) {
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
        permanent: false,
        origin: "auto",
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
