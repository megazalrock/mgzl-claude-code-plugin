#!/usr/bin/env bun

/**
 * PostToolUse hook: `.ts` / `.vue` ファイルの編集後に ESLint を実行する。
 *
 * - 対象拡張子以外の編集は素通り（exit 0）
 * - `eslint --fix <file>` を直接実行（PM ラッパーや node_modules 探索はしない）
 * - eslint コマンドが見つからない（ENOENT）場合はスキップし、ユーザーに通知（exit 0）
 * - lint エラーが残った場合は stderr に出力し exit 2 で Claude にフィードバックする
 */

interface HookInput {
  tool_input?: {
    file_path?: string;
  };
  cwd?: string;
}

/** stdin を全て読み取って文字列として返す。 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** exit 0 + systemMessage でユーザーに通知してスキップする。 */
function skipWithNotice(message: string): never {
  const output = {
    suppressOutput: true,
    systemMessage: message,
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

const raw = await readStdin();

let input: HookInput;
try {
  input = JSON.parse(raw) as HookInput;
} catch {
  // 入力が解析できない場合は何もせず正常終了する。
  process.exit(0);
}

const filePath = input.tool_input?.file_path;

// 対象ファイルが無い、または `.ts` / `.vue` 以外なら素通り。
if (!filePath || !/\.(ts|vue)$/.test(filePath)) {
  process.exit(0);
}

const cwd = input.cwd ?? process.cwd();

let proc: ReturnType<typeof Bun.spawnSync>;
try {
  proc = Bun.spawnSync(["eslint", "--fix", filePath], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
} catch {
  // spawn 自体が例外を投げた場合（コマンド未検出など）はスキップ通知。
  skipWithNotice(
    "eslint が見つからないため lint をスキップしました。`pnpm install` 等で eslint が導入済みか確認してください。",
  );
}

// eslint コマンドが見つからない場合（ENOENT）は Bun.spawnSync が例外を投げるため、
// 上の try/catch でスキップ通知済み。ここに到達するのは eslint が起動できたケースのみ。
const stdout = proc.stdout.toString();
const stderr = proc.stderr.toString();

// lint が通った（または --fix で全て解消された）場合は正常終了。
if (proc.exitCode === 0) {
  process.exit(0);
}

// 修正不能な lint エラーが残っている場合は exit 2 で Claude にフィードバック。
const detail = [stdout, stderr].filter((s) => s.trim().length > 0).join("\n");
console.error(`ESLint で修正できない問題が残っています (${filePath}):\n${detail}`);
process.exit(2);
