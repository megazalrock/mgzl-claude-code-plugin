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

let proc: ReturnType<typeof Bun.spawn>;
try {
  proc = Bun.spawn([...command, "--version"], { stdout: "pipe", stderr: "pipe" });
} catch (error) {
  // Bun.spawn は実行ファイルが存在しないとき同期的に throw する
  printNg({ reason: "not_found", detail: error instanceof Error ? error.message : String(error) });
}

const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

if (exitCode !== 0) {
  // Bun が throw せず非 0 終了のプロセスを返すケース（例: 実行ファイル自体は存在しない
  // がシェル経由で解決できない）も not_found として扱う
  if (stderr.includes("ENOENT") || stderr.includes("No such file")) {
    printNg({ reason: "not_found", detail: stderr.split("\n")[0] ?? "" });
  }
  printNg({ reason: "exec_failed", detail: stderr.split("\n")[0] ?? "" });
}

console.log("status=ok");
console.log(`version=${stdout.trim()}`);
