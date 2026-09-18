import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Jev に渡す候補スキル 1 件 */
export type RosterEntry = {
  /** "cbo:review__diff" など。プラグイン外のスキルはプレフィックスなし */
  name: string;
  /** フロントマターの description 全文 */
  description: string;
  /** フロントマター以降の本文の先頭 1600 文字 */
  body: string;
  /** SKILL.md の絶対パス。ログとデバッグ用 */
  path: string;
};

export type Frontmatter = {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
};

export type DiscoverOptions = { home?: string };

export const BODY_CHARS = 1600;
/** Jev の Choice が受け取れる候補数の上限 */
export const MAX_ENTRIES = 255;

function stripQuotes(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

/**
 * SKILL.md の先頭フロントマターを行単位で読む簡易パーサ。
 * 外部依存を持たないため、ネストやブロックスカラーは扱わず key: value だけを見る。
 */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const frontmatter: Frontmatter = { disableModelInvocation: false };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatter, body: text };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  const scanEnd = end === -1 ? lines.length : end;

  for (let i = 1; i < scanEnd; i++) {
    const line = lines[i] ?? "";
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (key === "name") frontmatter.name = value;
    if (key === "description") frontmatter.description = value;
    if (key === "disable-model-invocation") frontmatter.disableModelInvocation = value === "true";
  }

  if (end === -1) return { frontmatter, body: "" };
  return { frontmatter, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** settings.json 3 枚の enabledPlugins を後勝ちでマージし、true のキーだけ返す */
function enabledPluginKeys(cwd: string, home: string): string[] {
  const merged = new Map<string, boolean>();
  const files = [
    join(home, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
  for (const file of files) {
    const settings = readJsonFile(file);
    if (!isRecord(settings)) continue;
    const enabled = settings["enabledPlugins"];
    if (!isRecord(enabled)) continue;
    for (const [key, value] of Object.entries(enabled)) {
      if (typeof value === "boolean") merged.set(key, value);
    }
  }
  return [...merged.entries()].filter(([, value]) => value).map(([key]) => key);
}

/** installed_plugins.json から、この cwd に効くインストール先を引く */
function installPathFor(key: string, cwd: string, home: string): string | undefined {
  const installed = readJsonFile(join(home, ".claude", "plugins", "installed_plugins.json"));
  if (!isRecord(installed)) return undefined;
  const plugins = installed["plugins"];
  if (!isRecord(plugins)) return undefined;
  const entries = plugins[key];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const installPath = entry["installPath"];
    if (typeof installPath !== "string") continue;
    if (entry["scope"] === "user" || entry["projectPath"] === cwd) return installPath;
  }
  return undefined;
}

function readSkill(skillsDir: string, dirName: string, prefix: string): RosterEntry | undefined {
  const path = join(skillsDir, dirName, "SKILL.md");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const { frontmatter, body } = parseFrontmatter(text);
  if (frontmatter.description === undefined || frontmatter.description === "") return undefined;
  if (frontmatter.disableModelInvocation) return undefined;
  const bare = frontmatter.name === undefined || frontmatter.name === "" ? dirName : frontmatter.name;
  return {
    name: `${prefix}${bare}`,
    description: frontmatter.description,
    body: body.slice(0, BODY_CHARS),
    path,
  };
}

function collect(skillsDir: string, prefix: string, into: Map<string, RosterEntry>): void {
  let dirNames: string[];
  try {
    dirNames = readdirSync(skillsDir).sort();
  } catch {
    return;
  }
  for (const dirName of dirNames) {
    const entry = readSkill(skillsDir, dirName, prefix);
    if (entry === undefined) continue;
    if (!into.has(entry.name)) into.set(entry.name, entry);
  }
}

/**
 * 有効なプラグインとユーザー / プロジェクトのスキルディレクトリを走査して roster を作る。
 * キャッシュは持たず毎回ディスクを読む。数十件の規模なら hook の予算内に収まる。
 */
export function discover(cwd: string, options: DiscoverOptions = {}): RosterEntry[] {
  const home = options.home ?? process.env["HOME"] ?? homedir();
  const entries = new Map<string, RosterEntry>();

  for (const key of enabledPluginKeys(cwd, home)) {
    const installPath = installPathFor(key, cwd, home);
    if (installPath === undefined) continue;
    const pluginName = key.split("@")[0] ?? key;
    collect(join(installPath, "skills"), `${pluginName}:`, entries);
  }
  collect(join(home, ".claude", "skills"), "", entries);
  collect(join(cwd, ".claude", "skills"), "", entries);

  const all = [...entries.values()];
  if (all.length > MAX_ENTRIES) {
    process.stderr.write(
      `typesafe suggest-skill: roster が ${all.length} 件あるため先頭 ${MAX_ENTRIES} 件で打ち切りました\n`,
    );
    return all.slice(0, MAX_ENTRIES);
  }
  return all;
}
