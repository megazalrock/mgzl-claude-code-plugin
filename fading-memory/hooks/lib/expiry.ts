import { config, type FadingMemoryConfig } from "./config.ts";
import type { MemoryMeta } from "./frontmatter.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 記憶データの有効期限（epoch ミリ秒）。index.md に載せる順位の基準でもある。
 * 起点は直近参照（無ければ作成）の 1 つだけで、そこから出自別の基本TTL + score 線形延長ぶん先を返す。
 * 期限はファイルに保存せず、常にここで計算する（二重管理の防止）。
 */
export function expiresAt(meta: MemoryMeta, cfg: FadingMemoryConfig = config): number {
  if (meta.permanent) return Infinity;
  const anchor = Date.parse(meta.lastReferenced ?? meta.created);
  const ttlDays = cfg.baseTtlDays[meta.origin] + meta.score * cfg.perScoreDays;
  return anchor + ttlDays * DAY_MS;
}

/**
 * 有効期限までの残り日数。日をまたぐ端数は切り上げる。
 * permanent は Infinity、期限切れの記憶では負値になる。
 */
export function remainingDays(
  meta: MemoryMeta,
  now: number,
  cfg: FadingMemoryConfig = config,
): number {
  if (meta.permanent) return Infinity;
  return Math.ceil((expiresAt(meta, cfg) - now) / DAY_MS);
}
