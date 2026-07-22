import { describe, expect, test } from "bun:test";
import {
  buildCommentPayloads,
  extractCommentsOutput,
  parseValidLines,
  type Finding,
  type Report,
} from "./difit-review";

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
    proposals: [{ label: null, text: null, code: "x" }],
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
        { label: "案A", text: null, code: "a" },
        { label: "案B", text: null, code: "b" },
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

  test("提案コードはバックティック3つのフェンスで囲まれる", () => {
    const { comments } = buildCommentPayloads(baseReport([finding({})]));
    expect(comments[0].body).toContain("提案:\n```\nx\n```");
  });

  test("提案コード内にフェンスがある場合はより長いフェンスで囲む", () => {
    const f = finding({ proposals: [{ label: null, text: null, code: "```md\nabc\n```" }] });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].body).toContain("提案:\n````\n```md\nabc\n```\n````");
  });

  test("text のみの提案は平文で出力されフェンスが付かない", () => {
    const f = finding({ proposals: [{ label: null, text: "説明のみの修正案", code: null }] });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].body).toContain("提案:\n説明のみの修正案");
    expect(comments[0].body).not.toContain("```");
  });

  test("text と code の併記では code のみフェンスで囲まれる", () => {
    const f = finding({ proposals: [{ label: null, text: "説明", code: "x" }] });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].body).toContain("提案:\n説明\n```\nx\n```");
  });

  test("旧形式（text キー無し）の提案は従来どおり code がフェンスで囲まれる", () => {
    const f = finding({ proposals: [{ label: null, code: "x" }] });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].body).toContain("提案:\n```\nx\n```");
  });
});

// old: 8-11 / new: 8-12 が表示範囲になる差分
const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -8,4 +8,5 @@ ctx",
  " line8",
  "-line9old",
  "+line9new",
  "+line10new",
  " line11",
  " line12",
  "",
].join("\n");

// 削除のみのファイル（new 側の表示行が存在しない）
const DELETE_ONLY_DIFF = [
  "diff --git a/src/del.ts b/src/del.ts",
  "deleted file mode 100644",
  "--- a/src/del.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-a",
  "-b",
  "",
].join("\n");

describe("parseValidLines", () => {
  test("追加行・文脈行が new 側、削除行・文脈行が old 側の有効行になる", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const file = valid.get("src/a.ts");
    expect(file).toBeDefined();
    expect([...(file?.newLines ?? [])].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12]);
    expect([...(file?.oldLines ?? [])].sort((a, b) => a - b)).toEqual([8, 9, 10, 11]);
  });

  test("削除のみのファイルは old 側の行だけ有効になる", () => {
    const valid = parseValidLines(DELETE_ONLY_DIFF);
    const file = valid.get("src/del.ts");
    expect([...(file?.oldLines ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(file?.newLines.size).toBe(0);
  });
});

describe("アンカーの補正（スナップ）", () => {
  test("表示範囲内の行番号はそのまま使われ adjusted に載らない", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ anchor: { side: "new", line: 9 } })]),
      valid
    );
    expect(comments[0].position).toEqual({ side: "new", line: 9 });
    expect(adjusted).toHaveLength(0);
  });

  test("表示範囲外の行番号は最寄りの表示行に補正され adjusted に載る", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ anchor: { side: "new", line: 40 } })]),
      valid
    );
    expect(comments[0].position).toEqual({ side: "new", line: 12 });
    expect(adjusted).toEqual([{ id: "R000", from: "new:40", to: "new:12" }]);
  });

  test("範囲アンカーは両端が表示行に補正される", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ anchor: { side: "new", line: { start: 1, end: 9 } } })]),
      valid
    );
    expect(comments[0].position).toEqual({ side: "new", line: { start: 8, end: 9 } });
    expect(adjusted).toEqual([{ id: "R000", from: "new:1-9", to: "new:8-9" }]);
  });

  test("diff に存在しないファイルの指摘は unanchored に分類される", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const { comments, unanchored } = buildCommentPayloads(
      baseReport([finding({ file: "src/other.ts" })]),
      valid
    );
    expect(comments).toHaveLength(0);
    expect(unanchored.map((f) => f.id)).toEqual(["R000"]);
  });

  test("指定 side に表示行が無い場合は反対 side に補正される", () => {
    const valid = parseValidLines(DELETE_ONLY_DIFF);
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ file: "src/del.ts", anchor: { side: "new", line: 1 } })]),
      valid
    );
    expect(comments[0].position).toEqual({ side: "old", line: 1 });
    expect(adjusted).toEqual([{ id: "R000", from: "new:1", to: "old:1" }]);
  });

  test("anchor:null のファイル全体指摘は最初の表示行に置かれ adjusted に載らない", () => {
    const valid = parseValidLines(SAMPLE_DIFF);
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ anchor: null })]),
      valid
    );
    expect(comments[0].position).toEqual({ side: "new", line: 8 });
    expect(adjusted).toHaveLength(0);
  });

  test("validLines を渡さない場合は従来どおり補正しない", () => {
    const { comments, adjusted } = buildCommentPayloads(
      baseReport([finding({ anchor: { side: "new", line: 999 } })])
    );
    expect(comments[0].position).toEqual({ side: "new", line: 999 });
    expect(adjusted).toHaveLength(0);
  });
});

describe("extractCommentsOutput", () => {
  test("ログ末尾のコメント出力ブロックを抽出する", () => {
    const log = [
      "🚀 difit server started on http://localhost:4966",
      "Client disconnected, shutting down server...",
      "",
      "📝 Comments from review session:",
      "=".repeat(50),
      "src/a.ts:L9",
      "R000 [3] 推奨",
      "Reply 1 (reviewer)",
      "tp 対応：案A",
      "=".repeat(50),
      "Total comments: 1",
      "",
    ].join("\n");
    const output = extractCommentsOutput(log);
    expect(output).toContain("📝 Comments from review session:");
    expect(output).toContain("Reply 1 (reviewer)");
    expect(output).toContain("Total comments: 1");
  });

  test("コメント出力が無いログでは null を返す", () => {
    expect(extractCommentsOutput("🚀 difit server started\n")).toBeNull();
  });
});
