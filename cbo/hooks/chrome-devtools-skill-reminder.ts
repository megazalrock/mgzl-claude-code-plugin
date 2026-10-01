#!/usr/bin/env bun

/**
 * PreToolUse hook: chrome-devtools 系 MCP のツールの初回呼び出し時に、
 * `cbo:chrome-devtools` スキルの読み込みを促す。対象は headed / headless の両サーバー。
 *
 * 背景（issue #68）: 実装計画の途中など、ユーザーの明示依頼がない流れで起きた問題。
 * モデルがスキルを読まずに MCP ツールを直接呼び、dialog 対処の知見が適用されなかった。
 * その結果 evaluate_script がタイムアウトするまで止まっていた。
 * スキルの description だけでは発動を保証できないため、ツール呼び出し側から結び付ける。
 *
 * - ツール呼び出しはブロックしない。`additionalContext` で案内だけを Claude に渡す
 * - 案内は会話コンテキスト（メイン / 各サブエージェント）ごとに初回だけ。毎回出すと
 *   ブラウザ操作のたびにコンテキストを消費するため
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface HookInput {
  session_id?: string;
  // サブエージェント内の呼び出しでのみ付与される。サブエージェントはメインと
  // コンテキストを共有しないので、メインで案内済みでも別途案内する必要がある。
  agent_id?: string;
}

const REMINDER =
  "chrome-devtools MCP のツールを使う前に、まだ読み込んでいなければ Skill ツールで `cbo:chrome-devtools` スキルを読み込んでください。beforeunload / confirm などの dialog で evaluate_script 等が応答せずタイムアウトする既知の問題への対処や、headed / headless の使い分けがまとめられています。";

/** stdin を全て読み取って文字列として返す。 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** 案内を additionalContext として出力して終了する。許可判定には関与しない。 */
function remind(): never {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: REMINDER,
    },
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

/**
 * 初回判定用マーカーの置き場所。
 * CLAUDE_PLUGIN_DATA が無い環境（手動実行や旧バージョンの Claude Code）では OS の一時
 * ディレクトリを使う。マーカーはセッション中だけ意味を持つ使い捨てなので、
 * 再起動で消えても案内が 1 回余分に出るだけで実害がない。
 */
function markerDir(): string {
  const base = process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "cbo-plugin-data");
  return join(base, "chrome-devtools-skill-reminder");
}

const raw = await readStdin();

let input: HookInput;
try {
  // JSON.parse は unknown 相当の any を返すため、hook 入力の既知の形として扱う。
  input = JSON.parse(raw) as HookInput;
} catch {
  // 入力が解析できない場合はツール呼び出しを妨げないよう何もせず終了する。
  process.exit(0);
}

const sessionId = input.session_id;

// session_id が無いと初回判定ができない。案内の重複は、案内の欠落より安全なので毎回出す。
if (!sessionId) {
  remind();
}

// ファイル名に使うため、パス区切りなどを含む値が来ても安全な文字だけに絞る。
const key = [sessionId, input.agent_id ?? "main"]
  .map((s) => s.replace(/[^A-Za-z0-9_-]/g, "_"))
  .join("__");
const dir = markerDir();
const marker = join(dir, key);

if (existsSync(marker)) {
  process.exit(0);
}

try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(marker, "");
} catch {
  // マーカーを書けなくても案内は出す（次回以降も案内が出続けるだけ）。
}

remind();
