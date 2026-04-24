#!/usr/bin/env bun

const targetPath = process.argv[2];

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


let result = await new Response(proc.stdout).text();
if (targetPath) {
  result = result
    .split("\n")
    .filter((line) => line.includes(targetPath))
    .join("\n");
}


process.stdout.write(result);

const exitCode = await proc.exited;
process.exit(exitCode);
