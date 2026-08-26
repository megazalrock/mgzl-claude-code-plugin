import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemory, serializeMemory } from "./frontmatter.ts";
import { loadMemories } from "./maintenance.ts";
import type { DataPaths } from "./paths.ts";

/** headless 抽出セッションが返すべき JSON の形 */
export interface ExtractionResult {
  newMemories: { slug: string; title: string; body: string; related?: string[] }[];
  updatedMemories: { slug: string; body: string; related?: string[] }[];
  usefulMemorySlugs: string[];
}

export interface ApplyReport {
  created: string[];
  updated: string[];
  scored: string[];
  skipped: string[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function stripCodeFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  const inner = m?.[1];
  return inner === undefined ? text.trim() : inner;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function parseExtractionResult(text: string): ExtractionResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  // as は unknown をキー参照可能にするためだけの絞り込みで、値は個別に検証する

  const news = obj["newMemories"];
  const updates = obj["updatedMemories"];
  const useful = obj["usefulMemorySlugs"];
  if (!Array.isArray(news) || !Array.isArray(updates) || !isStringArray(useful)) return null;

  const newMemories: ExtractionResult["newMemories"] = [];
  for (const n of news) {
    if (typeof n !== "object" || n === null) return null;
    const r = n as Record<string, unknown>;
    // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
    if (
      typeof r["slug"] !== "string" ||
      !SLUG_RE.test(r["slug"]) ||
      typeof r["title"] !== "string" ||
      typeof r["body"] !== "string" ||
      (r["related"] !== undefined && !isStringArray(r["related"]))
    ) {
      return null;
    }
    newMemories.push({
      slug: r["slug"],
      title: r["title"],
      body: r["body"],
      related: isStringArray(r["related"]) ? r["related"] : undefined,
    });
  }

  const updatedMemories: ExtractionResult["updatedMemories"] = [];
  for (const u of updates) {
    if (typeof u !== "object" || u === null) return null;
    const r = u as Record<string, unknown>;
    // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
    if (
      typeof r["slug"] !== "string" ||
      !SLUG_RE.test(r["slug"]) ||
      typeof r["body"] !== "string" ||
      (r["related"] !== undefined && !isStringArray(r["related"]))
    ) {
      return null;
    }
    updatedMemories.push({
      slug: r["slug"],
      body: r["body"],
      related: isStringArray(r["related"]) ? r["related"] : undefined,
    });
  }

  return { newMemories, updatedMemories, usefulMemorySlugs: useful };
}

function uniqueSlug(existing: Set<string>, slug: string): string {
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

export function applyExtraction(
  paths: DataPaths,
  result: ExtractionResult,
  nowIso: string,
): ApplyReport {
  const report: ApplyReport = { created: [], updated: [], scored: [], skipped: [] };
  const existing = new Set(loadMemories(paths).memories.map((m) => m.slug));

  for (const n of result.newMemories) {
    const slug = uniqueSlug(existing, n.slug);
    existing.add(slug);
    writeFileSync(
      join(paths.memoriesDir, `${slug}.md`),
      serializeMemory({
        meta: {
          title: n.title,
          created: nowIso,
          updated: nowIso,
          lastReferenced: null,
          score: 0,
          permanent: false,
          related: n.related ?? [],
        },
        body: n.body,
      }),
    );
    report.created.push(slug);
  }

  for (const u of result.updatedMemories) {
    const file = join(paths.memoriesDir, `${u.slug}.md`);
    const doc = existing.has(u.slug) ? parseMemory(readFileSync(file, "utf8")) : null;
    if (doc === null) {
      report.skipped.push(u.slug);
      continue;
    }
    // 更新だけでは score / lastReferenced を変動させない（仕様）
    doc.body = u.body;
    doc.meta.updated = nowIso;
    if (u.related !== undefined) doc.meta.related = u.related;
    writeFileSync(file, serializeMemory(doc));
    report.updated.push(u.slug);
  }

  for (const slug of result.usefulMemorySlugs) {
    const file = join(paths.memoriesDir, `${slug}.md`);
    const doc = existing.has(slug) ? parseMemory(readFileSync(file, "utf8")) : null;
    if (doc === null) {
      report.skipped.push(slug);
      continue;
    }
    doc.meta.score += 1;
    doc.meta.lastReferenced = nowIso;
    writeFileSync(file, serializeMemory(doc));
    report.scored.push(slug);
  }

  return report;
}

export function buildExtractionPrompt(transcriptPath: string, catalog: string): string {
  return [
    `${transcriptPath} は直前に終了した Claude Code セッションのトランスクリプト（JSONL）である。Read で読み、記憶として保存すべき内容を JSON で出力せよ。`,
    "",
    "## 既存の記憶データ一覧（slug: title）",
    catalog === "" ? "（なし）" : catalog,
    "",
    "## 抽出ルール",
    "- セッションを跨いで再利用可能なナレッジのみを抽出する。一時的な作業情報（今回限りのエラーや途中経過）は含めない",
    "- 既存の記憶と同じ関心の内容は newMemories にせず、updatedMemories として既存 slug の内容を書き直す",
    "- slug は内容を要約した英語の kebab-case にする",
    "- title は「どのケースで役立つ何の情報か」を1行で書く",
    "- permanent の指定は行わない",
    "- usefulMemorySlugs には、このセッション中に実際に内容が読まれ、かつ作業の役に立った既存記憶の slug だけを入れる。読まれただけで役立っていないものは入れない",
    "- 該当が無い配列は空配列にする",
    "",
    "## 出力形式",
    "説明文やコードフェンスを付けず、次の形の JSON のみを出力する:",
    '{"newMemories":[{"slug":"...","title":"...","body":"...","related":[]}],"updatedMemories":[{"slug":"...","body":"...","related":[]}],"usefulMemorySlugs":["..."]}',
  ].join("\n");
}
