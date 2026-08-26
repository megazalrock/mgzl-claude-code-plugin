import { config } from "./lib/config.ts";
import {
  applyExtraction,
  buildExtractionPrompt,
  parseExtractionResult,
} from "./lib/extraction.ts";
import { appendError } from "./lib/log.ts";
import { ensureDirs, loadMemories } from "./lib/maintenance.ts";
import { dataPaths } from "./lib/paths.ts";

const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const projectDir = process.argv[2];
  const transcriptPath = process.argv[3];
  if (projectDir === undefined || transcriptPath === undefined) {
    console.error("usage: session-end-worker.ts <projectDir> <transcriptPath>");
    process.exit(1);
  }

  const paths = dataPaths(projectDir);
  ensureDirs(paths);

  try {
    const { memories } = loadMemories(paths);
    const catalog = memories.map((m) => `- ${m.slug}: ${m.meta.title}`).join("\n");
    const prompt = buildExtractionPrompt(transcriptPath, catalog);

    const proc = Bun.spawn({
      cmd: [
        "claude",
        "-p",
        prompt,
        "--model",
        config.headlessModel,
        "--output-format",
        "json",
        "--allowedTools",
        "Read",
      ],
      cwd: projectDir,
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const killTimer = setTimeout(() => proc.kill(), CLAUDE_TIMEOUT_MS);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(killTimer);

    if (exitCode !== 0) {
      appendError(paths, `worker: claude が exit ${exitCode}: ${stderr.slice(0, 500)}`);
      return;
    }

    // --output-format json は {"result": "<モデルの最終出力>"} 形式のラッパーを返す
    const wrapper: unknown = JSON.parse(stdout);
    const resultText =
      typeof wrapper === "object" && wrapper !== null && "result" in wrapper
        ? (wrapper as { result: unknown }).result
        : null;
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof resultText !== "string") {
      appendError(paths, "worker: claude 出力に result 文字列が無い");
      return;
    }

    const result = parseExtractionResult(resultText);
    if (result === null) {
      appendError(paths, `worker: 抽出結果が不正なため破棄: ${resultText.slice(0, 500)}`);
      return;
    }

    const report = applyExtraction(paths, result, new Date().toISOString());
    console.log(JSON.stringify(report));
  } catch (e) {
    try {
      appendError(paths, `worker: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合は諦める
    }
  }
}

await main();
