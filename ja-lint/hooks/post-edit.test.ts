import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "post-edit.ts");
const workDir = mkdtempSync(join(tmpdir(), "ja-lint-post-edit-"));

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** 編集後の内容をディスクへ置いたうえで hook を起動し、標準出力を返す */
async function runHook(
  fileName: string,
  diskContent: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  const filePath = join(workDir, fileName);
  await Bun.write(filePath, diskContent);
  const payload = JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath, ...toolInput },
  });
  const proc = Bun.spawn(["bun", "run", HOOK], {
    stdin: Buffer.from(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

const FRONTMATTER = `---
name: sample
description: サンプルのスキルです。
argument-hint: [対象] [--simple] [--cross]
---

# サンプル

これはサンプルの説明文です。
`;

const CODE_BLOCK = `# コード例

次のようにコマンドを実行します。

\`\`\`bash
# 出力先を指定してビルドする処理
bun run scripts/build.ts
\`\`\`
`;

const ADDED_VIOLATION = `# 手順

最初にコマンドを実行します。

ユーザの一覧の取得を行う。
`;

const EXISTING_VIOLATION = `# 手順

ユーザの一覧の取得を行う。

あとで説明します。

追加の段落を用意しました。
`;

const ENGLISH_BODY = `---
name: sample
description: サンプルのエージェントです。
---

# Role

You investigate the code base and report the findings you collected along the way.

Read the file at the given path and collect the relevant session information.
`;

describe("Markdown の Edit", () => {
  test("frontmatter の値だけを変えても差し戻されない", async () => {
    const stdout = await runHook("frontmatter.md", FRONTMATTER, "Edit", {
      old_string: "argument-hint: [対象] [--simple]",
      new_string: "argument-hint: [対象] [--simple] [--cross]",
    });
    expect(stdout).toBe("");
  });

  test("コードブロックの中を変えても差し戻されない", async () => {
    const stdout = await runHook("codeblock.md", CODE_BLOCK, "Edit", {
      old_string: "# 出力先を指定してビルドする",
      new_string: "# 出力先を指定してビルドする処理",
    });
    expect(stdout).toBe("");
  });

  test("書き加えた段落の違反は差し戻される", async () => {
    const stdout = await runHook("added.md", ADDED_VIOLATION, "Edit", {
      old_string: "最初にコマンドを実行します。\n",
      new_string: "最初にコマンドを実行します。\n\nユーザの一覧の取得を行う。\n",
    });
    expect(stdout).toContain('"block"');
    expect(stdout).toContain("ユーザの一覧の取得を行う。");
  });

  test("書き換えていない行の違反は報告されない", async () => {
    const stdout = await runHook("existing.md", EXISTING_VIOLATION, "Edit", {
      old_string: "あとで説明します。\n",
      new_string: "あとで説明します。\n\n追加の段落を用意しました。\n",
    });
    expect(stdout).toBe("");
  });

  test("ファイルが読めない場合は差分の行だけを見る経路に落ちる", async () => {
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: join(workDir, "missing.md"),
        old_string: "最初の行。",
        new_string: "ユーザの一覧の取得を行う。",
      },
    });
    const proc = Bun.spawn(["bun", "run", HOOK], {
      stdin: Buffer.from(payload),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('"block"');
  });
});

describe("Markdown の Write", () => {
  test("frontmatter だけ日本語で本文が英語なら差し戻されない", async () => {
    const stdout = await runHook("english.md", ENGLISH_BODY, "Write", { content: ENGLISH_BODY });
    expect(stdout).toBe("");
  });

  test("日本語の本文の違反は差し戻される", async () => {
    const content = "# 概要\n\nユーザの一覧を表示する。\n";
    const stdout = await runHook("japanese.md", content, "Write", { content });
    expect(stdout).toContain('"block"');
  });
});
