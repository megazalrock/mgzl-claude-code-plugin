#!/usr/bin/env bun
import { $ } from "bun";

// vue-tsc がメモリ不足で落ちることを防止するため 8GB に設定
const proc = Bun.spawn(["vue-tsc", "--noEmit", "--skipLibCheck", "--pretty", "false", "-p", "tsconfig.mgzl.json"], {
  stdout: "pipe",
  stderr: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: "--max_old_space_size=8192",
  },
});

// grep -v '^[[:space:]]' 相当: 先頭が空白の行を除外
const output = await new Response(proc.stdout).text();
const filtered = output
  .split("\n")
  .filter((line) => !/^\s/.test(line) || line.trim() === "")
  .join("\n");

process.stdout.write(filtered);

const exitCode = await proc.exited;
process.exit(exitCode);
