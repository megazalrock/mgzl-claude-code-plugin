import { describe, expect, test } from "bun:test";
import { parseMemory } from "./memory-file.ts";

const normal = `---
name: feedback-no-auto-commit
description: コミットは明示的な指示があるまで行わない
metadata:
  type: feedback
---

本文。

**Why:** 理由。関連: [[feedback_skill_independence]] と [[project-foo]]
`;

describe("parseMemory", () => {
  test("正常なフロントマターから name / description / type を取り出す", () => {
    const m = parseMemory("feedback_no_auto_commit.md", normal);
    expect(m.file).toBe("feedback_no_auto_commit.md");
    expect(m.name).toBe("feedback-no-auto-commit");
    expect(m.description).toBe("コミットは明示的な指示があるまで行わない");
    expect(m.type).toBe("feedback");
    expect(m.metadataKeys).toEqual(["type"]);
    expect(m.frontmatterParsable).toBe(true);
  });

  test("本文の [[link]] をすべて列挙する", () => {
    const m = parseMemory("feedback_no_auto_commit.md", normal);
    expect(m.links).toEqual(["feedback_skill_independence", "project-foo"]);
  });

  test("H2 見出し数と本文行数を数える", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

## A
a
## B
b
## C
c
`;
    const m = parseMemory("project_x.md", content);
    expect(m.h2Count).toBe(3);
    expect(m.bodyLines).toBe(6);
  });

  test("フロントマター直後の空行は本文行数に数えない", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

1行目
2行目
3行目
`;
    const m = parseMemory("project_x.md", content);
    expect(m.bodyLines).toBe(3);
  });

  test("フロントマター直後に空行が複数あっても本文行数に数えない", () => {
    const content = "---\nname: x\ndescription: y\nmetadata:\n  type: project\n---\n\n\n\n1行目\n2行目\n";
    const m = parseMemory("project_x.md", content);
    expect(m.bodyLines).toBe(2);
  });

  test("本文がちょうど 60 行なら bodyLines は 60 になる", () => {
    // multi_fact の 60 行超判定が境界でずれないことを固定する
    const body = Array.from({ length: 60 }, (_, i) => `行${i + 1}`).join("\n");
    const content = `---\nname: x\ndescription: y\nmetadata:\n  type: project\n---\n\n${body}\n`;
    const m = parseMemory("project_x.md", content);
    expect(m.bodyLines).toBe(60);
  });

  test("metadata 配下の規定外キーも metadataKeys に含める", () => {
    const content = `---
name: x
description: y
metadata:
  node_type: memory
  type: project
  originSessionId: abc
---
本文
`;
    const m = parseMemory("project_x.md", content);
    expect(m.metadataKeys).toEqual(["node_type", "type", "originSessionId"]);
    expect(m.type).toBe("project");
  });

  test("フロントマターが無い場合は frontmatterParsable=false で各値は null", () => {
    const m = parseMemory("project_x.md", "本文だけ\n");
    expect(m.frontmatterParsable).toBe(false);
    expect(m.name).toBeNull();
    expect(m.description).toBeNull();
    expect(m.type).toBeNull();
    expect(m.metadataKeys).toEqual([]);
    expect(m.bodyLines).toBe(1);
  });

  test("YAML として壊れている場合は frontmatterParsable=false", () => {
    const content = `---
name: [unclosed
description: y
---
本文
`;
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(false);
  });

  test("フロントマター内の行頭 `----` を閉じフェンスと誤認しない", () => {
    // `----:` は YAML としては単なるキー行だが、`---` 前方一致だと閉じフェンスに見えてしまう
    const content = `---
name: x
description: y
----: 区切りに見えるキー
metadata:
  type: project
---

## A
本文
`;
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(true);
    expect(m.name).toBe("x");
    expect(m.type).toBe("project");
    expect(m.metadataKeys).toEqual(["type"]);
    expect(m.h2Count).toBe(1);
    expect(m.bodyLines).toBe(2);
  });

  test("フロントマター内の行頭 `--- foo` で本文を途中から切り出さない", () => {
    const content = `---
name: x
description: y
--- foo
metadata:
  type: project
---

## A
[[project-foo]]
`;
    const m = parseMemory("project_x.md", content);
    // `--- foo` を含むフロントマターは YAML として壊れているので解析不可が正しい
    expect(m.frontmatterParsable).toBe(false);
    expect(m.name).toBeNull();
    expect(m.h2Count).toBe(1);
    expect(m.links).toEqual(["project-foo"]);
    expect(m.bodyLines).toBe(2);
  });

  test("閉じフェンス行の行末に空白があっても閉じフェンスとして扱う", () => {
    const content = "---\nname: x\ndescription: y\nmetadata:\n  type: project\n--- \n\n## A\n";
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(true);
    expect(m.type).toBe("project");
    expect(m.bodyLines).toBe(1);
  });

  test("ファイル末尾が改行なしの `---` で終わる場合は本文を空として扱う", () => {
    const content = "---\nname: x\ndescription: y\nmetadata:\n  type: project\n---";
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(true);
    expect(m.type).toBe("project");
    expect(m.bodyLines).toBe(0);
  });

  test("閉じフェンスが無い場合は行頭 `----` を境界にせず全体を本文として扱う", () => {
    const content = `---
本文だけのファイル

----

## A
`;
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(false);
    expect(m.h2Count).toBe(1);
    expect(m.bodyLines).toBe(6);
  });

  test("本文中の行頭 `---` は本文として保持される", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

## A
----
## B
`;
    const m = parseMemory("project_x.md", content);
    expect(m.type).toBe("project");
    expect(m.h2Count).toBe(2);
    expect(m.bodyLines).toBe(3);
  });

  test("コードフェンス内の `## ` と [[...]] は h2Count / links に数えない", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

## 外の見出し
[[project-outside]]

\`\`\`md
## フェンス内の見出し
[[project-inside]]
\`\`\`

## 外の見出し2
`;
    const m = parseMemory("project_x.md", content);
    expect(m.h2Count).toBe(2);
    expect(m.links).toEqual(["project-outside"]);
    // bodyLines はフェンス内の行も従来どおり数える
    expect(m.bodyLines).toBe(9);
  });

  test("閉じフェンスが無い場合は開きフェンス以降を末尾までフェンス内として扱う", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

## 外の見出し

\`\`\`
## フェンス内の見出し
[[project-inside]]
`;
    const m = parseMemory("project_x.md", content);
    expect(m.h2Count).toBe(1);
    expect(m.links).toEqual([]);
  });

  test("4 個以上のバッククォートで開いたフェンスは同数以上の行までがフェンス内", () => {
    const content = `---
name: x
description: y
metadata:
  type: project
---

\`\`\`\`md
\`\`\`
## フェンス内の見出し
[[project-inside]]
\`\`\`
\`\`\`\`

## 外の見出し
[[project-outside]]
`;
    const m = parseMemory("project_x.md", content);
    expect(m.h2Count).toBe(1);
    expect(m.links).toEqual(["project-outside"]);
  });

  test("metadata が無い場合 type は null で metadataKeys は空", () => {
    const content = `---
name: x
description: y
---
本文
`;
    const m = parseMemory("project_x.md", content);
    expect(m.frontmatterParsable).toBe(true);
    expect(m.type).toBeNull();
    expect(m.metadataKeys).toEqual([]);
  });
});
