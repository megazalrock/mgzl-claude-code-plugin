#!/usr/bin/env bun

/**
 * OpenAPIファイルからスケジュール関連のAPIを抽出するスクリプト
 * Usage: bun run extract-schedule-api.ts [オプション]
 *
 * オプション:
 *   --paths       パス情報のみを抽出
 *   --schemas     スキーマ情報のみを抽出
 *   --responses   レスポンス情報のみを抽出
 *   --all         すべての情報を抽出（デフォルト）
 *   --summary     エンドポイントのサマリー一覧を表示
 *   --help, -h    ヘルプを表示
 */

const OPENAPI_FILE = process.env.OPENAPI_FILE;
if (!OPENAPI_FILE) {
  console.error("ERROR: 環境変数 OPENAPI_FILE が設定されていません");
  process.exit(1);
}

// --- ユーティリティ ---

function filterEntries(
  obj: Record<string, unknown> | undefined,
  predicate: (key: string) => boolean,
): Record<string, unknown> {
  if (!obj) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => predicate(key)),
  )
}

function isScheduleRelated(key: string): boolean {
  return /schedule/i.test(key)
}

// --- 抽出関数 ---

interface OpenApiDoc {
  openapi?: string
  info?: Record<string, unknown>
  paths?: Record<string, Record<string, { summary?: string }>>
  components?: {
    schemas?: Record<string, unknown>
    responses?: Record<string, unknown>
  }
}

function extractPaths(doc: OpenApiDoc): object {
  return {
    paths: filterEntries(doc.paths, (key) => key.startsWith("/api/schedule")),
  }
}

function extractSchemas(doc: OpenApiDoc): object {
  return {
    schemas: filterEntries(doc.components?.schemas, isScheduleRelated),
  }
}

function extractResponses(doc: OpenApiDoc): object {
  return {
    responses: filterEntries(doc.components?.responses, isScheduleRelated),
  }
}

function extractSummary(doc: OpenApiDoc): string {
  const lines: string[] = []

  const schedulePaths = Object.entries(doc.paths ?? {}).filter(([key]) =>
    key.startsWith("/api/schedule"),
  )

  for (const [path, methods] of schedulePaths) {
    for (const [method, detail] of Object.entries(methods)) {
      const summary =
        (detail as { summary?: string }).summary ?? "No summary"
      lines.push(`${method.toUpperCase()}\t${path}\t${summary}`)
    }
  }

  if (lines.length === 0) {
    return ""
  }

  // カラム幅を計算して整列
  const rows = lines.map((line) => line.split("\t"))
  const colWidths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map((row) => (row[colIdx] ?? "").length)),
  )

  return rows
    .map((row) =>
      row.map((cell, i) => cell.padEnd(colWidths[i] ?? 0)).join("  "),
    )
    .join("\n")
}

function extractAll(doc: OpenApiDoc): object {
  return {
    openapi: doc.openapi,
    info: doc.info,
    paths: filterEntries(doc.paths, (key) => key.startsWith("/api/schedule")),
    components: {
      schemas: filterEntries(doc.components?.schemas, isScheduleRelated),
      responses: filterEntries(doc.components?.responses, isScheduleRelated),
    },
  }
}

function showHelp(): void {
  console.log(`Usage: bun run extract-schedule-api.ts [OPTION]

OpenAPIファイルからスケジュール関連のAPIを抽出します。

Options:
  --paths       パス情報のみを抽出
  --schemas     スキーマ情報のみを抽出
  --responses   レスポンス情報のみを抽出
  --summary     エンドポイントのサマリー一覧を表示
  --all         すべての情報を抽出（デフォルト）
  --help, -h    このヘルプを表示`)
}

// --- メイン処理 ---

const file = Bun.file(OPENAPI_FILE)

if (!(await file.exists())) {
  console.error(`Error: OpenAPI file not found at ${OPENAPI_FILE}`)
  process.exit(1)
}

const doc: OpenApiDoc = await file.json()
const option = process.argv[2] ?? "--all"

switch (option) {
  case "--paths":
    console.log(JSON.stringify(extractPaths(doc), null, 2))
    break
  case "--schemas":
    console.log(JSON.stringify(extractSchemas(doc), null, 2))
    break
  case "--responses":
    console.log(JSON.stringify(extractResponses(doc), null, 2))
    break
  case "--summary":
    console.log(extractSummary(doc))
    break
  case "--all":
    console.log(JSON.stringify(extractAll(doc), null, 2))
    break
  case "--help":
  case "-h":
    showHelp()
    break
  default:
    console.error(`Error: Unknown option: ${option}`)
    console.error("Use --help for usage information")
    process.exit(1)
}
