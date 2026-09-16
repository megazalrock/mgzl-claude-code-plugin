#!/usr/bin/env bun

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 走査対象の拡張子 */
const SOURCE_EXTENSIONS = [".ts", ".vue"] as const;

/** 走査から除外するディレクトリ名 */
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".nuxt", "dist", ".output", "coverage"]);

/** import 指定子に付け足して実ファイルを探す候補。前から順に試し、最初に実在したものを採用する */
const RESOLUTION_SUFFIXES = ["", ".ts", ".vue", ".d.ts", "/index.ts", "/index.vue"] as const;

/** root 相対として解釈するエイリアス接頭辞。長いものから順に判定する */
const ROOT_ALIAS_PREFIXES = ["~~/", "@@/", "~/", "@/"] as const;

/** 1 つの変更ファイルあたりに出力する逆依存の既定上限 */
const DEFAULT_LIMIT = 10;

/**
 * import 指定子を拾う正規表現。
 * 1. `import ... from` と `export ... from` の両方
 * 2. 動的 import
 * 3. 副作用 import
 */
const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"\n]+)['"]/g,
] as const;

export type CliOptions = {
  /** 解析対象プロジェクトのルート絶対パス */
  root: string;
  /** 変更ファイル一覧ファイルのパス */
  filesPath: string;
  /** 結果の出力先ファイルパス */
  outPath: string;
  /** 1 つの変更ファイルあたりに出力する逆依存の上限件数 */
  limit: number;
};

export type ParseArgsResult = { ok: true; options: CliOptions } | { ok: false; error: string };

/** `--name value` 形式の引数を取り出す。無ければ undefined */
const optionValue = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
};

/** コマンドライン引数を CliOptions に分解する */
export const parseArgs = (argv: readonly string[]): ParseArgsResult => {
  const root = optionValue(argv, "--root");
  const filesPath = optionValue(argv, "--files");
  const outPath = optionValue(argv, "--out");
  const rawLimit = optionValue(argv, "--limit");

  if (root === undefined || root.startsWith("--")) {
    return { ok: false, error: "missing_root" };
  }
  if (filesPath === undefined || filesPath.startsWith("--")) {
    return { ok: false, error: "missing_files" };
  }
  if (outPath === undefined || outPath.startsWith("--")) {
    return { ok: false, error: "missing_out" };
  }

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return { ok: false, error: "invalid_limit" };
    }
    limit = parsed;
  }

  return { ok: true, options: { root: path.resolve(root), filesPath, outPath, limit } };
};

/** ファイル内容から import 指定子を重複なく取り出す */
export const extractImportSpecifiers = (content: string): string[] => {
  const specifiers = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    // モジュールスコープで使い回す正規表現なので、前回の走査位置を持ち越さないよう明示的に戻す
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match !== null) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
      match = pattern.exec(content);
    }
  }

  return [...specifiers];
};

/**
 * import 指定子を root 相対の実ファイルパスへ解決する。
 * 裸のパッケージ名や `#app` などの仮想モジュールは解決対象外なので null を返す
 */
