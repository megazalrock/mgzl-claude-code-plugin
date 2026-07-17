import { describe, expect, test } from "bun:test";
import { buildCommentPayloads, type Finding, type Report } from "./difit-review";

function baseReport(findings: Finding[]): Report {
  return {
    reporter: "ClaudeCode review:diff",
    model: "test",
    base_commit: null,
    head_commit: null,
    created_at: "2026-07-17T00:00:00+09:00",
    target: null,
    good_points: [],
    findings,
    references: [],
  };
}

function finding(over: Partial<Finding>): Finding {
  return {
    id: "R000",
    severity: 3,
    file: "src/a.ts",
    anchor: { side: "new", line: 10 },
    problem: "p",
    reason: "r",
    reporter: "@reviewer-for-logic",
    proposals: [{ label: null, code: "x" }],
    evaluation: { value: null, directive: null },
    ...over,
  };
}

describe("buildCommentPayloads", () => {
  test("通常の指摘は thread コメントに変換され body 先頭に ID が入る", () => {
    const { comments, unanchored } = buildCommentPayloads(baseReport([finding({})]));
    expect(unanchored).toHaveLength(0);
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe("thread");
    expect(comments[0].filePath).toBe("src/a.ts");
    expect(comments[0].position).toEqual({ side: "new", line: 10 });
    expect(comments[0].body.startsWith("R000 [3] 推奨")).toBe(true);
    expect(comments[0].author).toBe("@reviewer-for-logic");
  });

  test("anchor: null かつ file ありは先頭行アンカーとファイル全体の注記になる", () => {
    const { comments } = buildCommentPayloads(baseReport([finding({ anchor: null })]));
    expect(comments[0].position).toEqual({ side: "new", line: 1 });
    expect(comments[0].body).toContain("【ファイル全体への指摘】");
  });

  test("file: null は difit に載せず unanchored に分類される", () => {
    const { comments, unanchored } = buildCommentPayloads(
      baseReport([finding({ file: null, anchor: null })])
    );
    expect(comments).toHaveLength(0);
    expect(unanchored.map((f) => f.id)).toEqual(["R000"]);
  });

  test("範囲アンカーと複数案がそのまま反映される", () => {
    const f = finding({
      anchor: { side: "new", line: { start: 3, end: 6 } },
      proposals: [
        { label: "案A", code: "a" },
        { label: "案B", code: "b" },
      ],
    });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].position.line).toEqual({ start: 3, end: 6 });
    expect(comments[0].body).toContain("提案（案A）:");
    expect(comments[0].body).toContain("提案（案B）:");
  });

  test("body 末尾に返信書式のヒントが入る", () => {
    const { comments } = buildCommentPayloads(baseReport([finding({})]));
    expect(comments[0].body).toContain("返信例: tp 対応：案A");
  });
});
