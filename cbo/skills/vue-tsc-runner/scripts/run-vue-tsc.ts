#!/usr/bin/env bun

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
      `env=NODE_OPTIONS=--max_old_space_size=8192`
  );

  // vue-tsc をホスト上で直接実行する。メモリ不足で落ちることを防止するため、
  // spawn の env で NODE_OPTIONS を付与して heap 上限を 8GB に引き上げる。
  const proc = Bun.spawn(["vue-tsc", "--noEmit", ...tscArgs], {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, NODE_OPTIONS: "--max_old_space_size=8192" },
  });

  let output = await new Response(proc.stdout).text();
  let filtered = false;
  if (options.filterPaths.length > 0) {
    output = output
      .split("\n")
      .filter((line) => {
        if (options.excludeContextLines && /^\s/.test(line)) return false;
        return options.filterPaths.some((p) => line.includes(p));
      })
      .join("\n");
    filtered = true;
  }

  process.stdout.write(output);
  const code = await proc.exited;
  debugLog(`vue-tsc finished: config=${options.configPath}, exitCode=${code}`);

  // フィルタリング適用後に対象ファイルのエラーが0件なら成功とみなす
  if (filtered && code !== 0 && output.trim().length === 0) {
    debugLog(`no errors in filtered output; treating as success (original exitCode=${code})`);
    return 0;
  }
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
    ["tsc", "--listFilesOnly", "-p", "tsconfig.ci.json"],
    { stdout: "pipe", stderr: "inherit", env: { ...process.env } }
  );
  const files = await new Response(checkProc.stdout).text();
  const checkExit = await checkProc.exited;
  if (checkExit !== 0) {
    process.stderr.write(`[vue-tsc-runner] tsc --listFilesOnly failed (exitCode=${checkExit})\n`);
    process.exit(checkExit);
  }
  const ciFiles = files.split("\n");
  debugLog(`tsc --listFilesOnly succeeded: ${ciFiles.length} entries indexed`);

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
