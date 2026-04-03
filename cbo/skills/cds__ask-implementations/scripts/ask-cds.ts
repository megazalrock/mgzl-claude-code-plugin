#!/usr/bin/env bun
/**
 * デザインシステムリポジトリ調査スクリプト
 * Usage: bun run ask-cds.ts <調査内容>
 *
 * claude CLI の非対話モードでデザインシステムリポジトリを調査する。
 */

const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
] as const

const CDS_REPO_PATH = process.env.CDS_REPO_PATH;
if (!CDS_REPO_PATH) {
  console.error("ERROR: 環境変数 CDS_REPO_PATH が設定されていません");
  process.exit(1);
}

// --- メイン処理 ---

const query = process.argv.slice(2).join(" ")
if (!query) {
  console.error("ERROR: 調査内容を指定してください")
  process.exit(1)
}

const proc = Bun.spawn(
  [
    "claude",
    "-p",
    "--model", "opus",
    "--effort", "high",
    "--allowed-tools", ALLOWED_TOOLS.join(","),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns", "30",
  ],
  {
    cwd: CDS_REPO_PATH,
    stdin: new Blob([query]),
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      CLAUDECODE: "", // 親プロセスの設定継承を防止
    },
  },
)

const exitCode = await proc.exited
process.exit(exitCode)
