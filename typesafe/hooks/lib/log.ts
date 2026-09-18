import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JevCall } from "./jev.ts";
import type { GateScores, Outcome, ShortlistItem } from "./pipeline.ts";

/** pipeline の 3 経路に、入口で打ち切った skipped と失敗した error を足したもの */
export type LogOutcome = Outcome | "skipped" | "error";

/** フックが発火したイベント。event を持たない既存レコードは UserPromptSubmit とみなす */
export type HookEvent = "UserPromptSubmit" | "PreToolUse";

export type LogRecord = {
  /** ISO 8601 */
  ts: string;
  session_id: string;
  cwd: string;
  event: HookEvent;
  /** PreToolUse のときのみ。"Bash" / "Agent" */
  tool_name?: string;
  /** サブエージェント内で発火したときのみ */
  agent_type?: string;
  /** UserPromptSubmit は依頼文の全文、PreToolUse は組み立て後の request 文 */
  prompt: string;
  outcome: LogOutcome;
  winner: string | null;
  gate: GateScores | null;
  shortlist: ShortlistItem[];
  /** そのターンで実際に投げた API の往復。API を呼ばなかった経路では空配列 */
  calls: JevCall[];
  elapsedMs: number;
  rosterSize: number;
  error?: string;
};

export const LOG_FILE_NAME = "suggestions-v2.jsonl";

/**
 * 提案の記録を 1 行 1 JSON で追記する。dataDir 未指定なら何もしない。
 * 書き込み失敗は握りつぶす。ログの都合で hook を落とさないため。
 */
export function append(record: Omit<LogRecord, "ts">, dataDir?: string): void {
  const dir = dataDir ?? process.env["CLAUDE_PLUGIN_DATA"];
  if (dir === undefined || dir === "") return;
  try {
    mkdirSync(dir, { recursive: true });
    const line: LogRecord = { ts: new Date().toISOString(), ...record };
    appendFileSync(join(dir, LOG_FILE_NAME), `${JSON.stringify(line)}\n`);
  } catch {
    return;
  }
}
