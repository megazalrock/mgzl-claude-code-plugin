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

describe("日本語を含まないノードの除外", () => {
  test("英語だけの段落は指摘されない", async () => {
    const outcome = await lintJapanese(
      "This function receives a path and a session, then returns the result of the lookup it performed.",
      "markdown",
    );
    expect(outcome.errors).toEqual([]);
    expect(outcome.infos).toEqual([]);
  });

  test("英語だけの箇条書きは指摘されない", async () => {
    const outcome = await lintJapanese("- **Testing**: run the unit tests first.", "markdown");
    expect(outcome.errors).toEqual([]);
  });

  test("英語だけの見出しは指摘されない", async () => {
    const outcome = await lintJapanese("# Role and responsibility", "markdown");
    expect(outcome.errors).toEqual([]);
  });

  test("日本語の段落に混ざる英単語は指摘される", async () => {
    const outcome = await lintJapanese("この関数は Java Script で書かれている。", "markdown");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });

  test("日本語の箇条書きは従来どおり指摘される", async () => {
    const outcome = await lintJapanese("- **項目**: 説明です。", "markdown");
    expect(ruleIds(outcome.errors)).toContain("ai-writing/no-ai-list-formatting");
  });

  test("コメント文脈でも英語だけの文は指摘されない", async () => {
    const outcome = await lintJapanese("Read the given path and collect the session data.", "comment");
    expect(outcome.errors).toEqual([]);
  });
});

describe("prh と ja-technical-writing の衝突", () => {
  async function prhMessages(text: string): Promise<string[]> {
    const outcome = await lintJapanese(text, "markdown");
    return outcome.errors.filter((f) => f.ruleId === "prh").map((f) => f.message);
  }

  test("算用数字の「1つは」は prh に差し戻されない", async () => {
    expect(await prhMessages("- 1つは「指摘」である")).toEqual([]);
  });

  test("算用数字の「もう1つ」は prh に差し戻されない", async () => {
    expect(await prhMessages("- もう1つは「評価・対応」である")).toEqual([]);
  });

  test("算用数字の「1つ1つ」は prh に差し戻されない", async () => {
    expect(await prhMessages("- 1つ1つ確認する")).toEqual([]);
  });

  test("ja-technical-writing 側の漢数字の指摘は残す", async () => {
    const outcome = await lintJapanese("- 役割は一つだけである", "markdown");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/arabic-kanji-numbers");
  });

  test("「基づく」は誤記のかな遣いだけを指摘する", async () => {
    expect(await prhMessages("- 仕様に基ずく実装である")).toContain("基ずく => 基づく");
    expect(await prhMessages("- 仕様にもとづく実装である")).toEqual([]);
    expect(await prhMessages("- 基となるデータである")).toEqual([]);
    expect(await prhMessages("- 基幹システムである")).toEqual([]);
  });
});

describe("辞書を自前ルールに絞ったことによる誤検知の解消", () => {
  async function prhMessages(text: string): Promise<string[]> {
    const outcome = await lintJapanese(text, "markdown");
    return outcome.errors.filter((f) => f.ruleId === "prh").map((f) => f.message);
  }

  test("「だけして」は指摘されない", async () => {
    expect(await prhMessages("テストだけして終わるのは避ける。")).toEqual([]);
  });

  test("「仕分けして」は指摘されない", async () => {
    expect(await prhMessages("ファイルを仕分けして保存する。")).toEqual([]);
  });

  test("「発火」は指摘されない", async () => {
    expect(await prhMessages("イベントが発火する仕組みである。")).toEqual([]);
  });

  test("「基幹」「基調」「基点」は指摘されない", async () => {
    expect(await prhMessages("基幹システムの基調を基点にする。")).toEqual([]);
  });
});

describe("ですます・である体の混在判定", () => {
  async function mixIds(text: string): Promise<string[]> {
    const outcome = await lintJapanese(text, "markdown");
    return outcome.errors
      .filter((f) => f.ruleId === "ja-technical-writing/no-mix-dearu-desumasu")
      .map((f) => f.message);
  }

  test("箇条書きがですます、地の文がである でも指摘されない", async () => {
    expect(await mixIds("- これはテストの項目です。\n\nこれはテストの文章である。")).toEqual([]);
  });

  test("地の文がですますで箇条書きがである でも指摘されない", async () => {
    expect(await mixIds("- これはテストの項目である。\n\nこれはテストの文章です。")).toEqual([]);
  });

  test("同じ地の文の中で混在していれば指摘される", async () => {
    const messages = await mixIds(
      "これはテストの文章である。\n次のテストの文章です。\n最後のテストの文章である。",
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe("インラインコードの除外", () => {
  const longLog =
    "ユーザーの設定を読み込む処理でエラーが発生しましたので、設定ファイルの内容を確認したうえで、" +
    "権限とパスの指定に誤りがないかどうかを順番に見直していただく必要がございますわ。" +
    "なお再実行の前には、キャッシュの削除と再読み込みをあわせて行っていただけますと助かりますわ。";

  test("箇条書きに引用した長い日本語ログは指摘されない", async () => {
    const outcome = await lintJapanese(`- \`${longLog}\`\n`, "markdown");
    expect(outcome.errors).toEqual([]);
  });

  test("インラインコードの前に地の文があると一文の長さは従来どおり数えられる", async () => {
    // sentence-length は一文の先頭位置で報告するため、
    // インラインコードの手前に地の文があると報告位置が除外範囲の外に出て残る
    const outcome = await lintJapanese(`- ログの例: \`${longLog}\`\n`, "markdown");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/sentence-length");
    expect(ruleIds(outcome.errors)).not.toContain(
      "ja-technical-writing/no-mix-dearu-desumasu",
    );
  });

  test("インラインコードの中の表記ゆれは指摘されない", async () => {
    const outcome = await lintJapanese("`ユーザの設定` を確認する。", "markdown");
    expect(ruleIds(outcome.errors)).not.toContain("prh");
  });

  test("インラインコードの外の地の文は従来どおり指摘される", async () => {
    const outcome = await lintJapanese("`config` のユーザの設定です。", "markdown");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });

  test("コードブロックの中は従来どおり指摘されない", async () => {
    const outcome = await lintJapanese(`\`\`\`\n${longLog}\n\`\`\`\n`, "markdown");
    expect(outcome.errors).toEqual([]);
    expect(outcome.infos).toEqual([]);
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
