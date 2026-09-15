import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DataPaths } from "./paths.ts";

/**
 * フックは失敗してもセッションを壊せないため、例外はここに記録して握りつぶす前提。
 * 1 つの root を複数プロジェクトで共有する構成があるため、発信元の projectDir を行に含める。
 */
export function appendError(paths: DataPaths, message: string): void {
  mkdirSync(dirname(paths.errorLog), { recursive: true });
  appendFileSync(
    paths.errorLog,
    `${new Date().toISOString()} [${paths.projectDir}] ${message}\n`,
  );
}
