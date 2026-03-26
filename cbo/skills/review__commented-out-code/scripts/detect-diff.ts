#!/usr/bin/env bun
/**
 * コメントアウトされたコード検出スクリプト（diff モード）
 * Usage: bun run detect-diff.ts <base_ref>
 *
 * git diff の追加行から、コメントアウトされたコードを検出する。
 * テストファイル・モックファイルは対象外。
 */

import { $ } from 'bun'
import type { DetectedItem } from './patterns'
import {
  excludeTestFiles,
  isCommentedOutCode,
  isValidComment,
} from './patterns'

// --- メイン処理 ---

const baseRef = process.argv[2]
if (!baseRef) {
  console.error(
    'ERROR: 比較対象のブランチ名、コミットハッシュ、またはタグを指定してください。',
  )
  process.exit(1)
}

/** git diff --name-only で差分ファイル一覧を取得 */
const getDiffFiles = async (): Promise<string[]> => {
  const result = await $`git diff --name-only ${baseRef}...HEAD`.text()
  return result
    .trim()
    .split('\n')
    .filter((f) => f.length > 0)
}

/** git diff 出力を解析して追加行からコメントアウトされたコードを検出 */
const detectFromDiff = (diffOutput: string, filepath: string): DetectedItem[] => {
  const items: DetectedItem[] = []
  let currentLine = 0

  for (const line of diffOutput.split('\n')) {
    // @@ ヘッダーから新ファイル側の行番号を取得
    const hunkMatch = line.match(/^@@\s.*\+(\d+)/)
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]) - 1
      continue
    }

    // ヘッダー行は無視
    if (line.startsWith('+++') || line.startsWith('---')) continue
    // 削除行は無視
    if (line.startsWith('-')) continue
    // "\ No newline" 行は無視
    if (line.startsWith('\\')) continue

    // 追加行
    if (line.startsWith('+')) {
      currentLine++
      const content = line.slice(1)

      if (isValidComment(content)) continue
      if (isCommentedOutCode(content)) {
        items.push({
          file: filepath,
          line: currentLine,
          content: content.trim(),
        })
      }
    } else {
      // コンテキスト行
      currentLine++
    }
  }

  return items
}

// --- 実行 ---

const allFiles = await getDiffFiles()
if (allFiles.length === 0) {
  console.log('差分ファイルがありません')
  process.exit(0)
}

const targetFiles = excludeTestFiles(allFiles)
if (targetFiles.length === 0) {
  console.log('テストファイル以外の差分ファイルがありません')
  process.exit(0)
}

const allDetected: DetectedItem[] = []

for (const file of targetFiles) {
  const diffOutput =
    await $`git diff ${baseRef}...HEAD -- ${file}`.text()
  const detected = detectFromDiff(diffOutput, file)
  allDetected.push(...detected)
}

// 結果出力（TSV形式: file \t line \t content）
if (allDetected.length === 0) {
  console.log('RESULT:0')
} else {
  for (const item of allDetected) {
    console.log(`DETECTED\t${item.file}\t${item.line}\t${item.content}`)
  }
  console.log(`RESULT:${allDetected.length}`)
}
console.log(`TARGET_COUNT:${targetFiles.length}`)
