import { config, type FadingMemoryConfig } from "./config.ts";

/** slug の書式。記憶ファイル名と frontmatter の related にそのまま使われる */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function wordCount(slug: string): number {
  return slug.split("-").length;
}

/**
 * slug がリネーム対象になるほど長いか。maintain が短縮対象を選ぶのに使う（#65）。
 * 新規生成の目標値（config.slug.maxLength）ではなく、それより緩い config.slug.rename.maxLength だけを見る（長さのみ、語数は見ない）。
 * 理由は config.slug.rename のコメントを参照。
 */
export function isSlugTooLong(slug: string, cfg: FadingMemoryConfig = config): boolean {
  return slug.length > cfg.slug.rename.maxLength;
}

/**
 * 書式と語数・長さの上下限をすべて満たすか。maintain で付け直す新しい slug の検証に使う。
 * isSlugTooLong とは別の、生成目標（config.slug.maxWords / maxLength）そのものを直接チェックする
 */
export function isAcceptableSlug(slug: string, cfg: FadingMemoryConfig = config): boolean {
  return (
    SLUG_RE.test(slug) &&
    wordCount(slug) >= cfg.slug.minWords &&
    wordCount(slug) <= cfg.slug.maxWords &&
    slug.length <= cfg.slug.maxLength
  );
}
