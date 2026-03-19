#!/usr/bin/env bun
import { $ } from "bun";

// nuxt prepare を実行
const prepare = Bun.spawn(["pnpm", "exec", "nuxt", "prepare"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});
await prepare.exited;

// vue-tsc がメモリ不足で落ちることを防止するため 8GB に設定
const proc = Bun.spawn(["pnpm", "exec", "vue-tsc", "--noEmit", "-p", "tsconfig.ci.json"], {
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: "--max_old_space_size=8192",
  },
});

const exitCode = await proc.exited;
process.exit(exitCode);
