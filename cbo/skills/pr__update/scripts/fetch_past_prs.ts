#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.env.CLAUDE_PLUGIN_DATA ?? "/tmp", "pr_update");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_LIMIT = 10;

interface PR {
  number: number;
  title: string;
  body: string;
}

interface CacheData {
  fetchedAt: string;
  prs: PR[];
}

function isCacheFresh(cacheFile: string): boolean {
  if (!existsSync(cacheFile)) return false;
  return Date.now() - statSync(cacheFile).mtimeMs < CACHE_TTL_MS;
}

// リポジトリ識別子を取得（REST APIなので GraphQL レートリミット対象外）
let repoId: string;
try {
  repoId = execSync(
    "gh repo view --json nameWithOwner --jq .nameWithOwner",
    { encoding: "utf-8" },
  )
    .trim()
    .replace("/", "_");
} catch {
  process.stderr.write("Error: リポジトリ情報の取得に失敗しました。GitHubリポジトリ内で実行してください。\n");
  process.exit(1);
}

const CACHE_FILE = join(CACHE_DIR, `past_prs_${repoId}.json`);
const forceRefresh = process.argv.includes("--refresh");

let prs: PR[];
if (!forceRefresh && isCacheFresh(CACHE_FILE)) {
  const cache: CacheData = await Bun.file(CACHE_FILE).json();
  prs = cache.prs;
} else {
  try {
    const raw = execSync(
      `gh pr list --author @me --state merged --limit ${FETCH_LIMIT} --json number,title,body`,
      { encoding: "utf-8" },
    );
    prs = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error: 過去PRの取得に失敗しました（レートリミット超過の可能性）: ${msg}\n`);
    process.exit(1);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const data: CacheData = { fetchedAt: new Date().toISOString(), prs };
  await Bun.write(CACHE_FILE, JSON.stringify(data, null, 2));
}

console.log(JSON.stringify(prs));
