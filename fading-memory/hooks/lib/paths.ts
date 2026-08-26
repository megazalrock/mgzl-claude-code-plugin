import { homedir } from "node:os";
import { join } from "node:path";

/** 記憶データ一式が置かれるディレクトリ群 */
export interface DataPaths {
  root: string;
  memoriesDir: string;
  trashDir: string;
  indexFile: string;
  stateFile: string;
  errorLog: string;
}

/** プロジェクト絶対パスからデータディレクトリ名を導出する（組み込み memory と同じ置換規則） */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[/.]/g, "-");
}

export function dataPaths(projectDir: string, home: string = homedir()): DataPaths {
  const root = join(home, ".claude", "fading-memory", projectSlug(projectDir));
  return {
    root,
    memoriesDir: join(root, "memories"),
    trashDir: join(root, "trash"),
    indexFile: join(root, "INDEX.md"),
    stateFile: join(root, "state.json"),
    errorLog: join(root, "error.log"),
  };
}