export const resolveSpecifier = (args: {
  specifier: string;
  importerRelPath: string;
  exists: (relPath: string) => boolean;
}): string | null => {
  const { specifier, importerRelPath, exists } = args;

  const alias = ROOT_ALIAS_PREFIXES.find((prefix) => specifier.startsWith(prefix));
  const rawPath =
    alias !== undefined
      ? specifier.slice(alias.length)
      : specifier.startsWith("./") || specifier.startsWith("../")
        ? path.join(path.dirname(importerRelPath), specifier)
        : null;

  if (rawPath === null) {
    return null;
  }

  const normalized = path.normalize(rawPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${normalized}${suffix}`;
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
};

/**
 * ドメイン名の表記ゆれを吸収した比較用の文字列を作る。
 * `schedules`(ディレクトリ名) と `Schedule`(コンポーネント名) がどちらも `schedule` になる
 */
export const normalizeDomainName = (name: string): string => {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]/g, "");

  // `-ies` は先に `-y` へ変換する。`s$` 除去を先にかけると `companies` が `companie` になり、
  // `Company` の正規化結果 `company` と一致しなくなる。`children` のような不規則複数形までは
  // 汎用対応せず、`-ies` の1ルールのみ追加する。
  return cleaned.endsWith("ies") ? `${cleaned.slice(0, -3)}y` : cleaned.replace(/s$/, "");
};

/**
 * パスからドメイン名を判定する。判定できなければ空文字。
 * 部分文字列での一致にすると `SupplierPaySchedule` のような別ドメインの名前を誤判定するため、
 * 必ずパスセグメント単位で突き合わせる
 */
export const detectDomain = (relPath: string, domains: ReadonlySet<string>): string => {
  const segments = relPath.split("/");

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    // 末尾セグメントだけは拡張子を落とす。`Schedule.ts` の `.ts` が残ると `schedulets` になり一致しない
    const isLast = index === segments.length - 1;
    const bare = isLast ? segment.slice(0, segment.length - path.extname(segment).length) : segment;
    const normalized = normalizeDomainName(bare);
    if (normalized !== "" && domains.has(normalized)) {
      return normalized;
    }
  }

  return "";
};

/** Nuxt の auto-import 対象（`composables/` 直下・`utils/` 直下）か */
export const isAutoImportTarget = (relPath: string): boolean => {
  const segments = relPath.split("/");
  if (segments.length !== 2) {
    return false;
  }
  return segments[0] === "composables" || segments[0] === "utils";
};

export type SourceFile = {
  /** root からの相対パス */
  relPath: string;
  content: string;
};

/** 「import 先 → その import を書いているファイルの集合」の逆引きインデックスを 1 パスで作る */
export const buildReverseIndex = (files: readonly SourceFile[]): Map<string, Set<string>> => {
  const relPaths = new Set(files.map((file) => file.relPath));
  const exists = (relPath: string): boolean => relPaths.has(relPath);
  const index = new Map<string, Set<string>>();

  for (const file of files) {
    for (const specifier of extractImportSpecifiers(file.content)) {
      const target = resolveSpecifier({ specifier, importerRelPath: file.relPath, exists });
      if (target === null || target === file.relPath) {
        continue;
      }
      const importers = index.get(target);
      if (importers === undefined) {
        index.set(target, new Set([file.relPath]));
      } else {
        importers.add(file.relPath);
      }
    }
  }

  return index;
};

/** 同一ドメインの importer を先に、それ以外を後に並べる。どちらの中でも辞書順で安定させる */
export const sortImporters = (args: {
  importers: readonly string[];
  targetDomain: string;
  domains: ReadonlySet<string>;
}): string[] => {
  const sorted = [...args.importers].sort();

  if (args.targetDomain === "") {
    return sorted;
  }

  const sameDomain = sorted.filter((relPath) => detectDomain(relPath, args.domains) === args.targetDomain);
  const otherDomain = sorted.filter((relPath) => detectDomain(relPath, args.domains) !== args.targetDomain);

  return [...sameDomain, ...otherDomain];
};

export type ReverseDepsBlock = {
  target: string;
  domain: string;
  related: string[];
  omitted: number;
  autoImport: boolean;
};

/** 1 つの変更ファイルぶんの出力ブロックを組み立てる */
export const buildBlock = (args: {
  target: string;
  importers: readonly string[];
  domains: ReadonlySet<string>;
  limit: number;
}): ReverseDepsBlock => {
  const domain = detectDomain(args.target, args.domains);
  const sorted = sortImporters({ importers: args.importers, targetDomain: domain, domains: args.domains });
  const related = sorted.slice(0, args.limit);

  return {
    target: args.target,
    domain,
    related,
    omitted: sorted.length - related.length,
    autoImport: isAutoImportTarget(args.target),
  };
};

/** ブロック群を key=value の行指向テキストへ整形する */
export const formatBlocks = (blocks: readonly ReverseDepsBlock[]): string => {
  const rendered = blocks.map((block) => {
    const lines = [`target=${block.target}`, `domain=${block.domain}`];
    for (const related of block.related) {
      lines.push(`related=${related}`);
    }
    lines.push(`omitted=${block.omitted}`);
    if (block.autoImport) {
      lines.push("autoimport=true");
    }
    return lines.join("\n");
  });

  return rendered.length === 0 ? "" : `${rendered.join("\n\n")}\n`;
};

/** 変更ファイル一覧のテキストを、空行と重複を除いたパス配列にする */
export const parseTargetList = (content: string): string[] => {
  const targets: string[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    targets.push(trimmed);
  }

  return targets;
};

/** root 配下の .ts / .vue を再帰的に集める */
export const listSourceFiles = (root: string): string[] => {
  const results: string[] = [];

  const walk = (relDir: string): void => {
    const entries = readdirSync(path.join(root, relDir), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        // 先頭ドットのディレクトリは .git や .nuxt などの生成物・内部データで、走査してもコストしか増えない
        if (entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        walk(relPath);
        continue;
      }
      // シンボリックリンクは実体側を別途走査するので二重に数えない
      if (!entry.isFile()) {
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => relPath.endsWith(extension))) {
        results.push(relPath);
      }
    }
  };

  walk("");

  return results;
};

/**
 * root が Nuxt プロジェクトのルートかどうかを `pages/` ディレクトリの有無で判定する。
 * ここが false のまま処理を続けると collectDomains が常に空集合を返し、
 * 同一ドメイン優先の並び順が黙って効かなくなるため、呼び出し側でエラーとして扱う
 */
export const hasPagesDirectory = (root: string): boolean => {
  try {
    return statSync(path.join(root, "pages")).isDirectory();
  } catch {
    return false;
  }
};

/** `<root>/pages/` 直下のディレクトリ名から既知ドメイン名の集合を作る */
export const collectDomains = (root: string): Set<string> => {
  const domains = new Set<string>();

  const readPagesEntries = () => {
    try {
      return readdirSync(path.join(root, "pages"), { withFileTypes: true });
    } catch {
      // pages/ を持たないプロジェクトではドメイン判定を諦めて空のまま進める
      return [];
    }
  };

  for (const entry of readPagesEntries()) {
    if (!entry.isDirectory()) {
      continue;
    }
    // `__docs__` `__stories__` のような先頭・末尾が `__` のディレクトリは Storybook 等の
    // ツール用でドメインではないため、集合に入れない
    if (entry.name.startsWith("__")) {
      continue;
    }
    const normalized = normalizeDomainName(entry.name);
    if (normalized !== "") {
      domains.add(normalized);
    }
  }

  return domains;
};

if (import.meta.main) {
  const startedAt = Date.now();
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.ok) {
    console.log(`error=${parsed.error}`);
    console.log("usage=bun run find-reverse-deps.ts --root <path> --files <path> --out <path> [--limit <n>]");
    process.exit(1);
  }

  const { root, filesPath, outPath, limit } = parsed.options;

  if (!hasPagesDirectory(root)) {
    console.log(`error=root_missing_pages detail=${root}`);
    console.log("usage=--root には pages/ を持つ Nuxt プロジェクトのルートを渡してください");
    process.exit(1);
  }

  let targetListContent: string;
  try {
    targetListContent = readFileSync(filesPath, "utf8");
  } catch {
    console.log(`error=files_unreadable detail=${filesPath}`);
    process.exit(1);
  }

  let sourcePaths: string[];
  try {
    sourcePaths = listSourceFiles(root);
  } catch {
    console.log(`error=root_unreadable detail=${root}`);
    process.exit(1);
  }

  const sourceFiles: SourceFile[] = [];
  for (const relPath of sourcePaths) {
    try {
      sourceFiles.push({ relPath, content: readFileSync(path.join(root, relPath), "utf8") });
    } catch {
      // 読めないファイルは import 元として数えられないだけなので、走査全体は続行する
    }
  }

  const reverseIndex = buildReverseIndex(sourceFiles);
  const domains = collectDomains(root);
  const targets = parseTargetList(targetListContent);

  const blocks = targets.map((target) =>
    buildBlock({ target, importers: [...(reverseIndex.get(target) ?? [])], domains, limit }),
  );

  writeFileSync(outPath, formatBlocks(blocks), "utf8");

  console.log(`out=${outPath}`);
  console.log(`scanned=${sourceFiles.length}`);
  console.log(`domains=${domains.size}`);
  console.log(`targets=${blocks.length}`);
  console.log(`elapsed_ms=${Date.now() - startedAt}`);
}
