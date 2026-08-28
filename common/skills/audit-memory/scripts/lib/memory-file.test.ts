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
    expect(m.bodyLines).toBe(7);
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
