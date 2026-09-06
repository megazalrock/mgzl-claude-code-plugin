#!/usr/bin/env bun
// SKILL_DIR/scripts/check-codex.ts

import { resolveCodexBin } from "./lib/codex-command";

const printNg = (args: { reason: string; detail: string }): never => {
  console.log("status=ng");
  console.log(`reason=${args.reason}`);
  console.log(`detail=${args.detail}`);
  process.exit(1);
};

const command = resolveCodexBin(process.env);

const run = async (): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const proc = Bun.spawn([...command, "--version"], { stdout: "pipe", stderr: "pipe" });
  // stdout を読み切るまで stderr のパイプが詰まると子プロセスが止まるため、両方を同時に読む
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
};

let result: { stdout: string; stderr: string; exitCode: number };
try {
  result = await run();
} catch (error) {
  // Bun.spawn は実行ファイルが存在しないとき throw する
  result = printNg({
    reason: "not_found",
    detail: error instanceof Error ? error.message : String(error),
  });
}

const { stdout, stderr, exitCode } = result;

if (exitCode !== 0) {
  printNg({ reason: "exec_failed", detail: stderr.split("\n")[0] ?? "" });
}

console.log("status=ok");
console.log(`version=${stdout.trim()}`);
