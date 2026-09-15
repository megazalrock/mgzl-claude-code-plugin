import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { appendError } from "./lib/log.ts";
import { ensureDirs } from "./lib/maintenance.ts";
import { dataPaths, type DataPaths } from "./lib/paths.ts";

function readString(input: unknown, key: string): string | null {
  if (typeof input === "object" && input !== null && key in input) {
    const v = (input as Record<string, unknown>)[key];
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof v === "string") return v;
  }
  return null;
}

async function main(): Promise<void> {
  // headless 抽出セッションの SessionEnd から再度ワーカーが起動する連鎖を防ぐ
  if (process.env["FADING_MEMORY_WORKER"] === "1") return;

  // catch 節から参照するため try の外で宣言する。stdin 解析前に失敗した場合は未代入のままになる
  let paths: DataPaths | undefined;
  try {
    const input: unknown = JSON.parse(await Bun.stdin.text());
    const projectDir = readString(input, "cwd") ?? process.cwd();
    const transcriptPath = readString(input, "transcript_path");
    if (transcriptPath === null) return;

    paths = dataPaths(projectDir);
    ensureDirs(paths);

    // 不在のまま worker を起動すると、子 claude がファイルを探し回って散文を返す
    if (!existsSync(transcriptPath)) {
      appendError(paths, `session-end: transcript 不在のため抽出をスキップ: ${transcriptPath}`);
      return;
    }

    // セッション終了をブロックしないため、抽出はデタッチした別プロセスに任せて即終了する
    // Bun.file を stdout に渡すと毎回切り詰められるため、追記モードの fd を渡して履歴を残す
    const logFd = openSync(paths.sessionLog, "a");
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        join(import.meta.dir, "session-end-worker.ts"),
        projectDir,
        transcriptPath,
      ],
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
    });
    proc.unref();
    closeSync(logFd);
  } catch (e) {
    try {
      // stdin/JSON解析より前の失敗では paths が未確定なため、cwd 基準の paths をログ先とする
      appendError(paths ?? dataPaths(process.cwd()), `session-end: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合も、セッションを壊さないことを優先して無視する
    }
  }
}

await main();
