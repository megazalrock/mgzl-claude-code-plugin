import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** 記憶データ一式が置かれるディレクトリ群 */
export interface DataPaths {
  root: string;
  memoriesDir: string;
  trashDir: string;
  indexFile: string;
  stateFile: string;
  errorLog: string;
}

/** 記憶データの保存先ルートを上書きする環境変数名 */
const DIR_ENV = "FADING_MEMORY_DIR";

/** プロジェクト絶対パスからデータディレクトリ名を導出する（組み込み memory と同じ置換規則） */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[/.]/g, "-");
}

/**
 * 記憶データのルートディレクトリを決める。
 * FADING_MEMORY_DIR が指定された場合はその値をルートとして直接使い、プロジェクトスラッグは挟まない
 * （設定側で既にプロジェクト単位の場所を選んでいるため）。
 */
function resolveRoot(projectDir: string, home: string, env: Record<string, string | undefined>): string {
  const configured = env[DIR_ENV]?.trim();
  if (!configured) return join(home, ".claude", "fading-memory", projectSlug(projectDir));
  if (configured === "~") return resolve(home);
  // 残りを絶対パスとして扱わせないため resolve ではなく join で home に連結してから正規化する
  if (configured.startsWith("~/")) return resolve(join(home, configured.slice(2)));
  if (isAbsolute(configured)) return resolve(configured);
  return resolve(projectDir, configured);
}

export function dataPaths(
  projectDir: string,
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): DataPaths {
  const root = resolveRoot(projectDir, home, env);
  return {
    root,
    memoriesDir: join(root, "memories"),
    trashDir: join(root, "trash"),
    indexFile: join(root, "INDEX.md"),
    stateFile: join(root, "state.json"),
    errorLog: join(root, "error.log"),
  };
}
