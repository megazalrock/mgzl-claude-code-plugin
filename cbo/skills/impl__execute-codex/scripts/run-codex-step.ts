#!/usr/bin/env bun
// SKILL_DIR/scripts/run-codex-step.ts

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diffChangedFiles, type FileHashes, parsePorcelain } from "./lib/changed-files";
import { buildExecArgs, resolveCodexBin } from "./lib/codex-command";
import { parseCodexEvents } from "./lib/codex-events";

type Role = "impl" | "test";

const printError = (args: { reason: string; detail: string; lastMessageFile?: string }): never => {
  console.log("status=error");
  console.log(`reason=${args.reason}`);
  // 複数行の detail は key=value 形式を崩すので 1 行に潰す
  console.log(`detail=${args.detail.replace(/\s*\n\s*/g, " / ").trim()}`);
  // detail は最終メッセージの 1 行目しか持たないため、中断理由の全文を呼び出し側が
  // 読めるように最終メッセージのパスも渡す
  if (args.lastMessageFile !== undefined) {
    console.log(`last_message_file=${args.lastMessageFile}`);
  }
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

/** 規約ヘッダの `{{VUE_TSC_RUNNER_SCRIPT}}` に埋め込む、CI 相当の型チェックスクリプトの絶対パス */
const vueTscRunnerScript = resolve(
  join(import.meta.dir, "..", "..", "vue-tsc-runner", "scripts", "run-vue-tsc.ts")
);

/** codex 1 ステップの実行時間の上限。Bash ツール側の上限 600 秒より短く取る */
const DEFAULT_TIMEOUT_MS = 570_000;
/** テストから上限を短縮するためだけの環境変数 */
const TIMEOUT_ENV = "IMPL_EXECUTE_CODEX_TIMEOUT_MS";

const resolveTimeoutMs = (env: Record<string, string | undefined>): number => {
  const raw = env[TIMEOUT_ENV];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

const gitStatus = async (cwd: string): Promise<Set<string>> => {
  // -uall で未追跡ディレクトリを配下のファイル単位まで展開させる（既定だと "src/" のように丸められる）。
  // core.quotepath=false で非 ASCII のパスが \346\227... にエスケープされるのを防ぐ
  const args = ["git", "-c", "core.quotepath=false", "status", "--porcelain", "-uall"];
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  // stdout を読み切るまで stderr のパイプが詰まると子プロセスが止まるため、両方を同時に読む
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    return printError({ reason: "git_failed", detail: stderr });
  }
  return parsePorcelain(stdout);
};

const hashFile = async (path: string): Promise<string | undefined> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
};

/** git status に現れたパスだけを対象に内容ハッシュを取る（走査対象は dirty なファイルに限られる） */
const gitStatusHashes = async (cwd: string): Promise<FileHashes> => {
  const paths = await gitStatus(cwd);
  const hashes: FileHashes = new Map();
  for (const path of paths) {
    hashes.set(path, await hashFile(join(cwd, path)));
  }
  return hashes;
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
  // codex は `${CLAUDE_SKILL_DIR}` のような Claude 側の変数を解決できないため、
  // 型チェック用スクリプトの絶対パスをここで埋め込んでから渡す
  const header = readTextFile(headerPath).replaceAll(
    "{{VUE_TSC_RUNNER_SCRIPT}}",
    vueTscRunnerScript
  );
  const body = readTextFile(promptPath);

  const workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "impl-execute-codex-"));
  const fullPromptFile = join(workDir, "prompt.md");
  const lastMessageFile = join(workDir, "last-message.md");
  writeFileSync(fullPromptFile, `${header}\n\n---\n\n${body}`);

  const before = await gitStatusHashes(cwd);

  const proc = Bun.spawn(
    [...resolveCodexBin(process.env), ...buildExecArgs({ cwd, lastMessageFile })],
    {
      cwd,
      stdin: Bun.file(fullPromptFile),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const timeoutMs = resolveTimeoutMs(process.env);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  // stdout を読み切るまで stderr のパイプが詰まると codex が止まるため、両方を同時に読む
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return printError({ reason: "timeout", detail: `codex exceeded ${timeoutMs}ms` });
  }

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

  const after = await gitStatusHashes(cwd);
  const changedFiles = diffChangedFiles({ before, after });
  const lastMessage = readFileSync(lastMessageFile, "utf8");
  const summary = lastMessage.split("\n")[0] ?? "";
  if (changedFiles.length === 0) {
    return printError({ reason: "no_changes", detail: summary, lastMessageFile });
  }

  console.log("status=ok");
  console.log(`changed_files=${changedFiles.join(",")}`);
  console.log(`last_message_file=${lastMessageFile}`);
  console.log(`summary=${summary}`);
};

await main();
