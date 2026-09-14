import { describe, expect, test } from "bun:test";
import { extractLintTargets } from "./commands.ts";

const noFiles = () => undefined;

describe("対象外コマンド", () => {
  test("ls は空", () => {
    expect(extractLintTargets("ls -la", noFiles)).toEqual([]);
  });
  test("git status は空", () => {
    expect(extractLintTargets("git status", noFiles)).toEqual([]);
  });
  test("gh pr view は空", () => {
    expect(extractLintTargets("gh pr view 12", noFiles)).toEqual([]);
  });
  test("git commit だがメッセージ指定が無ければ空", () => {
    expect(extractLintTargets("git commit --amend --no-edit", noFiles)).toEqual([]);
  });
});

describe("git commit", () => {
  test("-m 1 つ", () => {
    expect(extractLintTargets('git commit -m "feat: ユーザーを追加する"', noFiles)).toEqual([
      { text: "feat: ユーザーを追加する", context: "commit" },
    ]);
  });

  test("-m 複数は空行で連結する", () => {
    expect(
      extractLintTargets('git commit -m "feat: 追加する" -m "詳細な説明である"', noFiles),
    ).toEqual([{ text: "feat: 追加する\n\n詳細な説明である", context: "commit" }]);
  });

  test("--message も拾う", () => {
    expect(extractLintTargets('git commit --message "説明である"', noFiles)).toEqual([
      { text: "説明である", context: "commit" },
    ]);
  });

  test("--message=VALUE 形式", () => {
    expect(extractLintTargets("git commit --message=説明である", noFiles)).toEqual([
      { text: "説明である", context: "commit" },
    ]);
  });

  test("heredoc の本文を取る", () => {
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      "feat: 追加する",
      "",
      "詳細な説明である",
      "EOF",
      ')"',
    ].join("\n");
    expect(extractLintTargets(command, noFiles)).toEqual([
      { text: "feat: 追加する\n\n詳細な説明である", context: "commit" },
    ]);
  });

  test("-F はファイル内容を読む", () => {
    const readFile = (path: string) => (path === "/tmp/msg.txt" ? "ファイルの本文である" : undefined);
    expect(extractLintTargets("git commit -F /tmp/msg.txt", readFile)).toEqual([
      { text: "ファイルの本文である", context: "commit" },
    ]);
  });

  test("--file はファイル内容を読む", () => {
    const readFile = (path: string) => (path === "msg.txt" ? "本文である" : undefined);
    expect(extractLintTargets("git commit --file msg.txt", readFile)).toEqual([
      { text: "本文である", context: "commit" },
    ]);
  });

  test("読めないファイルは無視する", () => {
    expect(extractLintTargets("git commit -F /tmp/missing.txt", noFiles)).toEqual([]);
  });
});

describe("gh pr", () => {
  test("--title は commit 文脈、--body は pr 文脈", () => {
    expect(
      extractLintTargets('gh pr create --title "ユーザー追加" --body "詳細な説明である。"', noFiles),
    ).toEqual([
      { text: "ユーザー追加", context: "commit" },
      { text: "詳細な説明である。", context: "pr" },
    ]);
  });

  test("短縮形 -t と -b", () => {
    expect(extractLintTargets('gh pr create -t "題名" -b "本文である。"', noFiles)).toEqual([
      { text: "題名", context: "commit" },
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("--body-file はファイル内容を pr 文脈で読む", () => {
    const readFile = (path: string) => (path === "body.md" ? "本文である。" : undefined);
    expect(extractLintTargets("gh pr create --body-file body.md", readFile)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("gh pr の -F は --body-file の短縮形として扱う", () => {
    const readFile = (path: string) => (path === "body.md" ? "本文である。" : undefined);
    expect(extractLintTargets("gh pr create -F body.md", readFile)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("gh pr edit も対象", () => {
    expect(extractLintTargets('gh pr edit 12 --body "修正した本文である。"', noFiles)).toEqual([
      { text: "修正した本文である。", context: "pr" },
    ]);
  });

  test("body の heredoc", () => {
    const command = ["gh pr create --body \"$(cat <<'EOF'", "本文である。", "EOF", ')"'].join("\n");
    expect(extractLintTargets(command, noFiles)).toEqual([{ text: "本文である。", context: "pr" }]);
  });

  test("値が空文字なら対象にしない", () => {
    expect(extractLintTargets('gh pr create --title "" --body "本文である。"', noFiles)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });
});

describe("グローバルオプションを挟む", () => {
  test("git -C <path> commit", () => {
    expect(extractLintTargets('git -C /repo commit -m "feat: ユーザの設定を追加"', noFiles)).toEqual([
      { text: "feat: ユーザの設定を追加", context: "commit" },
    ]);
  });

  test("git -c key=value commit", () => {
    expect(extractLintTargets('git -c user.name=x commit -m "feat: 追加する"', noFiles)).toEqual([
      { text: "feat: 追加する", context: "commit" },
    ]);
  });

  test("gh -R owner/repo pr create", () => {
    expect(
      extractLintTargets('gh -R o/r pr create --title "T" --body "本文である。"', noFiles),
    ).toEqual([
      { text: "T", context: "commit" },
      { text: "本文である。", context: "pr" },
    ]);
  });
});

describe("結合された短縮オプション", () => {
  test("git commit -am はメッセージを拾う", () => {
    expect(
      extractLintTargets('git commit -am "feat: ユーザの一覧を追加する"', noFiles),
    ).toEqual([{ text: "feat: ユーザの一覧を追加する", context: "commit" }]);
  });

  test("git commit -sm もメッセージを拾う", () => {
    expect(extractLintTargets('git commit -sm "x"', noFiles)).toEqual([
      { text: "x", context: "commit" },
    ]);
  });

  test("git commit -a -m は従来どおり動く", () => {
    expect(extractLintTargets('git commit -a -m "x"', noFiles)).toEqual([
      { text: "x", context: "commit" },
    ]);
  });
});

describe("エスケープされたダブルクォート", () => {
  test('-m の値中の \\" をそのまま取り込む', () => {
    expect(extractLintTargets('git commit -m "feat: \\"設定\\" を追加"', noFiles)).toEqual([
      { text: 'feat: "設定" を追加', context: "commit" },
    ]);
  });
});
