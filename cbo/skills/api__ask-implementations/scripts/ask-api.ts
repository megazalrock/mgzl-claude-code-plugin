#!/usr/bin/env bun
/**
 * APIリポジトリ調査スクリプト
 * Usage: bun ask-api.ts <調査内容>
 *
 * claude CLI の非対話モードでAPIリポジトリを調査する。
 */

const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "mcp__serena__list_dir",
  "mcp__serena__find_file",
  "mcp__serena__search_for_pattern",
  "mcp__serena__get_symbols_overview",
  "mcp__serena__find_symbol",
  "mcp__serena__find_referencing_symbols",
  "mcp__serena__read_memory",
  "mcp__serena__list_memories",
  "mcp__serena__think_about_collected_information",
] as const

const API_REPO_PATH = process.env.API_REPO_PATH;
if (!API_REPO_PATH) {
  console.error("ERROR: 環境変数 API_REPO_PATH が設定されていません");
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
    "--allowed-tools", ALLOWED_TOOLS.join(","),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-turns", "30",
  ],
  {
    cwd: API_REPO_PATH,
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
