import { describe, expect, it } from "bun:test";
import { parseCodexEvents } from "./codex-events";

describe("parseCodexEvents", () => {
  it("正常終了の JSONL では errors が空で turnCompleted が true になる", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","exit_code":0,"status":"completed"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ].join("\n");

    const summary = parseCodexEvents(jsonl);

    expect(summary).toStrictEqual({ errors: [], turnFailed: false, turnCompleted: true });
  });

  it("type が error のイベントは message を errors に集める", () => {
    const jsonl = '{"type":"error","message":"quota exceeded"}';

    const summary = parseCodexEvents(jsonl);

    expect(summary.errors).toStrictEqual(["quota exceeded"]);
  });

  it("turn.failed は error.message を errors に集め turnFailed を true にする", () => {
    const jsonl = '{"type":"turn.failed","error":{"message":"model not supported"}}';

    const summary = parseCodexEvents(jsonl);

    expect(summary).toStrictEqual({
      errors: ["model not supported"],
      turnFailed: true,
      turnCompleted: false,
    });
  });

  it("item.type が error の item.completed は警告扱いで errors に入れない", () => {
    const jsonl =
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"metadata not found"}}';

    const summary = parseCodexEvents(jsonl);

    expect(summary.errors).toStrictEqual([]);
  });

  it("JSON として不正な行と空行は読み飛ばす", () => {
    const jsonl = ['not json', '', '{"type":"turn.completed"}'].join("\n");

    const summary = parseCodexEvents(jsonl);

    expect(summary.turnCompleted).toBe(true);
  });
});
