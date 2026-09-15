import { describe, expect, test } from "bun:test";
import { lintJapanese } from "./lint.ts";

function ruleIds(findings: { ruleId: string }[]): string[] {
  return findings.map((f) => f.ruleId);
}

describe("comment 文脈", () => {
  test("句点の無い文は通る", async () => {
    const outcome = await lintJapanese("句点のない一文です", "comment");
    expect(ruleIds(outcome.errors)).toEqual([]);
  });

  test("冗長表現は error になる", async () => {
    const outcome = await lintJapanese("ユーザーの情報の取得を行う。", "comment");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/ja-no-redundant-expression");
  });

  test("誇張表現は error になる", async () => {
    const outcome = await lintJapanese("これは革命的な実装です。", "comment");
    expect(ruleIds(outcome.errors)).toContain("ai-writing/no-ai-hype-expressions");
  });

  test("ai-tech-writing-guideline は無効", async () => {
    const outcome = await lintJapanese("まず最初に設定する。", "comment");
    expect(ruleIds(outcome.errors)).not.toContain("ai-writing/ai-tech-writing-guideline");
    expect(ruleIds(outcome.infos)).not.toContain("ai-writing/ai-tech-writing-guideline");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "comment");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });

  test("問題の無い文は error も info も 0 件", async () => {
    const outcome = await lintJapanese("ユーザー情報を取得する。", "comment");
    expect(outcome.errors).toEqual([]);
    expect(outcome.infos).toEqual([]);
  });
});

describe("commit 文脈", () => {
  test("句点の無いコミットメッセージは通る", async () => {
    const outcome = await lintJapanese("feat: ユーザー一覧を追加する", "commit");
    expect(ruleIds(outcome.errors)).not.toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("feat: ユーザの一覧を追加する", "commit");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });
});

describe("pr 文脈", () => {
  test("句点の無い文は error になる", async () => {
    const outcome = await lintJapanese("句点のない一文です", "pr");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("ai-tech-writing-guideline は info に分類される", async () => {
    const outcome = await lintJapanese("まず最初に設定する。", "pr");
    expect(ruleIds(outcome.infos)).toContain("ai-writing/ai-tech-writing-guideline");
    expect(ruleIds(outcome.errors)).not.toContain("ai-writing/ai-tech-writing-guideline");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "pr");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });

  test("AI 的な箇条書きの強調は error になる", async () => {
    const outcome = await lintJapanese("- **項目**: 説明です。", "pr");
    expect(ruleIds(outcome.errors)).toContain("ai-writing/no-ai-list-formatting");
  });
});

describe("markdown 文脈", () => {
  test("段落の句点の無い文は error になる", async () => {
    const outcome = await lintJapanese("これはテストの文章です", "markdown");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("箇条書きの項目は句点を求められない", async () => {
    const outcome = await lintJapanese("- これはテストの項目です", "markdown");
    expect(ruleIds(outcome.errors)).not.toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("コードブロックの中は prh の対象外だが、外の段落は指摘される", async () => {
    const outcome = await lintJapanese(
      "```\nユーザの設定\n```\n\nユーザの設定です。",
      "markdown",
    );
    const prh = outcome.errors.filter((f) => f.ruleId === "prh");
    expect(prh.map((f) => f.quote)).toEqual(["ユーザの設定です。"]);
  });

  test("AI 的な箇条書きの強調は error になる", async () => {
    const outcome = await lintJapanese("- **項目**: 説明です。", "markdown");
    expect(ruleIds(outcome.errors)).toContain("ai-writing/no-ai-list-formatting");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("ユーザの設定です。", "markdown");
    const prh = outcome.errors.find((f) => f.ruleId === "prh");
    expect(prh?.message).toContain("ユーザの => ユーザーの");
  });

  test("指摘には lint 対象テキスト内の行番号が付く", async () => {
    const outcome = await lintJapanese("# 見出し\n\nユーザの設定です。", "markdown");
    expect(outcome.errors.map((f) => f.line)).toEqual([3]);
  });
});

describe("Finding の中身", () => {
  test("指摘位置を含む文が quote に入る", async () => {
    const outcome = await lintJapanese("最初の文である。ユーザの一覧を表示する。", "comment");
    const prh = outcome.errors.find((f) => f.ruleId === "prh");
    expect(prh?.quote).toBe("ユーザの一覧を表示する。");
  });

  test("message が空でない", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "comment");
    const prh = outcome.errors.find((f) => f.ruleId === "prh");
    expect(prh?.message).toContain("ユーザー");
  });
});
