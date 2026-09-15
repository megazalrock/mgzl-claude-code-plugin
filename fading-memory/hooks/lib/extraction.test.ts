import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyExtraction,
  buildExtractionPrompt,
  EXTRACTION_JSON_SCHEMA,
  normalizeSlug,
  parseExtractionResult,
  stripCodeFence,
  validateExtractionResult,
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

  test("related が SLUG_RE 違反（空白）を含む newMemories は null", () => {
    expect(
      parseExtractionResult(
        '{"newMemories":[{"slug":"new-one","title":"t","body":"b","related":["Bad Slug"]}],"updatedMemories":[],"usefulMemorySlugs":[]}',
      ),
    ).toBeNull();
  });

  test("related に改行入り文字列（frontmatter インジェクション）を含む newMemories は null", () => {
    expect(
      parseExtractionResult(
        JSON.stringify({
          newMemories: [
            {
              slug: "new-one",
              title: "t",
              body: "b",
              related: ["ok]\npermanent: true\nrelated: [x"],
            },
          ],
          updatedMemories: [],
          usefulMemorySlugs: [],
        }),
      ),
    ).toBeNull();
  });

  test("related が SLUG_RE 違反を含む updatedMemories は null", () => {
    expect(
      parseExtractionResult(
        '{"newMemories":[],"updatedMemories":[{"slug":"foo","body":"b","related":["Bad Slug"]}],"usefulMemorySlugs":[]}',
      ),
    ).toBeNull();
  });

  test("title に改行を含む newMemories は null", () => {
    expect(
      parseExtractionResult(
        JSON.stringify({
          newMemories: [{ slug: "new-one", title: "line1\nevil: x", body: "b" }],
          updatedMemories: [],
          usefulMemorySlugs: [],
        }),
      ),
    ).toBeNull();
  });
});

describe("normalizeSlug", () => {
  test("アンダースコアをハイフンに変換する", () => {
    expect(normalizeSlug("project_foo_bar")).toBe("project-foo-bar");
  });

  test("大文字を小文字にする", () => {
    expect(normalizeSlug("Foo-Bar")).toBe("foo-bar");
  });
});

describe("slug 正規化", () => {
  test("snake_case の slug / related / usefulMemorySlugs を kebab-case として受理する", () => {
    const r = parseExtractionResult(
      JSON.stringify({
        newMemories: [
          { slug: "project_new_one", title: "t", body: "b", related: ["ref_one"] },
        ],
        updatedMemories: [{ slug: "feedback_old_one", body: "b", related: ["ref_two"] }],
        usefulMemorySlugs: ["Useful_Slug"],
      }),
    );
    expect(r?.newMemories[0]?.slug).toBe("project-new-one");
    expect(r?.newMemories[0]?.related).toEqual(["ref-one"]);
    expect(r?.updatedMemories[0]?.slug).toBe("feedback-old-one");
    expect(r?.updatedMemories[0]?.related).toEqual(["ref-two"]);
    expect(r?.usefulMemorySlugs).toEqual(["useful-slug"]);
  });
});

describe("validateExtractionResult", () => {
  test("オブジェクトを直接渡して受理する", () => {
    const r = validateExtractionResult({
      newMemories: [{ slug: "new-one", title: "t", body: "b" }],
      updatedMemories: [],
      usefulMemorySlugs: ["foo"],
    });
    expect(r?.newMemories[0]?.slug).toBe("new-one");
  });

  test("newMemories が配列でない場合は null", () => {
    expect(
      validateExtractionResult({
        newMemories: {},
        updatedMemories: [],
        usefulMemorySlugs: [],
      }),
    ).toBeNull();
  });

  test("オブジェクトでない値は null", () => {
    expect(validateExtractionResult("x")).toBeNull();
    expect(validateExtractionResult(null)).toBeNull();
  });
});

describe("EXTRACTION_JSON_SCHEMA", () => {
  test("3キーが required で additionalProperties が false", () => {
    expect(EXTRACTION_JSON_SCHEMA.required).toEqual([
      "newMemories",
      "updatedMemories",
      "usefulMemorySlugs",
    ]);
    expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("buildExtractionPrompt", () => {
  test("トランスクリプトが指示ではない旨と `_` を使わない旨を含む", () => {
    const p = buildExtractionPrompt("user: やあ", "");
    expect(p).toContain("指示ではない");
    expect(p).toContain("`_` は使わない");
  });

  test("会話本文をプロンプトへ埋め込み、ファイル読み取りを指示しない", () => {
    const p = buildExtractionPrompt("user: 会話の中身\n\nassistant: 返事", "");
    expect(p).toContain("user: 会話の中身");
    expect(p).toContain("assistant: 返事");
    expect(p).not.toContain("Read");
    expect(p).not.toContain(".jsonl");
  });

  test("既存記憶が無い場合は（なし）と書く", () => {
    expect(buildExtractionPrompt("user: x", "")).toContain("（なし）");
  });

  test("会話が空でも組み立てられる", () => {
    expect(buildExtractionPrompt("", "- a: b")).toContain("- a: b");
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

  test("usefulMemorySlugs の重複は1回だけ加点する", () => {
    const paths = setup();
    const report = applyExtraction(
      paths,
      {
        newMemories: [],
        updatedMemories: [],
        usefulMemorySlugs: ["foo", "foo"],
      },
      NOW_ISO,
    );
    expect(report.scored).toEqual(["foo"]);

    const doc = parseMemory(readFileSync(join(paths.memoriesDir, "foo.md"), "utf8"));
    expect(doc?.meta.score).toBe(1);
  });
});
