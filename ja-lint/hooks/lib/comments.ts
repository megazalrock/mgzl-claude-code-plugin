const JAPANESE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u;

/** ひらがな・カタカナ・漢字を 1 文字でも含むか。textlint を読み込む前の足切りに使う */
export function containsJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/**
 * new_string にあって old_string に無い行を多重集合の差として返す。
 * Edit で書き換えられなかった既存行まで lint すると、無関係な既存コメントで差し戻しが起きるため。
 */
export function addedLines(oldString: string, newString: string): string[] {
  const remaining = new Map<string, number>();
  for (const line of oldString.split("\n")) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of newString.split("\n")) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      continue;
    }
    added.push(line);
  }
  return added;
}

type CommentSyntax = {
  line: string[];
  block: Array<readonly [string, string]>;
};

const SLASH: CommentSyntax = { line: ["//"], block: [["/*", "*/"]] };
const HASH: CommentSyntax = { line: ["#"], block: [] };
const MARKUP: CommentSyntax = { line: [], block: [["<!--", "-->"]] };
const DASH: CommentSyntax = { line: ["--"], block: [] };

function merge(...syntaxes: CommentSyntax[]): CommentSyntax {
  return {
    line: syntaxes.flatMap((s) => s.line),
    block: syntaxes.flatMap((s) => s.block),
  };
}

const SYNTAX_BY_EXTENSION: Record<string, CommentSyntax> = {
  ts: SLASH,
  tsx: SLASH,
  js: SLASH,
  jsx: SLASH,
  mjs: SLASH,
  cjs: SLASH,
  css: SLASH,
  scss: SLASH,
  go: SLASH,
  rs: SLASH,
  java: SLASH,
  kt: SLASH,
  swift: SLASH,
  vue: merge(SLASH, MARKUP),
  php: merge(SLASH, HASH),
  html: MARKUP,
  yml: HASH,
  yaml: HASH,
  sh: HASH,
  bash: HASH,
  zsh: HASH,
  py: HASH,
  rb: HASH,
  toml: HASH,
  sql: DASH,
};

function syntaxFor(filePath: string): CommentSyntax | undefined {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return SYNTAX_BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}

/** `@param {T} name 説明` のようなタグ行から説明部分だけを取り出す */
const DOC_TAG = /^@[A-Za-z-]+(?:\s+\{[^}]*\})?(?:\s+\$?[A-Za-z_$][\w.$[\]-]*)?\s*(.*)$/;

function normalizeCommentText(raw: string): string {
  // ブロックコメント本文の行頭に付く装飾の `*` は文章ではないため落とす
  const stripped = raw.replace(/^\s*\*+\s?/, "").trim();
  const tag = DOC_TAG.exec(stripped);
  if (tag !== null) return (tag[1] ?? "").trim();
  return stripped;
}

type Extracted = { index: number; text: string };

function extractFromLine(
  line: string,
  syntax: CommentSyntax,
  openBlock: readonly [string, string] | undefined,
): { texts: string[]; openBlock: readonly [string, string] | undefined } {
  const texts: string[] = [];
  let rest = line;
  let current = openBlock;

  for (;;) {
    if (current !== undefined) {
      const closeAt = rest.indexOf(current[1]);
      if (closeAt < 0) {
        texts.push(rest);
        return { texts, openBlock: current };
      }
      texts.push(rest.slice(0, closeAt));
      rest = rest.slice(closeAt + current[1].length);
      current = undefined;
      continue;
    }

    let best: { at: number; marker: string; block?: readonly [string, string] } | undefined;
    for (const marker of syntax.line) {
      const at = rest.indexOf(marker);
      if (at >= 0 && (best === undefined || at < best.at)) best = { at, marker };
    }
    for (const block of syntax.block) {
      const at = rest.indexOf(block[0]);
      if (at >= 0 && (best === undefined || at < best.at)) best = { at, marker: block[0], block };
    }
    if (best === undefined) return { texts, openBlock: undefined };

    const after = rest.slice(best.at + best.marker.length);
    if (best.block === undefined) {
      texts.push(after);
      return { texts, openBlock: undefined };
    }
    rest = after;
    current = best.block;
  }
}

/**
 * 行ベースの正規表現でコメント本文を抽出し、連続するコメント行を 1 段落に連結して返す。
 * 段落に連結するのは、行をまたぐ助詞の重複などが文単位で判定されるようにするためである。
 */
export function extractCommentBlocks(filePath: string, lines: string[]): string[] {
  const syntax = syntaxFor(filePath);
  if (syntax === undefined) return [];

  const extracted: Extracted[] = [];
  let openBlock: readonly [string, string] | undefined;
  lines.forEach((line, index) => {
    const result = extractFromLine(line, syntax, openBlock);
    openBlock = result.openBlock;
    for (const raw of result.texts) {
      const text = normalizeCommentText(raw);
      if (text === "" || !containsJapanese(text)) continue;
      extracted.push({ index, text });
    }
  });

  const blocks: string[] = [];
  let previousIndex: number | undefined;
  let buffer = "";
  for (const item of extracted) {
    const contiguous = previousIndex !== undefined && item.index - previousIndex <= 1;
    if (contiguous) {
      buffer += item.text;
    } else {
      if (buffer !== "") blocks.push(buffer);
      buffer = item.text;
    }
    previousIndex = item.index;
  }
  if (buffer !== "") blocks.push(buffer);
  return blocks;
}
