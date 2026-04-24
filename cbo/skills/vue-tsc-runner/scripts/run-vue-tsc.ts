#!/usr/bin/env bun

const args = process.argv.slice(2);
const isAllMode = args[0] === "--all";
const targetPath = isAllMode ? args[1] : args[0];

if (isAllMode && !targetPath) {
  process.stderr.write("Usage: run-vue-tsc.ts --all <path>\n");
  process.exit(1);
}

const prepare = Bun.spawn(["pnpm", "exec", "nuxt", "prepare"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});
await prepare.exited;

// 通常モードでパスが指定されている場合、tsconfig.ci.json の対象かチェックしてフォールバックを判定
let useMgzlConfig = isAllMode;
if (!isAllMode && targetPath) {
  const checkProc = Bun.spawn(
    ["pnpm", "exec", "tsc", "--listFilesOnly", "-p", "tsconfig.ci.json"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } }
  );
  const files = await new Response(checkProc.stdout).text();
  await checkProc.exited;
  const isIncluded =
    checkProc.exitCode === 0 && files.split("\n").some((f) => f.includes(targetPath));
  useMgzlConfig = !isIncluded;
}

const tsconfigArgs = useMgzlConfig
  ? ["--skipLibCheck", "--pretty", "false", "-p", "tsconfig.mgzl.json"]
  : ["--pretty", "false", "-p", "tsconfig.ci.json"];

// vue-tsc がメモリ不足で落ちることを防止するため 8GB に設定
const proc = Bun.spawn(["pnpm", "exec", "vue-tsc", "--noEmit", ...tsconfigArgs], {
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
    .filter((line) => {
      if (useMgzlConfig) {
        // mgzl config はコンテキスト行（先頭空白の行）も除外する
        return !/^\s/.test(line) && line.includes(targetPath);
      }
      return line.includes(targetPath);
    })
    .join("\n");
}

process.stdout.write(result);

const exitCode = await proc.exited;
process.exit(exitCode);
