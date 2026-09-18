import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { append, type HookEvent, LOG_FILE_NAME, type LogRecord } from "./log.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-log-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BASE: Omit<LogRecord, "ts"> = {
  session_id: "sess-1",
  cwd: "/Users/otto/workspace/mgzl-claude-code-plugin",
  event: "UserPromptSubmit",
  prompt: "この変更をコミットして",
  outcome: "suggested",
  winner: "mgzl:commiting-to-git",
  gate: {
    scores: {
      "gate::acts_on_user_system": 0.9,
      "gate::would_follow_documented_procedure": 0.8,
      "gate::prose_suffices": 0.1,
    },
    mean: 0.8666666666666667,
  },
  shortlist: [{ name: "mgzl:commiting-to-git", wideProbability: 0.7, rerankProbability: 0.9, fits: 0.95 }],
  rerankConfidence: 0.88,
  elapsedMs: 412,
  rosterSize: 48,
  error: undefined,
};

describe("append", () => {
  test("存在しないディレクトリを作って 1 行 1 JSON で追記する", () => {
    const dataDir = join(root, "fresh", "nested");
    append(BASE, dataDir);
    append({ ...BASE, outcome: "gate_quiet", winner: null }, dataDir);

    const lines = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(typeof first.ts).toBe("string");
    expect(new Date(first.ts).toISOString()).toBe(first.ts);
    expect(first.prompt).toBe("この変更をコミットして");
    expect(first.outcome).toBe("suggested");
    expect(first.winner).toBe("mgzl:commiting-to-git");
    expect(first.rosterSize).toBe(48);
    expect(JSON.parse(lines[1] ?? "{}").outcome).toBe("gate_quiet");
  });

  test("dataDir が未指定かつ CLAUDE_PLUGIN_DATA も未設定なら何も書かない", () => {
    const saved = process.env["CLAUDE_PLUGIN_DATA"];
    delete process.env["CLAUDE_PLUGIN_DATA"];
    try {
      expect(() => append(BASE, undefined)).not.toThrow();
    } finally {
      if (saved !== undefined) process.env["CLAUDE_PLUGIN_DATA"] = saved;
    }
  });

  test("dataDir 未指定でも CLAUDE_PLUGIN_DATA があればそこに書く（フォールバック）", () => {
    const saved = process.env["CLAUDE_PLUGIN_DATA"];
    const dataDir = join(root, "env-fallback");
    process.env["CLAUDE_PLUGIN_DATA"] = dataDir;
    try {
      append(BASE, undefined);
      const line = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd();
      expect(JSON.parse(line).prompt).toBe("この変更をコミットして");
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_PLUGIN_DATA"];
      else process.env["CLAUDE_PLUGIN_DATA"] = saved;
    }
  });

  test("書き込みに失敗しても例外を投げない", () => {
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "ファイルなのでディレクトリを作れない");
    expect(() => append(BASE, join(blocker, "under"))).not.toThrow();
  });

  test("error のときはメッセージを載せる", () => {
    const dataDir = join(root, "errors");
    append(
      {
        ...BASE,
        outcome: "error",
        winner: null,
        gate: null,
        shortlist: [],
        rerankConfidence: undefined,
        error: "TypeSafe System One returned 500",
      },
      dataDir,
    );
    const line = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd();
    expect(JSON.parse(line).error).toBe("TypeSafe System One returned 500");
  });

  test("event を記録する", () => {
    const dataDir = join(root, "events");
    append(BASE, dataDir);
    const line = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd();
    expect(JSON.parse(line).event).toBe("UserPromptSubmit");
  });

  test("PreToolUse では tool_name と agent_type も記録する", () => {
    const dataDir = join(root, "pretooluse");
    const event: HookEvent = "PreToolUse";
    append(
      {
        ...BASE,
        event,
        tool_name: "Bash",
        agent_type: "mgzl:budgeted-investigator",
        prompt:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        gate: { scores: { "gate::routine_step": 0.05 }, mean: 0.95 },
      },
      dataDir,
    );
    const record = JSON.parse(readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd());
    expect(record.event).toBe("PreToolUse");
    expect(record.tool_name).toBe("Bash");
    expect(record.agent_type).toBe("mgzl:budgeted-investigator");
    expect(record.gate).toEqual({ scores: { "gate::routine_step": 0.05 }, mean: 0.95 });
  });

  test("tool_name / agent_type を渡さなければキー自体が入らない", () => {
    const dataDir = join(root, "no-tool-fields");
    append(BASE, dataDir);
    const record = JSON.parse(readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd());
    expect("tool_name" in record).toBe(false);
    expect("agent_type" in record).toBe(false);
  });
});
