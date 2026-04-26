#!/usr/bin/env bun

const DOCKER_EXEC = ["docker", "compose", "exec", "-T"] as const;
const DOCKER_SERVICE = "front";
const DOCKER = [...DOCKER_EXEC, DOCKER_SERVICE] as const;

const rawArgs = process.argv.slice(2);
const isAllMode = rawArgs.includes("--all");
const isDebug = rawArgs.includes("--debug");
const targetPaths = rawArgs.filter((a) => a !== "--all" && a !== "--debug");

function debugLog(message: string): void {
  if (isDebug) {
    process.stderr.write(`[vue-tsc-runner:debug] ${message}\n`);
  }
}

if (isAllMode && targetPaths.length === 0) {
  process.stderr.write("Usage: run-vue-tsc.ts --all <path>... [--debug]\n");
  process.exit(1);
}

debugLog(`raw args: ${JSON.stringify(rawArgs)}`);
debugLog(`mode: ${isAllMode ? "--all" : targetPaths.length === 0 ? "no-paths" : "ci-classify"}`);
debugLog(`target paths (${targetPaths.length}): ${JSON.stringify(targetPaths)}`);

debugLog("running 'nuxt prepare'...");
const prepare = Bun.spawn([...DOCKER, "pnpm", "exec", "nuxt", "prepare"], {
  stdout: "pipe",
  stderr: "inherit",
  env: { ...process.env },
});

// consola の success ログ装飾（◆ マーカー / │ 縦線枠）を含む行を除去
const NUXT_DECORATION_RE = /[◆│]/;
const reader = prepare.stdout.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!NUXT_DECORATION_RE.test(line)) {
      process.stdout.write(line + "\n");
    }
  }
}
if (buffer.length > 0 && !NUXT_DECORATION_RE.test(buffer)) {
  process.stdout.write(buffer);
}
await prepare.exited;
debugLog("'nuxt prepare' finished");

type RunOptions = {
  configPath: string;
  skipLibCheck: boolean;
  filterPaths: string[];
  excludeContextLines: boolean;
};

async function runVueTsc(options: RunOptions): Promise<number> {
  const tscArgs = [
    ...(options.skipLibCheck ? ["--skipLibCheck"] : []),
    "--pretty",
    "false",
    "-p",
    options.configPath,
  ];

  debugLog(
    `running vue-tsc: config=${options.configPath}, skipLibCheck=${options.skipLibCheck}, ` +
      `filterPaths=${JSON.stringify(options.filterPaths)}, excludeContextLines=${options.excludeContextLines}, ` +
      `containerEnv=NODE_OPTIONS=--max_old_space_size=8192`
  );

  // コンテナ内の vue-tsc がメモリ不足で落ちることを防止するため、
  // docker compose exec の `-e` でコンテナへ NODE_OPTIONS を直接渡す（heap 上限 8GB）。
  // ホスト側 process.env.NODE_OPTIONS は docker compose exec を介すと
  // コンテナ内プロセスへ伝搬しないため、`-e` での明示が必須。
  const proc = Bun.spawn(
    [
      ...DOCKER_EXEC,
      "-e",
      "NODE_OPTIONS=--max_old_space_size=8192",
      DOCKER_SERVICE,
      "pnpm",
      "exec",
      "vue-tsc",
      "--noEmit",
      ...tscArgs,
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    }
  );

  let output = await new Response(proc.stdout).text();
  if (options.filterPaths.length > 0) {
    output = output
      .split("\n")
      .filter((line) => {
        if (options.excludeContextLines && /^\s/.test(line)) return false;
        return options.filterPaths.some((p) => line.includes(p));
      })
      .join("\n");
  }

  process.stdout.write(output);
  const code = await proc.exited;
  debugLog(`vue-tsc finished: config=${options.configPath}, exitCode=${code}`);
  return code;
}

let exitCode = 0;

if (isAllMode) {
  exitCode = await runVueTsc({
    configPath: "tsconfig.mgzl.json",
    skipLibCheck: true,
    filterPaths: targetPaths,
    excludeContextLines: true,
  });
} else if (targetPaths.length === 0) {
  exitCode = await runVueTsc({
    configPath: "tsconfig.ci.json",
    skipLibCheck: false,
    filterPaths: [],
    excludeContextLines: false,
  });
} else {
  debugLog("classifying paths against tsconfig.ci.json (--listFilesOnly)...");
  const checkProc = Bun.spawn(
    [...DOCKER, "pnpm", "exec", "tsc", "--listFilesOnly", "-p", "tsconfig.ci.json"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } }
  );
  const files = await new Response(checkProc.stdout).text();
  const checkExit = await checkProc.exited;
  const ciFiles = checkExit === 0 ? files.split("\n") : [];
  debugLog(
    checkExit === 0
      ? `tsc --listFilesOnly succeeded: ${ciFiles.length} entries indexed`
      : `tsc --listFilesOnly failed (exitCode=${checkExit}); treating all paths as CI-out`
  );

  const ciTargets: string[] = [];
  const mgzlTargets: string[] = [];
  for (const p of targetPaths) {
    if (ciFiles.some((f) => f.includes(p))) {
      ciTargets.push(p);
    } else {
      mgzlTargets.push(p);
    }
  }
  debugLog(`CI targets (${ciTargets.length}): ${JSON.stringify(ciTargets)}`);
  debugLog(`mgzl targets (${mgzlTargets.length}): ${JSON.stringify(mgzlTargets)}`);

  if (ciTargets.length > 0) {
    const code = await runVueTsc({
      configPath: "tsconfig.ci.json",
      skipLibCheck: false,
      filterPaths: ciTargets,
      excludeContextLines: false,
    });
    exitCode = Math.max(exitCode, code);
  } else {
    debugLog("skip: no CI targets");
  }

  if (mgzlTargets.length > 0) {
    const code = await runVueTsc({
      configPath: "tsconfig.mgzl.json",
      skipLibCheck: true,
      filterPaths: mgzlTargets,
      excludeContextLines: true,
    });
    exitCode = Math.max(exitCode, code);
  } else {
    debugLog("skip: no mgzl targets");
  }
}

debugLog(`final exitCode: ${exitCode}`);
process.exit(exitCode);
