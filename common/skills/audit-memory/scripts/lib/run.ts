import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { auditMemories, parseIndexLinks } from "./audit.ts";
import { parseMemory, type ParsedMemory } from "./memory-file.ts";
import { memoryDir } from "./paths.ts";

/** 構造検査の実行結果。lines は 1 行 1 件の key=value */
export interface RunResult {
  exitCode: number;
  lines: string[];
}

/** key=value は 1 行 1 件なので、YAML の複数行スカラー由来の改行はスペースに潰す */
function singleLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

/** description は行末までを値とするため最後に置く。欠落値は - */
function memoryLine(m: ParsedMemory): string {
  return `memory=${m.file} type=${m.type ?? "-"} name=${m.name ? singleLine(m.name) : "-"} description=${m.description ? singleLine(m.description) : "-"}`;
}

/** 壊れたシンボリックリンク等で statSync が throw しても検査全体を止めない */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function runCheck(projectDir: string, home?: string): RunResult {
  const dir = memoryDir(projectDir, home);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { exitCode: 1, lines: [`error=memory_dir_not_found dir=${dir}`] };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    .filter((f) => isRegularFile(join(dir, f)))
    .sort();
  const memories = files.map((f) => parseMemory(f, readFileSync(join(dir, f), "utf8")));

  const indexPath = join(dir, "MEMORY.md");
  const indexLinks = existsSync(indexPath) ? parseIndexLinks(readFileSync(indexPath, "utf8")) : [];

  const issues = auditMemories(memories, indexLinks);

  const lines = [`dir=${dir}`, `count=${memories.length}`];
  for (const m of memories) lines.push(memoryLine(m));
  for (const i of issues) lines.push(`issue=${i.kind} file=${i.file} detail=${i.detail}`);
  return { exitCode: 0, lines };
}
