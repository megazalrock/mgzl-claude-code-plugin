#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

const rawArgs = process.argv.slice(2);
const isAllMode = rawArgs.includes("--all");
const isDebug = rawArgs.includes("--debug");
const targetPaths = rawArgs.filter((a) => a !== "--all" && a !== "--debug");

function debugLog(message: string): void {
  if (isDebug) {
    process.stderr.write(`[vue-tsc-runner:debug] ${message}\n`);
  }
}

const CI_CONFIG = "tsconfig.ci.json";
const MGZL_CONFIG = "tsconfig.mgzl.json";
const CACHE_FILE = "node_modules/.cache/cbo/vue-tsc-runner/file-lists.json";

if (isAllMode && targetPaths.length === 0) {
  process.stderr.write("Usage: run-vue-tsc.ts --all <path>... [--debug]\n");
  process.exit(1);
}

debugLog(`raw args: ${JSON.stringify(rawArgs)}`);
debugLog(`mode: ${isAllMode ? "--all" : targetPaths.length === 0 ? "no-paths" : "ci-classify"}`);
debugLog(`target paths (${targetPaths.length}): ${JSON.stringify(targetPaths)}`);

// JSONC を JSON に変換してパースする。コメント・末尾カンマを許容する。
function parseJsonc(text: string, sourcePath: string): unknown {
  let stripped = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      stripped += c;
      if (c === "\\" && i + 1 < text.length) {
        stripped += text[i + 1];
        i += 2;
        continue;
      }
      if (c === stringChar) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      stripped += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    stripped += c;
    i++;
  }
  stripped = stripped.replace(/,(\s*[\]}])/g, "$1");
  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw new Error(`failed to parse JSONC at ${sourcePath}: ${(e as Error).message}`);
  }
}

// TS の extends パッケージ参照解決を簡易再現する。
// "@scope/name[/rest]" または "name[/rest]" を node_modules から探す。
// rest 省略時は tsconfig.json を補完、ディレクトリ指定時も tsconfig.json を補完、
// 拡張子なし指定時は .json を補完する。
function resolvePackageExtends(ext: string, fromDir: string): string {
  const parts = ext.split("/");
  let pkgName: string;
  let restParts: string[];
  if (ext.startsWith("@")) {
    if (parts.length < 2) {
      throw new Error(`invalid scoped package extends: "${ext}"`);
    }
    pkgName = `${parts[0]}/${parts[1]}`;
    restParts = parts.slice(2);
  } else {
    pkgName = parts[0];
    restParts = parts.slice(1);
  }

  let dir = fromDir;
  let pkgRoot: string | null = null;
  while (true) {
    const candidate = resolve(dir, "node_modules", pkgName);
    if (existsSync(candidate)) {
      pkgRoot = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (pkgRoot === null) {
    throw new Error(`extends package not found: "${ext}" from ${fromDir}`);
  }

  if (restParts.length === 0) {
    const target = resolve(pkgRoot, "tsconfig.json");
    if (!existsSync(target)) {
      throw new Error(`extends target not found: "${ext}" -> ${target}`);
    }
    return target;
  }

  const direct = resolve(pkgRoot, restParts.join("/"));
  if (existsSync(direct)) {
    if (direct.endsWith(".json")) return direct;
    const withTsconfig = resolve(direct, "tsconfig.json");
    if (existsSync(withTsconfig)) return withTsconfig;
    return direct;
  }
  const withJson = `${direct}.json`;
  if (existsSync(withJson)) return withJson;
  throw new Error(`extends target not found: "${ext}" tried ${direct} and ${withJson}`);
}

async function computeTsconfigKey(startPath: string): Promise<string> {
  const visited = new Set<string>();
  const rawTexts: string[] = [];

  async function visit(absPath: string): Promise<void> {
    if (visited.has(absPath)) {
      throw new Error(`circular extends detected at ${absPath}`);
    }
    visited.add(absPath);

    if (!existsSync(absPath)) {
      throw new Error(`tsconfig not found: ${absPath}`);
    }
    const raw = await readFile(absPath, "utf-8");
    rawTexts.push(raw);

    const parsed = parseJsonc(raw, absPath) as { extends?: string | string[] };
    const extendsField = parsed.extends;
    if (extendsField === undefined) return;

    const list = Array.isArray(extendsField) ? extendsField : [extendsField];
    for (const ext of list) {
      let resolved: string;
      if (ext.startsWith("./") || ext.startsWith("../")) {
        resolved = resolve(dirname(absPath), ext);
      } else if (isAbsolute(ext)) {
        resolved = ext;
      } else {
        resolved = resolvePackageExtends(ext, dirname(absPath));
      }
      await visit(resolved);
    }
  }

  await visit(resolve(startPath));

  const hash = createHash("sha1");
  for (const text of rawTexts) hash.update(text);
  return `sha1:${hash.digest("hex")}`;
}

type CacheSection = { key: string; files: string[] };
type Cache = { ci?: CacheSection; mgzl?: CacheSection };

async function readCache(): Promise<Cache> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Cache;
    debugLog(
      `cache file read: ci=${parsed.ci ? "present" : "absent"}, mgzl=${parsed.mgzl ? "present" : "absent"}`
    );
    return parsed;
  } catch (e) {
    debugLog(`cache file read failed (treating as empty): ${(e as Error).message}`);
    return {};
  }
}

async function writeCache(cache: Cache): Promise<void> {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache));
    debugLog("cache file written");
  } catch (e) {
    debugLog(`cache file write failed (continuing): ${(e as Error).message}`);
  }
}

