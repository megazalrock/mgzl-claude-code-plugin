import { expiresAt } from "./expiry.ts";
import type { LoadedMemory } from "./maintenance.ts";

/** 目次の並び順: 有効期限の降順（= 重要度順）。permanent は Infinity なので自然に先頭に来る */
export function sortForIndex(memories: LoadedMemory[]): LoadedMemory[] {
  return [...memories].sort((a, b) => {
    const ea = expiresAt(a.meta);
    const eb = expiresAt(b.meta);
    if (ea === eb) return a.slug.localeCompare(b.slug);
    return eb - ea;
  });
}

/** index.md に載せる記憶。有効期限内のものだけで、退色した記憶はファイルとして残ったまま目次から外れる */
export function visibleMemories(memories: LoadedMemory[], now: number): LoadedMemory[] {
  return memories.filter((m) => expiresAt(m.meta) > now);
}

/**
 * 目次に載せるのは有効期限内の記憶だけ。退色した記憶はファイルとして残り、
 * 更新または加点で起点が前進すれば再び載る。絞り込みはここだけで行い、loadMemories は全件を返す
 */
export function renderIndex(memories: LoadedMemory[], now: number): string {
  const visible = visibleMemories(memories, now);
  const lines = sortForIndex(visible).map(
    (m) => `- [${m.meta.title}](memories/${m.slug}.md)`,
  );
  return ["# fading-memory 目次", "", ...lines, ""].join("\n");
}
