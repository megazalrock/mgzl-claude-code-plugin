import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "suggest-skill.ts");

type RunResult = { stdout: string; stderr: string; exitCode: number };

/** TYPESAFE_* / CLAUDE_PLUGIN_DATA を明示的に組み立てた環境で hook を起動する */
async function runHook(
  payload: Record<string, unknown>,
  extraEnv: Record<string, string>,
): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TYPESAFE_")) continue;
    if (key === "CLAUDE_PLUGIN_DATA") continue;
    if (value !== undefined) env[key] = value;
  }
  const proc = Bun.spawn(["bun", "run", HOOK], {
    stdin: Buffer.from(JSON.stringify(payload)),
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

describe("suggest-skill フック", () => {
  test("TYPESAFE_API_KEY 未設定なら無出力で exit 0", async () => {
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s1" },
      {},
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
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

  test("stdin が壊れた JSON でも無出力で exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", HOOK], {
      stdin: Buffer.from("{ broken"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toBe("");
    expect(await proc.exited).toBe(0);
  });
});
