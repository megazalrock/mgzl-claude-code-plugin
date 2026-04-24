#!/usr/bin/env bun

const targetPath = process.argv[2];
if (!targetPath) {
  process.stderr.write("Usage: run-vue-tsc-ci.ts <path>\n");
  process.exit(1);
}

const prepare = Bun.spawn(["pnpm", "exec", "nuxt", "prepare"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});
await prepare.exited;

// vue-tsc がメモリ不足で落ちることを防止するため 8GB に設定
const proc = Bun.spawn(["pnpm", "exec", "vue-tsc", "--noEmit", "--pretty", "false", "-p", "tsconfig.ci.json"], {
  stdout: "pipe",
  stderr: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: "--max_old_space_size=8192",
  },
});


const output = await new Response(proc.stdout).text();
const filtered = output
  .split("\n")
  .filter((line) => line.includes(targetPath))
  .join("\n");

process.stdout.write(filtered);

const exitCode = await proc.exited;
process.exit(exitCode);
