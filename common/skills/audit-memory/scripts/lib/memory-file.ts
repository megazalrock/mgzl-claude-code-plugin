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
  /** 本文の行数（先頭・末尾の空行を除く） */
  bodyLines: number;
}

/** フロントマター（--- で囲まれた先頭ブロック）と本文に分割する。フロントマターが無ければ raw は null */
function splitFrontmatter(content: string): { raw: string | null; body: string } {
  if (!content.startsWith("---\n")) return { raw: null, body: content };

  // 閉じフェンスは行全体が `---`（行末の空白のみ許容）の行に限る。
  // `\n---` の前方一致だと値に含まれる `----` や `--- foo` をフェンスと誤認し、
  // フロントマターと本文の境界がずれるため 1 行ずつ照合する
  let lineStart = 4;
  while (lineStart <= content.length) {
    const newlineIndex = content.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    if (content.slice(lineStart, lineEnd).trimEnd() === "---") {
      // lineStart - 1 はフェンス行直前の改行位置。raw にその改行は含めない
      const raw = content.slice(4, lineStart - 1);
      // フェンス行で終端している（末尾に改行が無い）場合は本文なし
      const body = newlineIndex === -1 ? "" : content.slice(newlineIndex + 1);
      return { raw, body };
    }
    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }
  return { raw: null, body: content };
}

/** 行頭のコードフェンス（インデント 3 以内 + バッククォート 3 個以上）と情報文字列を捉える */
const CODE_FENCE_RE = /^ {0,3}(`{3,})(.*)$/;

/**
 * コードフェンスの内側とフェンス行自体を除いた行だけを返す。
 * 記憶本文がコードフェンスで見出し記法や [[...]] を引用しているとき、
 * それを構造や未執筆リンクとして誤検出しないための前処理。
 */
function linesOutsideCodeFence(lines: string[]): string[] {
  const outside: string[] = [];
  // 開きフェンスのバッククォート数。0 はフェンス外を表す。
  // 閉じるには同数以上が必要なので、4 個で開いたフェンス内の ``` は本文の一部として扱われる
  let openFenceLength = 0;

  for (const line of lines) {
    const match = CODE_FENCE_RE.exec(line);
    if (match !== null) {
      const backticks = match[1] ?? "";
      const info = match[2] ?? "";
      if (openFenceLength === 0) {
        // 情報文字列にバッククォートを含む行はフェンスを開かない（インラインコードとの衝突を避ける）
        if (!info.includes("`")) {
          openFenceLength = backticks.length;
          continue;
        }
      } else if (backticks.length >= openFenceLength && info.trim() === "") {
        openFenceLength = 0;
        continue;
      }
    }
    if (openFenceLength === 0) outside.push(line);
  }

  // 閉じフェンスが無いまま本文が終わった場合、開きフェンス以降は内側のまま除外される
  return outside;
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

  // 先頭の空行はフロントマター直後の区切りであって本文ではないので落とす。
  // 残すと通常書式のファイルが常に 1 行多く数えられ、行数の閾値判定が境界でずれる
  const lines = body.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  const bodyLines = body.trim() === "" ? 0 : lines.length;
  // 走査対象はフェンス外のみ。bodyLines はフェンス内も含めた本文の実行数なので lines 側から数える
  const scannedLines = linesOutsideCodeFence(lines);
  const scannedBody = scannedLines.join("\n");

  return {
    file,
    name: data === null ? null : scalarToString(data.name),
    description: data === null ? null : scalarToString(data.description),
    type: metadata === null ? null : scalarToString(metadata.type),
    metadataKeys: metadata === null ? [] : Object.keys(metadata),
    frontmatterParsable: data !== null,
    links: [...scannedBody.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1] ?? ""),
    h2Count: scannedLines.filter((l) => l.startsWith("## ")).length,
    bodyLines,
  };
}
