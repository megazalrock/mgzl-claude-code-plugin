import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "suggest-skill.ts");

type RunResult = { stdout: string; stderr: string; exitCode: number };

/**
 * TYPESAFE_* / CLAUDE_PLUGIN_DATA を明示的に組み立てた環境で hook を起動する。
 * payload がオブジェクトなら JSON にして渡し、文字列ならそのまま stdin に渡す
 * （壊れた JSON を送るテスト用）。
 */
async function runHook(
  payload: Record<string, unknown> | string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TYPESAFE_")) continue;
    if (key === "CLAUDE_PLUGIN_DATA") continue;
    if (value !== undefined) env[key] = value;
  }
  const stdin = typeof payload === "string" ? payload : JSON.stringify(payload);
  const proc = Bun.spawn(["bun", "run", HOOK], {
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, ...extraEnv },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** 到達できないポートを指すので、ここへ実際に出れば必ず失敗する */
const UNREACHABLE = { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: "http://127.0.0.1:9" };

/** roster に demo スキル 1 件だけを持つ偽の HOME を作る */
function createFixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), "suggest-skill-home-"));
  const skillDir = join(home, ".claude", "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    ["---", "name: demo", "description: Demo skill used only in tests.", "---", "", "Demo body."].join(
      "\n",
    ),
  );
  return home;
}

type FakeServer = { url: string; requestCount: () => number; stop: () => void };

/** System One の応答を順番に返すだけの偽サーバ。responses を使い切ったら最後の応答を繰り返す */
function startFakeServer(responses: readonly unknown[]): FakeServer {
  let count = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      const index = Math.min(count, responses.length - 1);
      count++;
      return new Response(JSON.stringify(responses[index]), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requestCount: () => count,
    stop: () => server.stop(true),
  };
}

const CALL1_SUGGESTED = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.9, probabilities: { demo: 0.9 } },
    "gate::acts_on_user_system": { type: "noul", noul: 0.9 },
    "gate::would_follow_documented_procedure": { type: "noul", noul: 0.9 },
    "gate::prose_suffices": { type: "noul", noul: 0.1 },
  },
};

const CALL1_GATE_QUIET = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.9, probabilities: { demo: 0.9 } },
    "gate::acts_on_user_system": { type: "noul", noul: 0.1 },
    "gate::would_follow_documented_procedure": { type: "noul", noul: 0.1 },
    "gate::prose_suffices": { type: "noul", noul: 0.9 },
  },
};

const CALL2_ANSWER = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.9, probabilities: { demo: 0.9 } },
    "fits::demo": { type: "noul", noul: 0.9 },
  },
};

describe("suggest-skill フック", () => {
  test("TYPESAFE_API_KEY 未設定なら無出力で exit 0 で、ログにも何も書かない", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-nolog-"));
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s1" },
      { CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dataDir, "suggestions.jsonl"))).toBe(false);
  });

  test("prompt が / で始まるなら無出力で exit 0", async () => {
    const result = await runHook(
      { prompt: "/mgzl:commiting-to-git", cwd: process.cwd(), session_id: "s2" },
      UNREACHABLE,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("prompt が空なら無出力で exit 0", async () => {
    const result = await runHook({ prompt: "", cwd: process.cwd(), session_id: "s3" }, UNREACHABLE);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("API に到達できなくても無出力で exit 0（フェイルオープン）", async () => {
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s4" },
      UNREACHABLE,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("API に到達できないエラーでも、ログには元の prompt と session_id を残す", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-errorlog-"));
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s4b" },
      { ...UNREACHABLE, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const lines = readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record.outcome).toBe("error");
    expect(record.prompt).toBe("この変更をコミットして");
    expect(record.session_id).toBe("s4b");
  });

  test("stdin が壊れた JSON でも無出力で exit 0", async () => {
    const result = await runHook("{ broken", {});
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("stdin が壊れた JSON かつキー未設定なら、ログにも何も書かない", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-brokenstdin-nolog-"));
    const result = await runHook("{ broken", { CLAUDE_PLUGIN_DATA: dataDir });
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dataDir, "suggestions.jsonl"))).toBe(false);
  });

  test("stdin が壊れた JSON でもキーが設定されていれば error として 1 行ログに残す", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-brokenstdin-log-"));
    const result = await runHook("{ broken", {
      TYPESAFE_API_KEY: "sk-test",
      CLAUDE_PLUGIN_DATA: dataDir,
    });
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const lines = readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record.outcome).toBe("error");
    expect(record.error).toBe("malformed stdin payload");
  });

  test("提案ありなら skill_relevance ブロックを出力する", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        { prompt: "demo スキルを使って", cwd: home, session_id: "s5" },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "<skill_relevance>Relevant to the current request: demo. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>",
        },
      });
    } finally {
      server.stop();
    }
  });

  test("gate が静かなら提案なしブロックを出力し Call 2 を呼ばない", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([CALL1_GATE_QUIET]);
    try {
      const result = await runHook(
        { prompt: "今日の天気は？", cwd: home, session_id: "s6" },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "<skill_relevance>No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.</skill_relevance>",
        },
      });
      expect(server.requestCount()).toBe(1);
    } finally {
      server.stop();
    }
  });
});