async function runListFilesOnly(configPath: string): Promise<string[]> {
  debugLog(`running tsc --listFilesOnly -p ${configPath}`);
  const proc = Bun.spawn(["tsc", "--listFilesOnly", "-p", configPath], {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env },
  });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(
      `[vue-tsc-runner] tsc --listFilesOnly failed (config=${configPath}, exitCode=${code})\n`
    );
    process.exit(code);
  }
  const files = text.split("\n").filter((l) => l.length > 0);
  debugLog(`tsc --listFilesOnly succeeded: ${files.length} files (config=${configPath})`);
  return files;
}

type EnsureResult = { section: CacheSection; hit: boolean };

async function ensureSection(
  configPath: string,
  cached: CacheSection | undefined,
  expectedKey: string
): Promise<EnsureResult> {
  if (cached && cached.key === expectedKey) {
    debugLog(`cache HIT: ${configPath} (key=${expectedKey})`);
    return { section: cached, hit: true };
  }
  debugLog(
    `cache MISS: ${configPath} (cached=${cached?.key ?? "none"}, expected=${expectedKey})`
  );
  const files = await runListFilesOnly(configPath);
  return { section: { key: expectedKey, files }, hit: false };
}

type Classification = {
  ciTargets: string[];
  mgzlTargets: string[];
  unmatched: string[];
};

function classifyTargets(
  paths: string[],
  ciFiles: string[],
  mgzlFiles: string[]
): Classification {
  const ciTargets: string[] = [];
  const mgzlTargets: string[] = [];
  const unmatched: string[] = [];
  for (const p of paths) {
    if (ciFiles.some((f) => f.includes(p))) {
      ciTargets.push(p);
    } else if (mgzlFiles.some((f) => f.includes(p))) {
      mgzlTargets.push(p);
    } else {
      unmatched.push(p);
    }
  }
  return { ciTargets, mgzlTargets, unmatched };
}

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
    configPath: MGZL_CONFIG,
    skipLibCheck: true,
    filterPaths: targetPaths,
    excludeContextLines: true,
  });
} else if (targetPaths.length === 0) {
  exitCode = await runVueTsc({
    configPath: CI_CONFIG,
    skipLibCheck: false,
    filterPaths: [],
    excludeContextLines: false,
  });
} else {
  if (!existsSync(CI_CONFIG)) {
    process.stderr.write(`[vue-tsc-runner] ${CI_CONFIG} not found\n`);
    process.exit(1);
  }
  if (!existsSync(MGZL_CONFIG)) {
    process.stderr.write(`[vue-tsc-runner] ${MGZL_CONFIG} not found\n`);
    process.exit(1);
  }

  let ciKey: string;
  let mgzlKey: string;
  try {
    ciKey = await computeTsconfigKey(CI_CONFIG);
    mgzlKey = await computeTsconfigKey(MGZL_CONFIG);
  } catch (e) {
    process.stderr.write(`[vue-tsc-runner] ${(e as Error).message}\n`);
    process.exit(1);
  }
  debugLog(`computed keys: ci=${ciKey}, mgzl=${mgzlKey}`);

  const cached = await readCache();
  const ciRes = await ensureSection(CI_CONFIG, cached.ci, ciKey);
  const mgzlRes = await ensureSection(MGZL_CONFIG, cached.mgzl, mgzlKey);

  let filledCache: { ci: CacheSection; mgzl: CacheSection } = {
    ci: ciRes.section,
    mgzl: mgzlRes.section,
  };

  if (!ciRes.hit || !mgzlRes.hit) {
    await writeCache(filledCache);
  }

  let classification = classifyTargets(
    targetPaths,
    filledCache.ci.files,
    filledCache.mgzl.files
  );
  debugLog(
    `classified: ci=${classification.ciTargets.length}, mgzl=${classification.mgzlTargets.length}, ` +
      `unmatched=${classification.unmatched.length}`
  );

  if (classification.unmatched.length > 0) {
    debugLog(
      `unmatched detected (${JSON.stringify(classification.unmatched)}); regenerating both caches`
    );
    const ciFiles = await runListFilesOnly(CI_CONFIG);
    const mgzlFiles = await runListFilesOnly(MGZL_CONFIG);
    filledCache = {
      ci: { key: ciKey, files: ciFiles },
      mgzl: { key: mgzlKey, files: mgzlFiles },
    };
    await writeCache(filledCache);
    classification = classifyTargets(targetPaths, ciFiles, mgzlFiles);
    debugLog(
      `re-classified: ci=${classification.ciTargets.length}, mgzl=${classification.mgzlTargets.length}, ` +
        `unmatched=${classification.unmatched.length}`
    );
  }

  // 再取得後も unmatched なら保守的に mgzl 側へフォールバック
  const finalMgzlTargets = [...classification.mgzlTargets, ...classification.unmatched];

  debugLog(
    `CI targets (${classification.ciTargets.length}): ${JSON.stringify(classification.ciTargets)}`
  );
  debugLog(`mgzl targets (${finalMgzlTargets.length}): ${JSON.stringify(finalMgzlTargets)}`);

  if (classification.ciTargets.length > 0) {
    const code = await runVueTsc({
      configPath: CI_CONFIG,
      skipLibCheck: false,
      filterPaths: classification.ciTargets,
      excludeContextLines: false,
    });
    exitCode = Math.max(exitCode, code);
  } else {
    debugLog("skip: no CI targets");
  }

  if (finalMgzlTargets.length > 0) {
    const code = await runVueTsc({
      configPath: MGZL_CONFIG,
      skipLibCheck: true,
      filterPaths: finalMgzlTargets,
      excludeContextLines: true,
    });
    exitCode = Math.max(exitCode, code);
  } else {
    debugLog("skip: no mgzl targets");
  }
}

debugLog(`final exitCode: ${exitCode}`);
process.exit(exitCode);
