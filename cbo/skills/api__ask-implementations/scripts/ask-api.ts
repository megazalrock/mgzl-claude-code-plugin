#!/usr/bin/env bun
/**
 * APIリポジトリ調査スクリプト
 * Usage:
 *   bun run ask-api.ts <調査内容>
 *   bun run ask-api.ts --resume <session_id> <追加質問>
 *
 * claude CLI の非対話モードでAPIリポジトリを調査する。
 * 回答本文の後に最終行として `session_id=<id>` を出力し、呼び出し側が --resume で追加質問できるようにする。
 */

const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
] as const

const API_REPO_PATH = process.env.API_REPO_PATH;
if (!API_REPO_PATH) {
  console.error("ERROR: 環境変数 API_REPO_PATH が設定されていません");
  process.exit(1);
}

// --- 引数の解析 ---

const args = process.argv.slice(2)
let resumeSessionId: string | undefined
if (args[0] === "--resume") {
  resumeSessionId = args[1]
  if (!resumeSessionId) {
    console.error("ERROR: --resume には session_id を指定してください")
    process.exit(1)
  }
  args.splice(0, 2)
}

const query = args.join(" ")
if (!query) {
  console.error("ERROR: 調査内容を指定してください")
  process.exit(1)
}

// --- claude CLI の実行 ---

type ClaudeResult = {
  subtype: string
  is_error: boolean
  result?: string
  session_id?: string
}

const isClaudeResult = (value: unknown): value is ClaudeResult => {
  if (typeof value !== "object" || value === null) return false
  if (!("subtype" in value) || typeof value.subtype !== "string") return false
  if (!("is_error" in value) || typeof value.is_error !== "boolean") return false
  if ("result" in value && typeof value.result !== "string") return false
  if ("session_id" in value && typeof value.session_id !== "string") return false
  return true
}

const proc = Bun.spawn(
  [
    "claude",
    "-p",
    "--model", "opus",
    "--effort", "high",
    "--allowed-tools", ALLOWED_TOOLS.join(","),
    "--disable-slash-commands",
    "--max-turns", "30",
    "--output-format", "json",
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
  ],
  {
    // セッションはプロジェクトディレクトリ単位で保存されるため、resume 時も同じ cwd で起動する必要がある
    cwd: API_REPO_PATH,
    stdin: new Blob([query]),
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      CLAUDECODE: "", // 親プロセスの設定継承を防止
    },
  },
)

const [stdout, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  proc.exited,
])

const failExitCode = exitCode === 0 ? 1 : exitCode

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const parsed = parseJson(stdout)
if (!isClaudeResult(parsed)) {
  // 存在しない session_id を --resume に渡した場合などは、JSON を出さず stderr にだけ理由が出る
  console.error(`ERROR: claude CLI の出力を解析できませんでした (exit=${exitCode})。原因は直前の stderr を確認してください`)
  if (stdout.trim()) console.error(stdout.trim())
  process.exit(failExitCode)
}

// max turns 到達時などでもセッションは保存されているため、session_id があれば出力して再開可能にする
const sessionLine = parsed.session_id ? `session_id=${parsed.session_id}` : undefined

if (exitCode !== 0 || parsed.is_error || parsed.subtype !== "success") {
  console.error(`ERROR: claude CLI が失敗しました (exit=${exitCode}, subtype=${parsed.subtype})`)
  if (parsed.result) console.error(parsed.result)
  if (sessionLine) console.log(sessionLine)
  process.exit(failExitCode)
}

console.log(parsed.result ?? "")
if (sessionLine) console.log(sessionLine)
