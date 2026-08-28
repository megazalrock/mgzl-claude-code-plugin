import { describe, expect, test } from "bun:test";
import { auditMemories, parseIndexLinks } from "./audit.ts";
import type { ParsedMemory } from "./memory-file.ts";

function mem(over: Partial<ParsedMemory> & { file: string }): ParsedMemory {
  const stem = over.file.replace(/\.md$/, "");
  return {
    name: stem.replace(/_/g, "-"),
    description: "desc",
    type: stem.split("_")[0] ?? null,
    metadataKeys: ["type"],
    frontmatterParsable: true,
    links: [],
    h2Count: 0,
    bodyLines: 5,
    ...over,
  };
}

describe("parseIndexLinks", () => {
  test("MEMORY.md のリンク先ファイル名を列挙する", () => {
    const index = `# Memory Index

## Feedback
- [A](feedback_a.md) — hook
- [B](project_b.md) — hook
見出しだけの行
`;
    expect(parseIndexLinks(index)).toEqual(["feedback_a.md", "project_b.md"]);
  });

  test("パス区切りを含むリンクと外部 URL は索引リンクとして採用しない", () => {
    const index = `# Memory Index

## Feedback
- [A](feedback_a.md) — hook
- [B](sub/project_b.md) — サブディレクトリ配下
- [C](./project_c.md) — 相対パス指定
- [D](https://example.com/foo.md) — 外部 URL
`;
    expect(parseIndexLinks(index)).toEqual(["feedback_a.md"]);
  });
});

describe("auditMemories", () => {
  test("正常な記憶には issue を出さない", () => {
    const issues = auditMemories([mem({ file: "feedback_a.md" })], ["feedback_a.md"]);
    expect(issues).toEqual([]);
  });

  test("索引に無いファイルは index_missing、実体の無い索引行は file_missing", () => {
    const issues = auditMemories([mem({ file: "feedback_a.md" })], ["feedback_b.md"]);
    expect(issues).toEqual([
      { kind: "index_missing", file: "feedback_a.md", detail: "MEMORY.md に索引行が無い" },
      { kind: "file_missing", file: "feedback_b.md", detail: "MEMORY.md に索引行があるがファイルが無い" },
    ]);
  });

  test("フロントマターが読めない場合は frontmatter_unparsable のみ出す", () => {
    const issues = auditMemories(
      [mem({ file: "feedback_a.md", frontmatterParsable: false, name: null, description: null, type: null, metadataKeys: [] })],
      ["feedback_a.md"],
    );
    expect(issues.map((i) => i.kind)).toEqual(["frontmatter_unparsable"]);
  });

  test("必須フィールドの欠落は frontmatter_missing をフィールドごとに出す", () => {
    const issues = auditMemories(
      [mem({ file: "feedback_a.md", name: null, description: null, type: null, metadataKeys: [] })],
      ["feedback_a.md"],
    );
    expect(issues).toEqual([
      { kind: "frontmatter_missing", file: "feedback_a.md", detail: "name" },
      { kind: "frontmatter_missing", file: "feedback_a.md", detail: "description" },
      { kind: "frontmatter_missing", file: "feedback_a.md", detail: "metadata.type" },
    ]);
  });

  test("type が 4 値以外なら type_invalid", () => {
    const issues = auditMemories([mem({ file: "feedback_a.md", type: "note" })], ["feedback_a.md"]);
    expect(issues).toEqual([{ kind: "type_invalid", file: "feedback_a.md", detail: "note" }]);
  });

  test("name とファイル名は - と _ を同一視して比較する", () => {
    const ok = auditMemories([mem({ file: "project_foo_bar.md", name: "project-foo-bar" })], ["project_foo_bar.md"]);
    expect(ok).toEqual([]);
    const ng = auditMemories([mem({ file: "project_foo_bar.md", name: "foo-bar" })], ["project_foo_bar.md"]);
    expect(ng).toEqual([{ kind: "name_mismatch", file: "project_foo_bar.md", detail: "foo-bar" }]);
  });

  test("ファイル名の接頭辞が type と違えば prefix_mismatch", () => {
    const issues = auditMemories(
      [mem({ file: "reference_x.md", name: "reference-x", type: "project" })],
      ["reference_x.md"],
    );
    expect(issues).toEqual([{ kind: "prefix_mismatch", file: "reference_x.md", detail: "project" }]);
  });

  test("metadata の規定外キーは extra_key をキーごとに出す。Claude Code が自動付与する既知キーは除外", () => {
    const issues = auditMemories(
      [mem({ file: "project_x.md", metadataKeys: ["node_type", "type", "originSessionId", "modified", "foo", "bar"] })],
      ["project_x.md"],
    );
    expect(issues).toEqual([
      { kind: "extra_key", file: "project_x.md", detail: "foo" },
      { kind: "extra_key", file: "project_x.md", detail: "bar" },
    ]);
  });

  test("[[link]] は name またはファイル名（- と _ 同一視）に解決できなければ broken_link", () => {
    const issues = auditMemories(
      [
        mem({ file: "feedback_a.md", links: ["feedback_b", "feedback-b", "project-c", "nothing"] }),
        mem({ file: "feedback_b.md" }),
        mem({ file: "project_c_long.md", name: "project-c" }),
      ],
      ["feedback_a.md", "feedback_b.md", "project_c_long.md"],
    );
    // project_c_long.md は name とファイル名が違うので name_mismatch も出る。ここではリンクの解決だけを見る
    expect(issues.filter((i) => i.kind === "broken_link")).toEqual([
      { kind: "broken_link", file: "feedback_a.md", detail: "nothing" },
    ]);
  });

  test("H2 が 3 つ以上または 60 行超なら multi_fact", () => {
    const byH2 = auditMemories([mem({ file: "project_x.md", h2Count: 3, bodyLines: 10 })], ["project_x.md"]);
    expect(byH2).toEqual([{ kind: "multi_fact", file: "project_x.md", detail: "h2=3 lines=10" }]);
    const byLines = auditMemories([mem({ file: "project_x.md", h2Count: 0, bodyLines: 61 })], ["project_x.md"]);
    expect(byLines).toEqual([{ kind: "multi_fact", file: "project_x.md", detail: "h2=0 lines=61" }]);
    const ok = auditMemories([mem({ file: "project_x.md", h2Count: 2, bodyLines: 60 })], ["project_x.md"]);
    expect(ok).toEqual([]);
  });
});
