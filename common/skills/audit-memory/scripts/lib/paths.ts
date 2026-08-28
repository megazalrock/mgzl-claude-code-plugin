import { homedir } from "node:os";
import { join } from "node:path";

/** プロジェクト絶対パスから ~/.claude/projects 配下のディレクトリ名を導出する（Claude Code 組み込み memory と同じ置換規則） */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[^a-zA-Z0-9]/g, "-");
}

/** カレントプロジェクトの AutoMemory ディレクトリの絶対パス */
export function memoryDir(projectDir: string, home: string = homedir()): string {
  return join(home, ".claude", "projects", projectSlug(projectDir), "memory");
}
