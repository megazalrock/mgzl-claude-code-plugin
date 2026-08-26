import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { expiresAt } from "./expiry.ts";
import { parseMemory, type MemoryMeta } from "./frontmatter.ts";
import type { DataPaths } from "./paths.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** データディレクトリから読み込まれた記憶データ1件 */
export interface LoadedMemory {
  slug: string;
  file: string;
  meta: MemoryMeta;
  body: string;
}

export function ensureDirs(paths: DataPaths): void {
  mkdirSync(paths.memoriesDir, { recursive: true });
  mkdirSync(paths.trashDir, { recursive: true });
}

/** 解析できないファイルは削除せず malformed として報告だけする（誤削除の防止） */
export function loadMemories(paths: DataPaths): {
  memories: LoadedMemory[];
  malformed: string[];
} {
  const memories: LoadedMemory[] = [];
  const malformed: string[] = [];
  for (const name of readdirSync(paths.memoriesDir).sort()) {
    if (!name.endsWith(".md")) continue;
    const file = join(paths.memoriesDir, name);
    const doc = parseMemory(readFileSync(file, "utf8"));
    if (doc === null) {
      malformed.push(name);
      continue;
    }
    memories.push({ slug: name.slice(0, -3), file, meta: doc.meta, body: doc.body });
  }
  return { memories, malformed };
}

/** trash 内のファイル名に移動時刻を埋め込み、保持期間の判定に使う */
export function moveToTrash(paths: DataPaths, slug: string, now: number): void {
  renameSync(join(paths.memoriesDir, `${slug}.md`), join(paths.trashDir, `${now}__${slug}.md`));
}

export function expireMemories(paths: DataPaths, now: number): string[] {
  const expired: string[] = [];
  for (const mem of loadMemories(paths).memories) {
    if (expiresAt(mem.meta) <= now) {
      moveToTrash(paths, mem.slug, now);
      expired.push(mem.slug);
    }
  }
  return expired;
}

/** 時刻プレフィックスの無いファイル（手動で置かれたもの）は削除対象にしない */
export function purgeTrash(paths: DataPaths, now: number): string[] {
  const purged: string[] = [];
  const limitMs = config.trashRetentionDays * DAY_MS;
  for (const name of readdirSync(paths.trashDir)) {
    const m = name.match(/^(\d+)__/);
    if (m === null || m[1] === undefined) continue;
    if (now - Number(m[1]) > limitMs) {
      unlinkSync(join(paths.trashDir, name));
      purged.push(name);
    }
  }
  return purged;
}
