import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyExtraction,
  parseExtractionResult,
  stripCodeFence,
} from "./extraction.ts";
import { parseMemory, serializeMemory } from "./frontmatter.ts";
import { ensureDirs } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

const NOW_ISO = "2026-08-26T12:00:00.000Z";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  const paths = dataPaths("/proj", home);
  ensureDirs(paths);
  writeFileSync(
    join(paths.memoriesDir, "foo.md"),
    serializeMemory({
      meta: {
        title: "foo",
        created: "2026-08-01T00:00:00.000Z",
        updated: "2026-08-01T00:00:00.000Z",
        lastReferenced: null,
        score: 0,
        permanent: false,
        related: [],
      },
      body: "old body",
    }),
  );
  return paths;
}

describe("stripCodeFence", () => {
  test("コードフェンスを剥がす", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseExtractionResult", () => {
  test("正しい JSON を受理する", () => {
    const r = parseExtractionResult(
      '{"newMemories":[{"slug":"new-one","title":"t","body":"b"}],"updatedMemories":[],"usefulMemorySlugs":["foo"]}',
    );
    expect(r?.newMemories[0]?.slug).toBe("new-one");
  });

  test("JSON でないテキストは null", () => {
    expect(parseExtractionResult("すみません、出力できません")).toBeNull();
  });

  test("kebab-case でない slug は null", () => {
    expect(
      parseExtractionResult(
        '{"newMemories":[{"slug":"Bad Slug","title":"t","body":"b"}],"updatedMemories":[],"usefulMemorySlugs":[]}',
      ),
    ).toBeNull();
  });
});

describe("applyExtraction", () => {
  test("新規作成・slug 衝突回避・更新・加点・未知 slug スキップ", () => {
    const paths = setup();
    const report = applyExtraction(
      paths,
      {
        newMemories: [{ slug: "foo", title: "衝突する新規", body: "nb" }],
        updatedMemories: [{ slug: "foo", body: "new body" }],
        usefulMemorySlugs: ["foo", "unknown"],
      },
      NOW_ISO,
    );
    expect(report.created).toEqual(["foo-2"]);
    expect(report.updated).toEqual(["foo"]);
    expect(report.scored).toEqual(["foo"]);
    expect(report.skipped).toEqual(["unknown"]);

    const created = parseMemory(readFileSync(join(paths.memoriesDir, "foo-2.md"), "utf8"));
    expect(created?.meta.created).toBe(NOW_ISO);
    expect(created?.meta.score).toBe(0);

    const updated = parseMemory(readFileSync(join(paths.memoriesDir, "foo.md"), "utf8"));
    expect(updated?.body).toBe("new body");
    expect(updated?.meta.updated).toBe(NOW_ISO);
    expect(updated?.meta.score).toBe(1);
    expect(updated?.meta.lastReferenced).toBe(NOW_ISO);
    expect(updated?.meta.created).toBe("2026-08-01T00:00:00.000Z");
  });
});
