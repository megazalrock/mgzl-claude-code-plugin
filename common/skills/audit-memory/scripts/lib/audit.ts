import { type ParsedMemory, VALID_TYPES } from "./memory-file.ts";

/** 構造検査で見つかった問題 1 件。kind は設計書の種別名 */
export interface Issue {
  kind: string;
  file: string;
  detail: string;
}

/**
 * MEMORY.md の索引行 `[...](file.md)` からリンク先のファイル名を列挙する。
 * 記憶ファイルは memory/ 直下にフラットに置かれるので、パス区切りを含むリンクは記憶を指していない。
 * ベース名に切り詰めると `sub/x.md` と `x.md` が同一視され、`https://example.com/foo.md` のような外部 URL まで索引リンクとして拾ってしまうため除外する
 */
export function parseIndexLinks(indexContent: string): string[] {
  return [...indexContent.matchAll(/\]\(([^)]+\.md)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((target) => !target.includes("/"));
}

/** metadata 配下で正常とみなすキー。type 以外の 3 つは Claude Code 本体が記憶の書き込み時に自動付与するもの（2026-08-28 の試走で確認） */
const KNOWN_METADATA_KEYS = new Set(["type", "node_type", "originSessionId", "modified"]);

/** name / ファイル名 / リンク先を比較するための正規化。ケバブとスネークを同一視する */
function normalize(s: string): string {
  return s.replace(/[-_]/g, "-");
}

function stemOf(file: string): string {
  return file.replace(/\.md$/, "");
}

function isValidType(type: string): boolean {
  // VALID_TYPES は readonly タプルなので includes の引数型が狭い。string で照合するため some を使う
  return VALID_TYPES.some((t) => t === type);
}

export function auditMemories(memories: ParsedMemory[], indexLinks: string[]): Issue[] {
  const issues: Issue[] = [];
  const knownNames = new Set<string>();
  for (const m of memories) {
    knownNames.add(normalize(stemOf(m.file)));
    if (m.name !== null) knownNames.add(normalize(m.name));
  }
  const indexed = new Set(indexLinks);
  const files = new Set(memories.map((m) => m.file));

  for (const m of memories) {
    const stem = stemOf(m.file);

    if (!m.frontmatterParsable) {
      issues.push({ kind: "frontmatter_unparsable", file: m.file, detail: "フロントマターが無いか YAML として読めない" });
    } else {
      if (m.name === null) issues.push({ kind: "frontmatter_missing", file: m.file, detail: "name" });
      if (m.description === null) issues.push({ kind: "frontmatter_missing", file: m.file, detail: "description" });
      if (m.type === null) issues.push({ kind: "frontmatter_missing", file: m.file, detail: "metadata.type" });

      if (m.type !== null && !isValidType(m.type)) {
        issues.push({ kind: "type_invalid", file: m.file, detail: m.type });
      }
      if (m.name !== null && normalize(m.name) !== normalize(stem)) {
        issues.push({ kind: "name_mismatch", file: m.file, detail: m.name });
      }
      if (m.type !== null && isValidType(m.type) && !stem.startsWith(`${m.type}_`)) {
        issues.push({ kind: "prefix_mismatch", file: m.file, detail: m.type });
      }
      for (const key of m.metadataKeys) {
        if (!KNOWN_METADATA_KEYS.has(key)) issues.push({ kind: "extra_key", file: m.file, detail: key });
      }
    }

    for (const link of m.links) {
      if (!knownNames.has(normalize(link))) {
        issues.push({ kind: "broken_link", file: m.file, detail: link });
      }
    }

    if (m.h2Count >= 3 || m.bodyLines > 60) {
      issues.push({ kind: "multi_fact", file: m.file, detail: `h2=${m.h2Count} lines=${m.bodyLines}` });
    }

    if (!indexed.has(m.file)) {
      issues.push({ kind: "index_missing", file: m.file, detail: "MEMORY.md に索引行が無い" });
    }
  }

  for (const link of indexLinks) {
    if (!files.has(link)) {
      issues.push({ kind: "file_missing", file: link, detail: "MEMORY.md に索引行があるがファイルが無い" });
    }
  }

  return issues;
}
