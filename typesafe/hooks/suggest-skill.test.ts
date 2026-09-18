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

const SUGGESTED = {
  model: "test",
  answers: {
    which: {
      type: "choice",
      choice: "demo",
      confidence: 0.9,
      probabilities: { demo: 0.9, none: 0.1 },
    },
  },
};

const NO_FIT = {
  model: "test",
  answers: {
    which: {
      type: "choice",
      choice: "none",
      confidence: 0.9,
      probabilities: { demo: 0.1, none: 0.9 },
    },
  },
};

/** roster に demo スキル 1 件と、agents/ にエージェント定義を持つ偽の HOME を作る */
function createAgentFixtureHome(agentFrontmatter: string, fileName = "helper"): string {
  const home = createFixtureHome();
  const agentsDir = join(home, ".claude", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, `${fileName}.md`),
    ["---", agentFrontmatter, "---", "", "エージェント本文。"].join("\n"),
  );
  return home;
}

describe("suggest-skill フック", () => {
  test("TYPESAFE_API_KEY 未設定なら無出力で exit 0 で、ログにも何も書かない", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-nolog-"));
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s1" },
      { CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dataDir, "suggestions-v3.jsonl"))).toBe(false);
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
    const lines = readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd().split("\n");
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
    expect(existsSync(join(dataDir, "suggestions-v3.jsonl"))).toBe(false);
  });

  test("stdin が壊れた JSON でもキーが設定されていれば error として 1 行ログに残す", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-brokenstdin-log-"));
    const result = await runHook("{ broken", {
      TYPESAFE_API_KEY: "sk-test",
      CLAUDE_PLUGIN_DATA: dataDir,
    });
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const lines = readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}");
    expect(record.outcome).toBe("error");
    expect(record.error).toBe("malformed stdin payload");
  });

  test("提案ありなら skill_relevance ブロックを出力する", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([SUGGESTED]);
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

  test("none が選ばれたら提案なしブロックを出力する", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([NO_FIT]);
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

  test("PreToolUse の Bash で 5 章の形の request を組み立てて送る", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-bash-"));
    const server = startFakeServer([SUGGESTED]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
          cwd: home,
          session_id: "t1",
        },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      expect(result.exitCode).toBe(0);
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd(),
      );
      expect(record.event).toBe("PreToolUse");
      expect(record.tool_name).toBe("Bash");
      expect(record.prompt).toBe(
        'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
      );
    } finally {
      server.stop();
    }
  });

  test("PreToolUse の Agent は prompt を本体に使う", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-agent-"));
    const server = startFakeServer([SUGGESTED]);
    try {
      await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: {
            description: "Write the plan",
            prompt: "設計書から実装計画を書いてください",
            subagent_type: "general-purpose",
          },
          cwd: home,
          session_id: "t2",
        },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd(),
      );
      expect(record.tool_name).toBe("Agent");
      expect(record.prompt).toBe(
        "The assistant is about to perform this action:\nWrite the plan\n設計書から実装計画を書いてください",
      );
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で提案ありなら PreToolUse の hookEventName で行為向けの文面を出す", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([SUGGESTED]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: "git commit" },
          cwd: home,
          session_id: "t3",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            "<skill_relevance>Relevant to the action you are about to take: demo. If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.</skill_relevance>",
        },
      });
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で no_fit なら stdout に何も出さない", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([NO_FIT]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "List files", command: "ls typesafe/hooks" },
          cwd: home,
          session_id: "t4",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
      expect(server.requestCount()).toBe(1);
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で command が無ければ skipped で API を呼ばない", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-nobody-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "何かする" },
        cwd: home,
        session_id: "t6",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
    expect(record.event).toBe("PreToolUse");
  });

  test("サブエージェント内で agent_type が general-purpose なら提案する", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([SUGGESTED]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit", command: "git commit" },
          cwd: home,
          session_id: "t7",
          agent_id: "agent-1",
          agent_type: "general-purpose",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Relevant to the action you are about to take: demo");
    } finally {
      server.stop();
    }
  });

  test("サブエージェントの tools に Skill があれば提案する", async () => {
    const home = createAgentFixtureHome(
      "name: helper\ndescription: 手伝う\nmodel: sonnet\ntools: Read, Grep, Skill",
    );
    const server = startFakeServer([SUGGESTED]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit", command: "git commit" },
          cwd: home,
          session_id: "t8",
          agent_id: "agent-2",
          agent_type: "helper",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Relevant to the action you are about to take: demo");
    } finally {
      server.stop();
    }
  });

  test("サブエージェントの tools に Skill が無ければ API を呼ばず skipped", async () => {
    const home = createAgentFixtureHome(
      "name: reader\ndescription: 読むだけ\nmodel: sonnet\ntools: Read, Grep",
      "reader",
    );
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-noskill-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t9",
        agent_id: "agent-3",
        agent_type: "reader",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
    expect(record.agent_type).toBe("reader");
  });

  test("サブエージェントの定義が見つからなければ API を呼ばず skipped", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-nodef-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t10",
        agent_id: "agent-4",
        agent_type: "Explore",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
  });

  test("PreToolUse で API に到達できなくても無出力で exit 0、ログに event が残る", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-error-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t11",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("error");
    expect(record.event).toBe("PreToolUse");
    expect(record.tool_name).toBe("Bash");
  });

  test("提案ありなら 1 コール分の生の往復と noneProbability を残す", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-calls-"));
    const server = startFakeServer([SUGGESTED]);
    try {
      await runHook(
        { prompt: "demo スキルを使って", cwd: home, session_id: "c1" },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd(),
      );
      expect(record.calls).toHaveLength(1);
      expect(record.calls[0].url).toBe(`${server.url}/v1/systemone`);
      expect(record.calls[0].response.status).toBe(200);
      expect(record.calls[0].response.body).toEqual(SUGGESTED);
      expect(Object.keys(record.calls[0].request.questions)).toEqual(["which"]);
      expect(Object.keys(record.calls[0].request.questions["which"].criteria)).toEqual([
        "demo",
        "none",
      ]);
      expect(record.outcome).toBe("suggested");
      expect(record.winner).toBe("demo");
      expect(record.noneProbability).toBe(0.1);
      expect(record.shortlist).toEqual([{ name: "demo", probability: 0.9 }]);
    } finally {
      server.stop();
    }
  });

  test("応答が欠けて失敗しても、そこまでの calls は残る", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-calls-error-"));
    // which が無いので pipeline は応答の解釈で失敗する
    const server = startFakeServer([{ model: "test", answers: {} }]);
    try {
      const result = await runHook(
        { prompt: "demo スキルを使って", cwd: home, session_id: "c2" },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      expect(result.exitCode).toBe(0);
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions-v3.jsonl"), "utf8").trimEnd(),
      );
      expect(record.outcome).toBe("error");
      expect(record.calls).toHaveLength(1);
      expect(record.calls[0].response.status).toBe(200);
    } finally {
      server.stop();
    }
  });

  test("UserPromptSubmit の既存の挙動は変わらない（提案ありの文面と hookEventName）", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([SUGGESTED]);
    try {
      const result = await runHook(
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "demo スキルを使って",
          cwd: home,
          session_id: "t12",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
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
});
