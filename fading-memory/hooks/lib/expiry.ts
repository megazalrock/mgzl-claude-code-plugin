import { config, type FadingMemoryConfig } from "./config.ts";
import type { MemoryMeta } from "./frontmatter.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 記憶データの有効期限（epoch ミリ秒）。
 * スコア線形延長（上限付き）と「直近参照 + 基本TTL」下限の max を取る B' 式。
 * 期限はファイルに保存せず、常にここで計算する（二重管理の防止）。
 */
export function expiresAt(meta: MemoryMeta, cfg: FadingMemoryConfig = config): number {
  if (meta.permanent) return Infinity;
  const created = Date.parse(meta.created);
  const lastRef = meta.lastReferenced === null ? created : Date.parse(meta.lastReferenced);
  const extensionDays = Math.min(
    cfg.baseTtlDays + meta.score * cfg.perScoreDays,
    cfg.maxExtensionDays,
  );
  return Math.max(created + extensionDays * DAY_MS, lastRef + cfg.baseTtlDays * DAY_MS);
}
