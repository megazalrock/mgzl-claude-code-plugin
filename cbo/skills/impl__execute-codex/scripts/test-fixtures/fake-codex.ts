#!/usr/bin/env bun
// SKILL_DIR/scripts/test-fixtures/fake-codex.ts
// テスト専用。実際の codex CLI の代わりに起動され、FAKE_CODEX_MODE に応じた出力とファイルを生成する

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_CODEX_MODE ?? "ok";
const argv = process.argv.slice(2);

const readOption = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (argv[0] === "--version") {
  if (mode === "version_fail") {
    console.error("boom");
    process.exit(2);
  }
  console.log("codex-cli 0.0.0-fake");
  process.exit(0);
}

if (argv[0] !== "exec") {
  console.error(`unexpected args: ${argv.join(" ")}`);
  process.exit(3);
}

const cwd = readOption("-C");
const lastMessageFile = readOption("-o");
if (cwd === undefined || lastMessageFile === undefined) {
  console.error("missing -C or -o");
  process.exit(3);
}

// 受け取ったプロンプトを記録し、テスト側でヘッダ連結を検証できるようにする。
// 対象リポジトリ（cwd）配下に書くと git status の差分に混入してしまうため、
// 明示的に指定されたパス（cwd の外を想定）にのみ書き出す
const prompt = await Bun.stdin.text();
const promptOut = process.env.FAKE_CODEX_PROMPT_OUT;
if (promptOut !== undefined) {
  writeFileSync(promptOut, prompt);
}

const emit = (event: Record<string, unknown>): void => {
  console.log(JSON.stringify(event));
};

emit({ type: "thread.started", thread_id: "fake-thread" });
emit({ type: "turn.started" });

if (mode === "error_event") {
  emit({ type: "error", message: "quota exceeded" });
  emit({ type: "turn.failed", error: { message: "quota exceeded" } });
  process.exit(1);
}

if (mode === "nonzero_exit") {
  console.error("codex crashed");
  process.exit(1);
}

if (mode === "hang") {
  // タイムアウト検出のテスト用。上限を短縮した実行なら kill される
  await Bun.sleep(3000);
}

if (mode === "stderr_flood") {
  // stdout より先に stderr を大量に書き、パイプの読み順による詰まりを検出する
  console.error("x".repeat(256 * 1024));
}

if (mode === "ok" || mode === "stderr_flood") {
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "generated.ts"), "export const generated = true;\n");
  // 非 ASCII パスがクォートされずに報告されるかを検証するためのファイル
  writeFileSync(join(cwd, "src", "日本語.ts"), "export const nihongo = true;\n");
}

if (mode === "modify_existing") {
  writeFileSync(join(cwd, "src", "existing.ts"), "export const existing = 2;\n");
}

emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });

if (mode !== "no_last_message") {
  writeFileSync(lastMessageFile, "実装しました。\n変更: src/generated.ts\n");
}

process.exit(0);
