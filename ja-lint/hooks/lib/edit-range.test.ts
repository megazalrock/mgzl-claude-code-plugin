import { describe, expect, test } from "bun:test";
import { changedLineNumbers } from "./edit-range.ts";

describe("changedLineNumbers", () => {
  test("行の一部だけを書き換えた場合はその行を返す", () => {
    const content = "---\nargument-hint: [対象] [--simple] [--cross]\n---\n\n本文です。\n";
    expect(changedLineNumbers(content, "[--simple]", "[--simple] [--cross]")).toEqual(
      new Set([2]),
    );
  });

  test("置換範囲に含まれるだけで内容の変わらない行は返さない", () => {
    const content = "一行目。\n追加した行。\n二行目。\n三行目。\n";
    const changed = changedLineNumbers(content, "一行目。\n二行目。", "一行目。\n追加した行。\n二行目。");
    expect(changed).toEqual(new Set([2]));
  });

  test("複数行が増えた場合は増えた行すべてを返す", () => {
    const content = "見出し\n\n一つ目。\n二つ目。\n";
    const changed = changedLineNumbers(content, "見出し\n", "見出し\n\n一つ目。\n二つ目。\n");
    expect(changed).toEqual(new Set([2, 3, 4]));
  });

  test("同じ文字列が複数ある場合はすべての箇所を返す", () => {
    const content = "終了。\nほか。\n終了。\n";
    expect(changedLineNumbers(content, "終了", "終了。")).toEqual(new Set([1, 3]));
  });

  test("new_string が全文に見つからなければ undefined", () => {
    expect(changedLineNumbers("本文です。\n", "あ", "いろは")).toBeUndefined();
  });

  test("new_string が空なら undefined", () => {
    expect(changedLineNumbers("本文です。\n", "本文", "")).toBeUndefined();
  });

  test("出現箇所が多すぎる場合は undefined", () => {
    expect(changedLineNumbers("あ\n".repeat(70), "あ", "あ")).toBeUndefined();
  });
});
