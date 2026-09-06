#!/usr/bin/env bun
// SKILL_DIR/scripts/run-codex-step.ts

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffChangedFiles, parsePorcelain } from "./lib/changed-files";
import { buildExecArgs, resolveCodexBin } from "./lib/codex-command";
import { parseCodexEvents } from "./lib/codex-events";

type Role = "impl" | "test";

const printError = (args: { reason: string; detail: string }): never => {
  console.log("status=error");
  console.log(`reason=${args.reason}`);
  // 複数行の detail は key=value 形式を崩すので 1 行に潰す
  console.log(`detail=${args.detail.replace(/\s*\n\s*/g, " / ").trim()}`);
  process.exit(1);
};

const readOption = (name: string): string | undefined => {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const isRole = (value: string | undefined): value is Role => value === "impl" || value === "test";

const readTextFile = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    // ファイル欠落や権限エラーはユーザー入力の不備として invalid_args で報告し、
    // status= 行を必ず出力する契約を守る
    return printError({
      reason: "invalid_args",
      detail: `failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

const gitStatus = async (cwd: string): Promise<Set<string>> => {
  // -uall で未追跡ディレクトリを配下のファイル単位まで展開させる（既定だと "src/" のように丸められる）
  const proc = Bun.spawn(["git", "status", "--porcelain", "-uall"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    return printError({ reason: "git_failed", detail: stderr });
  }
  return parsePorcelain(stdout);
};

const main = async (): Promise<void> => {
  const rawPromptPath = readOption("--prompt");
  const rawCwd = readOption("--cwd");
  const rawRole = readOption("--role");

  if (rawPromptPath === undefined || rawCwd === undefined || !isRole(rawRole)) {
    return printError({
      reason: "invalid_args",
      detail: "usage: run-codex-step.ts --prompt <file> --cwd <dir> --role <impl|test>",
    });
  }

  // `printError` の呼び出しに `return` を付けているのは、tsc の制御フロー解析が
  // 「関数呼び出しの戻り値を代入した変数」の narrow を never 型の呼び出しだけでは
  // 追跡できないための回避。ここでは型が string / Role に絞り込まれている
  const promptPath = rawPromptPath;
  const cwd = rawCwd;
  const role = rawRole;

  const headerPath = join(import.meta.dir, "..", "references", `codex-header-${role}.md`);
  const header = readTextFile(headerPath);
  const body = readTextFile(promptPath);

  const workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "impl-execute-codex-"));
  const fullPromptFile = join(workDir, "prompt.md");
  const lastMessageFile = join(workDir, "last-message.md");
  writeFileSync(fullPromptFile, `${header}\n\n---\n\n${body}`);

  const before = await gitStatus(cwd);

  const proc = Bun.spawn(
    [...resolveCodexBin(process.env), ...buildExecArgs({ cwd, lastMessageFile })],
    {
      cwd,
      stdin: Bun.file(fullPromptFile),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const events = parseCodexEvents(stdout);
  if (events.errors.length > 0 || events.turnFailed) {
    return printError({ reason: "error_event", detail: events.errors.join(" / ") });
  }
  if (exitCode !== 0) {
    return printError({ reason: "nonzero_exit", detail: `exit=${exitCode} ${stderr}` });
  }
  if (!existsSync(lastMessageFile)) {
    return printError({ reason: "no_last_message", detail: lastMessageFile });
  }

  const after = await gitStatus(cwd);
  const changedFiles = diffChangedFiles({ before, after });
  const lastMessage = readFileSync(lastMessageFile, "utf8");
  const summary = lastMessage.split("\n")[0] ?? "";
  if (changedFiles.length === 0) {
    return printError({ reason: "no_changes", detail: summary });
  }

  console.log("status=ok");
  console.log(`changed_files=${changedFiles.join(",")}`);
  console.log(`last_message_file=${lastMessageFile}`);
  console.log(`summary=${summary}`);
};

await main();
