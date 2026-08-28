/** metadata.type に許される値 */
export const VALID_TYPES = ["user", "feedback", "project", "reference"] as const; // 4値の閉じた列挙を表す const assertion（型キャストではない）

/** 記憶ファイル 1 件を構造検査に必要な範囲で解析した結果 */
export interface ParsedMemory {
  /** ベース名（例: feedback_x.md） */
  file: string;
  name: string | null;
  description: string | null;
  /** metadata.type の生の値。無効な値もそのまま持つ（検査は audit 側） */
  type: string | null;
  /** metadata 配下のキー一覧（出現順） */
  metadataKeys: string[];
  /** フロントマターが存在し YAML として読めたか */
  frontmatterParsable: boolean;
  /** 本文中の [[...]] の中身 */
  links: string[];
  /** 本文の H2 見出し（`## `）の数 */
  h2Count: number;
  /** 本文の行数（末尾の空行を除く） */
  bodyLines: number;
}

/** フロントマター（--- で囲まれた先頭ブロック）と本文に分割する。フロントマターが無ければ raw は null */
function splitFrontmatter(content: string): { raw: string | null; body: string } {
  if (!content.startsWith("---\n")) return { raw: null, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { raw: null, body: content };
  const raw = content.slice(4, end);
  const afterClose = content.indexOf("\n", end + 1);
  const body = afterClose === -1 ? "" : content.slice(afterClose + 1);
  return { raw, body };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** YAML の値を文字列として扱う。文字列以外のスカラーは String() で写し、null/undefined/オブジェクトは null */
function scalarToString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function parseMemory(file: string, content: string): ParsedMemory {
  const { raw, body } = splitFrontmatter(content);

  let data: Record<string, unknown> | null = null;
  if (raw !== null) {
    try {
      const parsed: unknown = Bun.YAML.parse(raw);
      data = isRecord(parsed) ? parsed : null;
    } catch {
      data = null;
    }
  }

  const metadata = data !== null && isRecord(data.metadata) ? data.metadata : null;

  const lines = body.replace(/\n+$/, "").split("\n");
  const bodyLines = body.trim() === "" ? 0 : lines.length;

  return {
    file,
    name: data === null ? null : scalarToString(data.name),
    description: data === null ? null : scalarToString(data.description),
    type: metadata === null ? null : scalarToString(metadata.type),
    metadataKeys: metadata === null ? [] : Object.keys(metadata),
    frontmatterParsable: data !== null,
    links: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1] ?? ""),
    h2Count: lines.filter((l) => l.startsWith("## ")).length,
    bodyLines,
  };
}
