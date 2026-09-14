import { describe, expect, test } from "bun:test";
import { addedLines, containsJapanese, extractCommentBlocks } from "./comments.ts";

describe("containsJapanese", () => {
  test("ひらがな", () => {
    expect(containsJapanese("これ")).toBe(true);
  });
  test("カタカナ", () => {
    expect(containsJapanese("ユーザー")).toBe(true);
  });
  test("漢字", () => {
    expect(containsJapanese("取得")).toBe(true);
  });
  test("英数字と記号のみ", () => {
    expect(containsJapanese("const foo = 1; // TODO: fix")).toBe(false);
  });
  test("長音記号のみは日本語と見なさない", () => {
    expect(containsJapanese("ーーー")).toBe(false);
  });
});

describe("addedLines", () => {
  test("new_string にあって old_string に無い行だけを返す", () => {
    expect(addedLines("a\nb\n", "a\nb\nc\n")).toEqual(["c"]);
  });

  test("多重集合の差なので重複行は回数ぶんだけ差が出る", () => {
    expect(addedLines("x\nx", "x\nx\nx")).toEqual(["x"]);
  });

  test("削除しかない場合は空", () => {
    expect(addedLines("a\nb", "a")).toEqual([]);
  });

  test("old_string が空なら全行が追加行", () => {
    expect(addedLines("", "a\nb")).toEqual(["a", "b"]);
  });
});

describe("extractCommentBlocks", () => {
  test("対象外の拡張子は空配列", () => {
    expect(extractCommentBlocks("/a/b.md", ["// 日本語のコメント"])).toEqual([]);
    expect(extractCommentBlocks("/a/b", ["// 日本語のコメント"])).toEqual([]);
  });

  test("ts の行コメント", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1; // ユーザーを取得する"])).toEqual([
      "ユーザーを取得する",
    ]);
  });

  test("py の # コメント", () => {
    expect(extractCommentBlocks("/a/b.py", ["# ユーザーを取得する"])).toEqual(["ユーザーを取得する"]);
  });

  test("yml の # コメント", () => {
    expect(extractCommentBlocks("/a/b.yml", ["# 設定を書く"])).toEqual(["設定を書く"]);
  });

  test("sql の -- コメント", () => {
    expect(extractCommentBlocks("/a/b.sql", ["-- 件数を数える"])).toEqual(["件数を数える"]);
  });

  test("html の <!-- --> コメント", () => {
    expect(extractCommentBlocks("/a/b.html", ["<!-- 見出しである -->"])).toEqual(["見出しである"]);
  });

  test("vue は // も <!-- --> も拾う", () => {
    expect(
      extractCommentBlocks("/a/b.vue", [
        "<!-- テンプレートである -->",
        "</template>",
        "const a = 1; // 処理である",
      ]),
    ).toEqual(["テンプレートである", "処理である"]);
  });

  test("php は // も # も拾う", () => {
    expect(extractCommentBlocks("/a/b.php", ["// 前半である", "# 後半である"])).toEqual([
      "前半である後半である",
    ]);
  });

  test("ブロックコメントの各行から先頭の * を除去する", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["/**", " * ユーザーを取得する", " * 失敗したら例外を投げる", " */"]),
    ).toEqual(["ユーザーを取得する失敗したら例外を投げる"]);
  });

  test("JSDoc のタグ行はタグと識別子を除いた説明部分だけを対象にする", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["/**", " * @param {string} name 利用者の名前である", " */"]),
    ).toEqual(["利用者の名前である"]);
  });

  test("型注釈の無い JSDoc タグも識別子を除く", () => {
    expect(extractCommentBlocks("/a/b.ts", ["/**", " * @returns 取得した件数である", " */"])).toEqual([
      "取得した件数である",
    ]);
  });

  test("連続するコメント行は 1 段落に連結する", () => {
    expect(extractCommentBlocks("/a/b.ts", ["// 前半である", "// 後半である"])).toEqual([
      "前半である後半である",
    ]);
  });

  test("コード行を挟むと別の段落になる", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["// 前半である", "const a = 1;", "// 後半である"]),
    ).toEqual(["前半である", "後半である"]);
  });

  test("日本語を含まない行は除外する", () => {
    expect(extractCommentBlocks("/a/b.ts", ["// TODO: fix", "// 日本語である"])).toEqual([
      "日本語である",
    ]);
  });

  test("コメントが無ければ空配列", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1;"])).toEqual([]);
  });

  test("1 行に閉じたブロックコメント", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1; /* 補足である */ const b = 2;"])).toEqual([
      "補足である",
    ]);
  });

  test("大文字の拡張子も扱う", () => {
    expect(extractCommentBlocks("/a/B.TS", ["// 日本語である"])).toEqual(["日本語である"]);
  });
});
