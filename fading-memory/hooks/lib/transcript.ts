import { basename } from "node:path";
import { config } from "./config.ts";

/** トランスクリプトから抽出した会話本文と、その規模を表す統計 */
export interface ExtractedTranscript {
  /** 役割付きの会話本文。省略が発生した場合は先頭に注記行が付く */
  text: string;
  /** text の UTF-8 バイト数 */
  extractedBytes: number;
  /** 抽出対象になったメッセージ総数（省略されたものを含む） */
  messageCount: number;
  /** バイト予算に収まらず落とした古いメッセージの件数 */
  omittedMessages: number;
}

const MESSAGE_SEPARATOR = "\n\n";

/**
 * Claude Code が注入する system-reminder は会話の中身ではなく、
 * 1 メッセージで予算の大半を食い潰すため抽出前に取り除く。
 */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
}

function blockText(block: unknown): string | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as Record<string, unknown>;
  // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
  if (b["type"] !== "text") return null;
  return typeof b["text"] === "string" ? b["text"] : null;
}

/** 1 エントリから会話テキストを取り出す。会話以外のエントリなら null */
function entryText(entry: unknown): { role: string; text: string } | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する

  const type = e["type"];
  if (type !== "user" && type !== "assistant") return null;
  // isMeta はフック出力やシステム注入を user エントリとして記録したもので、会話ではない
  if (e["isMeta"] === true) return null;

  const message = e["message"];
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する

  const content = m["content"];
  let raw: string;
  if (typeof content === "string") {
    raw = content;
  } else if (Array.isArray(content)) {
    // tool_use の input・tool_result の出力・thinking・画像は記憶の材料にならず量だけ多い
    raw = content
      .map(blockText)
      .filter((t): t is string => t !== null)
      .join("\n");
  } else {
    return null;
  }

  const text = stripSystemReminders(raw).trim();
  return text === "" ? null : { role: type, text };
}

/**
 * UTF-8 バイト数で末尾側を切り出す。
 * バイト境界で切ると先頭に不正シーケンスが残るため、置換文字になった分を捨てる。
 */
function tailByBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  return buf.subarray(buf.byteLength - maxBytes).toString("utf8").replace(/^�+/, "");
}

/**
 * セッションのトランスクリプト（JSONL）から user / assistant の発話本文だけを抜き出す。
 * 子プロセスにファイルを読ませる代わりにプロンプトへ埋め込むための前処理。
 */
export function extractTranscriptText(
  jsonl: string,
  maxBytes: number = config.transcriptMaxBytes,
): ExtractedTranscript {
  const messages: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // 書き込み途中などで壊れた行は会話 1 件を諦めるだけにして続行する
      continue;
    }
    const m = entryText(entry);
    if (m !== null) messages.push(`${m.role}: ${m.text}`);
  }

  // 直近の文脈ほど記憶の材料として価値が高いので、末尾から詰めて古い側を落とす
  const kept: string[] = [];
  let usedBytes = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] ?? "";
    const cost = Buffer.byteLength(message, "utf8") + (kept.length === 0 ? 0 : MESSAGE_SEPARATOR.length);
    if (usedBytes + cost > maxBytes) break;
    usedBytes += cost;
    kept.unshift(message);
  }

  // 最新の 1 件だけで予算を超える場合は、空で返さず末尾側を切り詰めて残す
  if (kept.length === 0 && messages.length > 0) {
    kept.push(tailByBytes(messages[messages.length - 1] ?? "", maxBytes));
  }

  const omittedMessages = messages.length - kept.length;
  const body = kept.join(MESSAGE_SEPARATOR);
  const text =
    omittedMessages > 0
      ? `（古いメッセージ ${omittedMessages} 件は容量制限のため省略）${MESSAGE_SEPARATOR}${body}`
      : body;

  return {
    text,
    extractedBytes: Buffer.byteLength(text, "utf8"),
    messageCount: messages.length,
    omittedMessages,
  };
}

/** トランスクリプトのファイル名はセッション ID なので、ログ用にそこから取り出す */
export function sessionIdFromTranscriptPath(transcriptPath: string): string {
  return basename(transcriptPath).replace(/\.jsonl$/, "");
}
