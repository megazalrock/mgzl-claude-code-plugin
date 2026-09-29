import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSlug } from "./extraction.ts";
import { serializeMemory } from "./frontmatter.ts";
import { loadMemories } from "./maintenance.ts";
import type { DataPaths } from "./paths.ts";
import { isAcceptableSlug } from "./slug.ts";

export type RenameResult =
  | { ok: true; oldSlug: string; newSlug: string; relatedUpdated: string[] }
  | { ok: false; error: "not-found" | "invalid-slug" | "exists"; slug: string };

/**
 * 記憶の slug を付け直す（maintain の slug 短縮用、#65）。
 * 記憶ファイルを移し、退色した記憶も含む全記憶の related に残る旧 slug を新 slug へ書き換える。
 *
 * frontmatter の score / lastReferenced / updated / created は一切変えない。
 * 有効期限の起点は lastReferenced（無ければ created）なので、改名で起点が動くと記憶の寿命が延びてしまう。
 * updated も内容の更新日時という意味なので、識別子の付け替えだけでは進めない。
 * title も対象外。dedup.ts の重複判定が保存済み title を比較しており、閾値がその分布で調整されている。
 *
 * 既知の制約: 改名と同時に終了したセッションの抽出が旧 slug を返すと、
 * applyExtraction は存在しない slug として加点・更新をスキップする（その 1 回分は失われる）。
 */
export function renameMemory(paths: DataPaths, oldSlug: string, newSlugInput: string): RenameResult {
  const { memories } = loadMemories(paths);
  const target = memories.find((m) => m.slug === oldSlug);
  if (target === undefined) return { ok: false, error: "not-found", slug: oldSlug };

  const newSlug = normalizeSlug(newSlugInput);
  if (!isAcceptableSlug(newSlug)) return { ok: false, error: "invalid-slug", slug: newSlug };

  // loadMemories が読めなかった malformed なファイルも上書きしないよう、存在はファイル名で見る
  const newFile = join(paths.memoriesDir, `${newSlug}.md`);
  if (existsSync(newFile)) return { ok: false, error: "exists", slug: newSlug };

  renameSync(target.file, newFile);

  const relatedUpdated: string[] = [];
  for (const m of memories) {
    if (!m.meta.related.includes(oldSlug)) continue;
    const related = [...new Set(m.meta.related.map((s) => (s === oldSlug ? newSlug : s)))];
    const isTarget = m.slug === oldSlug;
    writeFileSync(isTarget ? newFile : m.file, serializeMemory({ meta: { ...m.meta, related }, body: m.body }));
    relatedUpdated.push(isTarget ? newSlug : m.slug);
  }

  return { ok: true, oldSlug, newSlug, relatedUpdated };
}
