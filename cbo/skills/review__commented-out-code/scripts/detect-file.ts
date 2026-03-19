#!/usr/bin/env bun
/**
 * コメントアウトされたコード検出スクリプト（ファイルモード）
 * Usage: bun detect-file.ts <file1> [file2 ...]
 *
 * 指定されたファイルの全行を走査し、コメントアウトされたコードを検出する。
 * テストファイル・モックファイルは対象外。
 */

import type { DetectedItem } from './patterns'
import {
  excludeTestFiles,
  isCommentedOutCode,
  isValidComment,
} from './patterns'

// --- メイン処理 ---

const filePaths = process.argv.slice(2)
if (filePaths.length === 0) {
  console.error(
    'ERROR: 検出対象のファイルパスを1つ以上指定してください。',
  )
  process.exit(1)
}

/** ファイルの全行を走査してコメントアウトされたコードを検出 */
const detectFromFile = (content: string, filepath: string): DetectedItem[] => {
  const items: DetectedItem[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    if (isValidComment(line)) continue
    if (isCommentedOutCode(line)) {
      items.push({
        file: filepath,
        line: i + 1,
        content: line.trim(),
      })
    }
  }

  return items
}

// --- 実行 ---

const targetFiles = excludeTestFiles(filePaths)
if (targetFiles.length === 0) {
  console.log('テストファイル以外の対象ファイルがありません')
  process.exit(0)
}

// 存在チェック
const existingFiles: string[] = []
for (const filepath of targetFiles) {
  const file = Bun.file(filepath)
  if (await file.exists()) {
    existingFiles.push(filepath)
  } else {
    console.error(`WARN: ファイルが見つかりません: ${filepath}`)
  }
}

if (existingFiles.length === 0) {
  console.log('対象ファイルが存在しません')
  process.exit(0)
}

const allDetected: DetectedItem[] = []

for (const filepath of existingFiles) {
  const content = await Bun.file(filepath).text()
  const detected = detectFromFile(content, filepath)
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
console.log(`TARGET_COUNT:${existingFiles.length}`)
