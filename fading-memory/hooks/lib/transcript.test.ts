import { describe, expect, test } from "bun:test";
import { extractTranscriptText, sessionIdFromTranscriptPath } from "./transcript.ts";

function line(entry: unknown): string {
  return JSON.stringify(entry);
}

function userText(text: string): string {
  return line({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

function assistantText(text: string): string {
  return line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("extractTranscriptText", () => {
  test("user / assistant のテキストだけを役割付きで抽出する", () => {
    const jsonl = [userText("こんにちは"), assistantText("はい")].join("\n");
    const r = extractTranscriptText(jsonl);
    expect(r.text).toBe("user: こんにちは\n\nassistant: はい");
    expect(r.messageCount).toBe(2);
    expect(r.omittedMessages).toBe(0);
  });

  test("content が文字列のエントリも抽出する", () => {
    const jsonl = line({ type: "user", message: { role: "user", content: "素の文字列" } });
    expect(extractTranscriptText(jsonl).text).toBe("user: 素の文字列");
  });

  test("thinking / tool_use / tool_result / image ブロックを落とす", () => {
    const jsonl = [
      line({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "内心", signature: "sig" },
            { type: "text", text: "本文" },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "巨大な出力" },
            { type: "image", source: { type: "base64", data: "AAAABBBB" } },
          ],
        },
      }),
    ].join("\n");
    const r = extractTranscriptText(jsonl);
    expect(r.text).toBe("assistant: 本文");
    expect(r.text).not.toContain("内心");
    expect(r.text).not.toContain("ls");
    expect(r.text).not.toContain("巨大な出力");
    expect(r.text).not.toContain("AAAABBBB");
    expect(r.messageCount).toBe(1);
  });

  test("system / summary / progress / attachment などのエントリを落とす", () => {
    const jsonl = [
      line({ type: "mode", mode: "normal", sessionId: "s1" }),
      line({ type: "file-history-snapshot", snapshot: {} }),
      line({ type: "summary", summary: "要約" }),
      line({ type: "system", content: "システム" }),
      line({ type: "progress", data: {} }),
      line({ type: "user", isMeta: true, message: { role: "user", content: "メタ注入" } }),
      line({ parentUuid: null, attachment: { type: "hook_success", stdout: "フック出力" } }),
      userText("本題"),
    ].join("\n");
    const r = extractTranscriptText(jsonl);
    expect(r.text).toBe("user: 本題");
    expect(r.messageCount).toBe(1);
  });

  test("system-reminder ブロックを除去する", () => {
    const jsonl = userText("前<system-reminder>長大な注入\n複数行</system-reminder>後");
    expect(extractTranscriptText(jsonl).text).toBe("user: 前後");
  });

  test("壊れた行は読み飛ばす", () => {
    const jsonl = ["{壊れたJSON", "", "   ", "null", "123", userText("有効")].join("\n");
    const r = extractTranscriptText(jsonl);
    expect(r.text).toBe("user: 有効");
    expect(r.messageCount).toBe(1);
  });

  test("空文字だけのメッセージは数えない", () => {
    const jsonl = [userText("   "), assistantText("中身")].join("\n");
    expect(extractTranscriptText(jsonl).messageCount).toBe(1);
  });

  test("バイト予算を超える場合は末尾を優先し古いメッセージを落とす", () => {
    const jsonl = [
      userText("A".repeat(100)),
      userText("B".repeat(100)),
      assistantText("C".repeat(100)),
    ].join("\n");
    const r = extractTranscriptText(jsonl, 260);
    expect(r.text).toContain("C".repeat(100));
    expect(r.text).toContain("B".repeat(100));
    expect(r.text).not.toContain("A".repeat(100));
    expect(r.omittedMessages).toBe(1);
    expect(r.messageCount).toBe(3);
    expect(r.text).toContain("1");
  });

  test("省略が無ければ省略の注記を付けない", () => {
    const r = extractTranscriptText(userText("短い"), 10_000);
    expect(r.omittedMessages).toBe(0);
    expect(r.text).toBe("user: 短い");
  });

  test("1 件で予算を超えるメッセージは末尾側を残して切り詰める", () => {
    const r = extractTranscriptText(userText(`${"X".repeat(200)}END`), 60);
    expect(r.text).toContain("END");
    expect(r.text).not.toContain("X".repeat(200));
    expect(r.extractedBytes).toBeLessThanOrEqual(200);
  });

  test("マルチバイト文字の途中で切っても不正な文字列にしない", () => {
    const r = extractTranscriptText(userText("あ".repeat(100)), 40);
    expect(r.text).not.toContain("�");
  });

  test("extractedBytes は text の UTF-8 バイト数と一致する", () => {
    const r = extractTranscriptText([userText("日本語"), assistantText("ok")].join("\n"));
    expect(r.extractedBytes).toBe(Buffer.byteLength(r.text, "utf8"));
  });

  test("空のトランスクリプトでも落ちない", () => {
    const r = extractTranscriptText("");
    expect(r.text).toBe("");
    expect(r.messageCount).toBe(0);
    expect(r.omittedMessages).toBe(0);
  });
});

describe("sessionIdFromTranscriptPath", () => {
  test("ファイル名から拡張子を除いた値を返す", () => {
    expect(sessionIdFromTranscriptPath("/a/b/0f0651d4-5169-4d17-ba17-f50d72048ad7.jsonl")).toBe(
      "0f0651d4-5169-4d17-ba17-f50d72048ad7",
    );
  });

  test("拡張子が無い場合はファイル名をそのまま返す", () => {
    expect(sessionIdFromTranscriptPath("/a/b/session")).toBe("session");
  });
});
