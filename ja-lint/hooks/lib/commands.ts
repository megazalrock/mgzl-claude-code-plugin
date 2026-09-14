export type TargetContext = "comment" | "commit" | "pr" | "markdown";

export type LintTarget = {
  text: string;
  context: TargetContext;
};

/** heredoc 本文をトークナイズ前に退避するための番兵。シェルのコマンド文字列には現れない */
const PLACEHOLDER_PREFIX = "\u0000ja-lint-heredoc-";
const PLACEHOLDER_SUFFIX = "\u0000";

const HEREDOC = /\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n\2\s*\)/g;

function extractHeredocs(command: string): { command: string; bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  let counter = 0;
  const replaced = command.replace(HEREDOC, (_match, _quote: string, _tag: string, body: string) => {
    const key = `${PLACEHOLDER_PREFIX}${counter}${PLACEHOLDER_SUFFIX}`;
    counter += 1;
    bodies.set(key, body);
    return key;
  });
  return { command: replaced, bodies };
}

/** バックスラッシュエスケープを解除できる対象文字。ダブルクォート内でのみ意味を持つ（シェルの仕様） */
const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', "\\", "$", "`"]);

/** クォートを解いた素のトークン列に分解する。シェルの完全な文法は扱わない */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  // サロゲートペア（絵文字等）を1文字として扱うためコードポイント単位の配列にする
  const chars = Array.from(command);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    if (quote === '"') {
      const next = chars[i + 1];
      if (ch === "\\" && next !== undefined && DOUBLE_QUOTE_ESCAPABLE.has(next)) {
        current += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        quote = undefined;
        continue;
      }
      current += ch;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        quote = undefined;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function resolve(value: string, bodies: Map<string, string>): string {
  const body = bodies.get(value);
  return body !== undefined ? body : value;
}

type Kind = "git-commit" | "gh-pr" | undefined;

/** git のグローバルオプションのうち、直後に値トークンを取るもの（例: `-C /path`） */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set(["-C", "-c"]);
/** gh のグローバルオプションのうち、直後に値トークンを取るもの（例: `-R owner/repo`） */
const GH_GLOBAL_OPTIONS_WITH_VALUE = new Set(["-R", "--repo"]);

function classify(tokens: string[]): Kind {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "git") {
      let j = i + 1;
      while (j < tokens.length) {
        const token = tokens[j] ?? "";
        if (!token.startsWith("-")) break;
        j += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
      }
      if (tokens[j] === "commit") return "git-commit";
    }
    if (tokens[i] === "gh") {
      let j = i + 1;
      while (j < tokens.length) {
        const token = tokens[j] ?? "";
        if (!token.startsWith("-")) break;
        j += GH_GLOBAL_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
      }
      if (tokens[j] === "pr") {
        const c = tokens[j + 1];
        if (c === "create" || c === "edit") return "gh-pr";
      }
    }
  }
  return undefined;
}

type Flag = { names: string[]; slot: string };

/** `-am` `-sm` のように他の短縮オプションと結合された `-m` を検出する（git commit 専用） */
const COMBINED_SHORT_M = /^-[A-Za-z]*m$/;

function collectFlags(
  tokens: string[],
  bodies: Map<string, string>,
  flags: Flag[],
  kind: Kind,
): Map<string, string[]> {
  const collected = new Map<string, string[]>();
  const push = (slot: string, value: string) => {
    if (value === "") return;
    const list = collected.get(slot) ?? [];
    list.push(value);
    collected.set(slot, list);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (kind === "git-commit" && token !== "-m" && COMBINED_SHORT_M.test(token)) {
      const value = tokens[i + 1];
      if (value !== undefined) {
        push("message", resolve(value, bodies));
        i += 1;
      }
      continue;
    }
    for (const flag of flags) {
      if (flag.names.includes(token)) {
        const value = tokens[i + 1];
        if (value !== undefined) {
          push(flag.slot, resolve(value, bodies));
          i += 1;
        }
        break;
      }
      const withEquals = flag.names.find((name) => name.startsWith("--") && token.startsWith(`${name}=`));
      if (withEquals !== undefined) {
        push(flag.slot, resolve(token.slice(withEquals.length + 1), bodies));
        break;
      }
    }
  }
  return collected;
}

/**
 * Bash コマンドから lint 対象の文字列を取り出す。
 * ファイル読み込みは呼び出し側から注入してテストで実ファイルを触らずに済ませる。
 */
export function extractLintTargets(
  command: string,
  readFile: (path: string) => string | undefined,
): LintTarget[] {
  const { command: stripped, bodies } = extractHeredocs(command);
  const tokens = tokenize(stripped);
  const kind = classify(tokens);
  if (kind === undefined) return [];

  if (kind === "git-commit") {
    const collected = collectFlags(
      tokens,
      bodies,
      [
        { names: ["-m", "--message"], slot: "message" },
        { names: ["-F", "--file"], slot: "file" },
      ],
      kind,
    );
    const messages = collected.get("message") ?? [];
    if (messages.length > 0) {
      return [{ text: messages.join("\n\n"), context: "commit" }];
    }
    for (const path of collected.get("file") ?? []) {
      const content = readFile(path);
      if (content !== undefined && content !== "") {
        return [{ text: content, context: "commit" }];
      }
    }
    return [];
  }

  const collected = collectFlags(
    tokens,
    bodies,
    [
      { names: ["-t", "--title"], slot: "title" },
      { names: ["-b", "--body"], slot: "body" },
      { names: ["-F", "--body-file"], slot: "body-file" },
    ],
    kind,
  );
  const targets: LintTarget[] = [];
  for (const title of collected.get("title") ?? []) {
    targets.push({ text: title, context: "commit" });
  }
  const bodiesFound = collected.get("body") ?? [];
  if (bodiesFound.length > 0) {
    for (const body of bodiesFound) targets.push({ text: body, context: "pr" });
    return targets;
  }
  for (const path of collected.get("body-file") ?? []) {
    const content = readFile(path);
    if (content !== undefined && content !== "") {
      targets.push({ text: content, context: "pr" });
    }
  }
  return targets;
}
