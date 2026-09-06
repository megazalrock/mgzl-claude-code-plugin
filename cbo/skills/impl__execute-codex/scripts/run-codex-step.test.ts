import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "run-codex-step.ts");
const fakeCodex = `bun run ${join(import.meta.dir, "test-fixtures", "fake-codex.ts")}`;

type RunResult = { stdout: string; exitCode: number; lines: Record<string, string> };

const parseLines = (stdout: string): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      record[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return record;
};

const gitInit = async (dir: string): Promise<void> => {
  const init = Bun.spawn(["git", "init", "-q", dir], { stdout: "ignore", stderr: "ignore" });
  await init.exited;
};

let workDir: string;
let promptFile: string;
let outsideDir: string;

beforeEach(async () => {
  workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "run-codex-step-"));
  await gitInit(workDir);
  promptFile = join(workDir, "prompt.md");
  writeFileSync(promptFile, "## ステップ 1\nfoo を実装する\n");
  // fake-codex が受信プロンプトを記録する先。git 管理下の workDir の外に置き、
  // git status の差分（changed_files）に混入しないようにする
  outsideDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "run-codex-step-out-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

const runStep = async (args: {
  mode: string;
  role?: string;
  extraArgs?: string[];
  promptOut?: string;
}): Promise<RunResult> => {
  const cliArgs =
    args.extraArgs ?? ["--prompt", promptFile, "--cwd", workDir, "--role", args.role ?? "impl"];
  const proc = Bun.spawn(["bun", "run", scriptPath, ...cliArgs], {
    env: {
      ...process.env,
      IMPL_EXECUTE_CODEX_BIN: fakeCodex,
      FAKE_CODEX_MODE: args.mode,
      ...(args.promptOut === undefined ? {} : { FAKE_CODEX_PROMPT_OUT: args.promptOut }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode, lines: parseLines(stdout) };
};

describe("run-codex-step", () => {
  it("成功時は status=ok と変更ファイル・最終メッセージを出力する", async () => {
    const result = await runStep({ mode: "ok" });

    expect(result.exitCode).toBe(0);
    expect(result.lines.status).toBe("ok");
    expect(result.lines.changed_files).toBe("src/generated.ts");
    expect(result.lines.summary).toBe("実装しました。");
    expect(existsSync(result.lines.last_message_file ?? "")).toBe(true);
  });

  it("role に応じた規約ヘッダをプロンプトの先頭に連結して渡す", async () => {
    const promptOut = join(outsideDir, "received-prompt.txt");
    await runStep({ mode: "ok", role: "test", promptOut });

    const received = readFileSync(promptOut, "utf8");
    expect(received.startsWith("# 実装依頼（テストコード）")).toBe(true);
    expect(received).toContain("## ステップ 1\nfoo を実装する");
  });

  it("実行前から変更済みだったファイルは changed_files に含めない", async () => {
    writeFileSync(join(workDir, "pre-existing.txt"), "dirty\n");

    const result = await runStep({ mode: "ok" });

    expect(result.lines.changed_files).toBe("src/generated.ts");
  });

  it("error イベントがあれば reason=error_event で停止する", async () => {
    const result = await runStep({ mode: "error_event" });

    expect(result.exitCode).toBe(1);
    expect(result.lines.status).toBe("error");
    expect(result.lines.reason).toBe("error_event");
    expect(result.lines.detail).toContain("quota exceeded");
  });

  it("非 0 終了で error イベントが無ければ reason=nonzero_exit", async () => {
    const result = await runStep({ mode: "nonzero_exit" });

    expect(result.lines.reason).toBe("nonzero_exit");
    expect(result.lines.detail).toContain("codex crashed");
  });

  it("最終メッセージファイルが無ければ reason=no_last_message", async () => {
    const result = await runStep({ mode: "no_last_message" });

    expect(result.lines.reason).toBe("no_last_message");
  });

  it("変更ファイルが 0 件なら reason=no_changes", async () => {
    const result = await runStep({ mode: "nochange" });

    expect(result.lines.reason).toBe("no_changes");
  });

  it("cwd が git 管理外なら reason=git_failed", async () => {
    const plainDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "no-git-"));
    const result = await runStep({
      mode: "ok",
      extraArgs: ["--prompt", promptFile, "--cwd", plainDir, "--role", "impl"],
    });
    rmSync(plainDir, { recursive: true, force: true });

    expect(result.lines.reason).toBe("git_failed");
  });

  it("引数が不足していれば reason=invalid_args", async () => {
    const result = await runStep({ mode: "ok", extraArgs: ["--prompt", promptFile] });

    expect(result.exitCode).toBe(1);
    expect(result.lines.reason).toBe("invalid_args");
  });

  it("--prompt のファイルが存在しなければ reason=invalid_args", async () => {
    const missingPrompt = join(workDir, "does-not-exist.md");
    const result = await runStep({
      mode: "ok",
      extraArgs: ["--prompt", missingPrompt, "--cwd", workDir, "--role", "impl"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines.status).toBe("error");
    expect(result.lines.reason).toBe("invalid_args");
  });
});
