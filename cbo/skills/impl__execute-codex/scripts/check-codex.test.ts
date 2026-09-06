// SKILL_DIR/scripts/check-codex.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "check-codex.ts");
const fakeCodex = `bun run ${join(import.meta.dir, "test-fixtures", "fake-codex.ts")}`;

const runCheck = async (env: Record<string, string>): Promise<{ stdout: string; exitCode: number }> => {
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
};

describe("check-codex", () => {
  it("codex --version が成功すれば status=ok と version を出力する", async () => {
    const result = await runCheck({ IMPL_EXECUTE_CODEX_BIN: fakeCodex, FAKE_CODEX_MODE: "ok" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status=ok\nversion=codex-cli 0.0.0-fake\n");
  });

  it("バイナリが見つからなければ status=ng reason=not_found を出力する", async () => {
    const result = await runCheck({ IMPL_EXECUTE_CODEX_BIN: "/nonexistent/codex-xyz" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("status=ng\n");
    expect(result.stdout).toContain("reason=not_found\n");
  });

  it("codex --version が非 0 で終わればreason=exec_failed と stderr 先頭行を出力する", async () => {
    const result = await runCheck({
      IMPL_EXECUTE_CODEX_BIN: fakeCodex,
      FAKE_CODEX_MODE: "version_fail",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("status=ng\nreason=exec_failed\ndetail=boom\n");
  });
});
