#!/usr/bin/env bun

const targetPath = process.argv[2];
if (!targetPath) {
  process.stderr.write("Usage: run-vue-tsc-special-config.ts <path>\n");
  process.exit(1);
}

// vue-tsc がメモリ不足で落ちることを防止するため 8GB に設定
const proc = Bun.spawn(["vue-tsc", "--noEmit", "--skipLibCheck", "--pretty", "false", "-p", "tsconfig.mgzl.json"], {
  stdout: "pipe",
  stderr: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: "--max_old_space_size=8192",
  },
});

// 先頭が空白の行（コンテキスト行）を除外し、対象パスを含む行のみ残す
const output = await new Response(proc.stdout).text();
const filtered = output
  .split("\n")
  .filter((line) => !/^\s/.test(line) && line.includes(targetPath))
  .join("\n");

process.stdout.write(filtered);

const exitCode = await proc.exited;
process.exit(exitCode);
