/** 記憶データの frontmatter。正データはこの構造の .md ファイルのみ */
export interface MemoryMeta {
  title: string;
  created: string;
  updated: string;
  lastReferenced: string | null;
  score: number;
  permanent: boolean;
  related: string[];
}

export interface MemoryDoc {
  meta: MemoryMeta;
  body: string;
}

// 外部依存を持たないため YAML 全般ではなく本プラグインが書く形式だけを解釈する
function parseRelated(value: string): string[] | null {
  const m = value.match(/^\[(.*)\]$/);
  if (m === null || m[1] === undefined) return null;
  if (m[1].trim() === "") return [];
  return m[1].split(",").map((s) => s.trim());
}

export function parseMemory(text: string): MemoryDoc | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const head = text.slice(4, end);
  const body = text.slice(end + 5).replace(/^\n/, "").trimEnd();

  const raw: Record<string, string> = {};
  for (const line of head.split("\n")) {
    if (line.trim() === "") continue;
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (m === null || m[1] === undefined || m[2] === undefined) return null;
    raw[m[1]] = m[2];
  }

  const title = raw["title"];
  const created = raw["created"];
  const updated = raw["updated"];
  if (title === undefined || created === undefined || updated === undefined) return null;

  const score = Number(raw["score"] ?? "0");
  if (!Number.isFinite(score)) return null;

  const related = parseRelated(raw["related"] ?? "[]");
  if (related === null) return null;

  const lastRefRaw = raw["lastReferenced"];
  const lastReferenced = lastRefRaw === undefined || lastRefRaw === "null" ? null : lastRefRaw;

  return {
    meta: {
      title,
      created,
      updated,
      lastReferenced,
      score,
      permanent: raw["permanent"] === "true",
      related,
    },
    body,
  };
}

export function serializeMemory(doc: MemoryDoc): string {
  const m = doc.meta;
  return [
    "---",
    `title: ${m.title}`,
    `created: ${m.created}`,
    `updated: ${m.updated}`,
    `lastReferenced: ${m.lastReferenced ?? "null"}`,
    `score: ${m.score}`,
    `permanent: ${m.permanent}`,
    `related: [${m.related.join(", ")}]`,
    "---",
    "",
    doc.body.trimEnd(),
    "",
  ].join("\n");
}
