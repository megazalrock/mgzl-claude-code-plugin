import { expiresAt } from "./expiry.ts";
import type { LoadedMemory } from "./maintenance.ts";

/** 一覧の並び順: score の降順（= 実際に役立った回数順）。同点は有効期限の降順、それも同じなら slug 昇順 */
export function sortByScore(memories: LoadedMemory[]): LoadedMemory[] {
  return [...memories].sort((a, b) => {
    if (a.meta.score !== b.meta.score) return b.meta.score - a.meta.score;
    const ea = expiresAt(a.meta);
    const eb = expiresAt(b.meta);
    if (ea === eb) return a.slug.localeCompare(b.slug);
    return eb - ea;
  });
}
