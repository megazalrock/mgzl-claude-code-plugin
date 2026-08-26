import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DataPaths } from "./paths.ts";

/** フックは失敗してもセッションを壊せないため、例外はここに記録して握りつぶす前提 */
export function appendError(paths: DataPaths, message: string): void {
  mkdirSync(dirname(paths.errorLog), { recursive: true });
  appendFileSync(paths.errorLog, `${new Date().toISOString()} ${message}\n`);
}
