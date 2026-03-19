/**
 * コメントアウトされたコード検出 - 共有パターン・判定ロジック
 *
 * detect-diff.ts / detect-file.ts から共通利用される定数・関数を定義する。
 */

// --- 型定義 ---

export interface DetectedItem {
  file: string
  line: number
  content: string
}

// --- パターン定数 ---

/** テストファイル除外パターン */
export const TEST_FILE_PATTERNS = [
  /\.test\.(ts|vue)$/,
  /\.spec\.(ts|vue)$/,
  /__tests__\//,
  /__mocks__\//,
  /^test\//,
]

/** 正当なコメントとして除外するパターン */
export const VALID_COMMENT_PATTERNS = [
  /TODO/,
  /FIXME/,
  /NOTE:/,
  /MEMO:/,
  /WARN/,
  /HACK/,
  /XXX/,
  /@ts-expect-error/,
  /@ts-ignore/,
  /eslint-disable/,
  /eslint-enable/,
]

/** JSDocコメントパターン */
export const JSDOC_PATTERN = /^\s*(\*|\/\*\*|\*\/)/

/** // コメント内の JS/TS 構文キーワード */
export const JS_TS_SYNTAX_PATTERN =
  /\/\/.*\b(const |let |var |return |if\s*\(|else\s|else\{|for\s*\(|while\s*\(|import |export |await |async |function |class |switch |case |break|continue|throw |try\s|try\{|catch\s|catch\(|yield )/

/** // コメント内のメソッド呼び出し */
export const METHOD_CALL_PATTERN =
  /\/\/.*(this\.|\.set\(|\.get\(|\.push\(|\.map\(|\.filter\(|\.reduce\(|\.forEach\(|new )/

/** // コメント内の CSS プロパティ */
export const CSS_PROPERTY_PATTERN =
  /\/\/.*(background:|background-color:|color:|margin:|padding:|display:|border:|width:|height:|font-size:|font-weight:|position:|top:|left:|right:|bottom:|z-index:|opacity:|flex:|grid:)/

/** HTML コメント内の HTML タグ */
export const HTML_TAG_PATTERN =
  /<!--.*(<div|<span|<template|<component|<v-|<cb-|<p[ >]|<a[ >]|<ul|<li|<img|<input|<button|<form|<table|<slot)/

// --- 判定関数 ---

/** 正当なコメントかどうか判定 */
export const isValidComment = (content: string): boolean => {
  if (VALID_COMMENT_PATTERNS.some((pattern) => pattern.test(content))) {
    return true
  }
  if (JSDOC_PATTERN.test(content)) {
    return true
  }
  return false
}

/** コメントアウトされたコードかどうか判定 */
export const isCommentedOutCode = (content: string): boolean => {
  if (JS_TS_SYNTAX_PATTERN.test(content)) return true
  if (METHOD_CALL_PATTERN.test(content)) return true
  if (CSS_PROPERTY_PATTERN.test(content)) return true
  if (HTML_TAG_PATTERN.test(content)) return true
  return false
}

/** テストファイルを除外 */
export const excludeTestFiles = (files: string[]): string[] => {
  return files.filter(
    (file) => !TEST_FILE_PATTERNS.some((pattern) => pattern.test(file)),
  )
}
