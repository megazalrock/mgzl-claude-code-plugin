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

export function renderIndex(memories: LoadedMemory[]): string {
  const lines = sortForIndex(memories).map(
    (m) => `- [${m.meta.title}](memories/${m.slug}.md)`,
  );
  return ["# fading-memory 目次", "", ...lines, ""].join("\n");
}
