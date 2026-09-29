import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemory, serializeMemory, type MemoryMeta } from "./frontmatter.ts";
import { ensureDirs } from "./maintenance.ts";
import { dataPaths, type DataPaths } from "./paths.ts";
import { renameMemory } from "./rename.ts";

const OLD = "very-long-slug-that-should-be-shortened";
const NEW = "short-slug";

function setup(): DataPaths {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  // FADING_MEMORY_DIR が実行環境に設定されていても実データを触らないよう env は空で渡す
  const paths = dataPaths("/proj", home, {});
  ensureDirs(paths);
  return paths;
}

function writeMemory(paths: DataPaths, slug: string, meta: Partial<MemoryMeta>): void {
  writeFileSync(
    join(paths.memoriesDir, `${slug}.md`),
    serializeMemory({
      meta: {
        title: `${slug} の title`,
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-02-01T00:00:00.000Z",
        lastReferenced: null,
        score: 0,
        permanent: false,
        origin: "auto",
        related: [],
        ...meta,
      },
      body: `${slug} の本文`,
    }),
  );
}

function snapshot(paths: DataPaths): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(paths.memoriesDir).sort()) {
    files[name] = readFileSync(join(paths.memoriesDir, name), "utf8");
  }
  return files;
}

function readMeta(paths: DataPaths, slug: string): MemoryMeta {
  const doc = parseMemory(readFileSync(join(paths.memoriesDir, `${slug}.md`), "utf8"));
  if (doc === null) throw new Error(`parse failed: ${slug}`);
  return doc.meta;
}

describe("renameMemory", () => {
  test("ファイルを移し、退色した記憶を含む全記憶の related を書き換え、寿命と日時には触れない", () => {
    const paths = setup();
    writeMemory(paths, OLD, {
      score: 3,
      lastReferenced: "2026-03-01T00:00:00.000Z",
      related: ["active"],
    });
    writeMemory(paths, "active", {
      score: 1,
      lastReferenced: "2026-09-20T00:00:00.000Z",
      updated: "2026-09-10T00:00:00.000Z",
      related: [OLD, "unrelated"],
    });
    // 2025 年作成・参照なしなので既に期限切れ（退色）している記憶
    writeMemory(paths, "faded", { created: "2025-01-01T00:00:00.000Z", related: [OLD] });
    writeMemory(paths, "unrelated", { related: ["active"] });
    const before = snapshot(paths);
    const metaBefore = {
      old: readMeta(paths, OLD),
      active: readMeta(paths, "active"),
      faded: readMeta(paths, "faded"),
    };

    const result = renameMemory(paths, OLD, NEW);

    expect(result).toEqual({ ok: true, oldSlug: OLD, newSlug: NEW, relatedUpdated: ["active", "faded"] });
    expect(existsSync(join(paths.memoriesDir, `${OLD}.md`))).toBe(false);
    expect(readMeta(paths, NEW)).toEqual(metaBefore.old);
    expect(readMeta(paths, "active")).toEqual({ ...metaBefore.active, related: [NEW, "unrelated"] });
    expect(readMeta(paths, "faded")).toEqual({ ...metaBefore.faded, related: [NEW] });
    expect(snapshot(paths)["unrelated.md"]).toBe(before["unrelated.md"]);
  });

  test("自身の related に旧 slug があれば新 slug に書き換え、重複は1つにまとめる", () => {
    const paths = setup();
    writeMemory(paths, OLD, { related: [OLD, "other"] });
    writeMemory(paths, "dup", { related: [OLD, NEW] });

    const result = renameMemory(paths, OLD, NEW);

    expect(result.ok).toBe(true);
    expect(readMeta(paths, NEW).related).toEqual([NEW, "other"]);
    expect(readMeta(paths, "dup").related).toEqual([NEW]);
  });

  test("snake_case や大文字の新 slug は kebab-case に正規化して受理する", () => {
    const paths = setup();
    writeMemory(paths, OLD, {});
    expect(renameMemory(paths, OLD, "Short_Slug")).toMatchObject({ ok: true, newSlug: NEW });
    expect(existsSync(join(paths.memoriesDir, `${NEW}.md`))).toBe(true);
  });

  test("新 slug が既に存在すれば何も変更せずに失敗する", () => {
    const paths = setup();
    writeMemory(paths, OLD, {});
    writeMemory(paths, NEW, {});
    writeMemory(paths, "ref", { related: [OLD] });
    const before = snapshot(paths);

    expect(renameMemory(paths, OLD, NEW)).toEqual({ ok: false, error: "exists", slug: NEW });
    expect(snapshot(paths)).toEqual(before);
  });

  test("新 slug と同名の解析できないファイルがあっても上書きしない", () => {
    const paths = setup();
    writeMemory(paths, OLD, {});
    writeFileSync(join(paths.memoriesDir, `${NEW}.md`), "frontmatter なし");
    const before = snapshot(paths);

    expect(renameMemory(paths, OLD, NEW)).toEqual({ ok: false, error: "exists", slug: NEW });
    expect(snapshot(paths)).toEqual(before);
  });

  test("旧 slug が存在しなければ失敗する", () => {
    const paths = setup();
    writeMemory(paths, "other", {});
    const before = snapshot(paths);

    expect(renameMemory(paths, OLD, NEW)).toEqual({ ok: false, error: "not-found", slug: OLD });
    expect(snapshot(paths)).toEqual(before);
  });

  test("書式・語数・文字数に違反する新 slug は何も変更せずに失敗する", () => {
    const paths = setup();
    writeMemory(paths, OLD, {});
    writeMemory(paths, "ref", { related: [OLD] });
    const before = snapshot(paths);

    for (const bad of ["single", "a-b-c-d-e", `abcdefghij-${"k".repeat(20)}`, "has space", "bad:colon"]) {
      expect(renameMemory(paths, OLD, bad)).toMatchObject({ ok: false, error: "invalid-slug" });
    }
    expect(snapshot(paths)).toEqual(before);
  });
});
