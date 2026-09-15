import { config } from "./lib/config.ts";
import {
  applyExtraction,
  buildExtractionPrompt,
  EXTRACTION_JSON_SCHEMA,
  parseExtractionResult,
  validateExtractionResult,
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

  try {
    ensureDirs(paths);
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
        // ユーザーの CLAUDE.md の人格設定やプラグインが出力へ混入するのを防ぐ
        "--safe-mode",
        // 他ツールの呼び出し拒否による謝罪文の混入と、トランスクリプト内の指示の実行を防ぐ
        "--tools",
        "Read",
        "--permission-prompts",
        "none",
        // 出力を構造化し、散文の混入を CLI 側で排除する
        "--json-schema",
        JSON.stringify(EXTRACTION_JSON_SCHEMA),
      ],
      cwd: projectDir,
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const killTimer = setTimeout(() => proc.kill(), CLAUDE_TIMEOUT_MS);
    let stdout: string;
    let stderr: string;
    let exitCode: number;
    try {
      // stdout/stderr を順に await すると、先に読む方のパイプが埋まるまで claude 側が
      // ブロックし得るため、両ストリームと終了待ちを並行に drain する
      [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
    } finally {
      clearTimeout(killTimer);
    }

    if (exitCode !== 0) {
      appendError(paths, `worker: claude が exit ${exitCode}: ${stderr.slice(0, 500)}`);
      return;
    }

    // --output-format json は {"result": "<モデルの最終出力>"} 形式のラッパーを返す。
    // --json-schema 併用時は検証済みオブジェクトが structured_output にも入る
    const wrapper: unknown = JSON.parse(stdout);
    const w =
      typeof wrapper === "object" && wrapper !== null
        ? (wrapper as Record<string, unknown>)
        : {};
    // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
    const structured = w["structured_output"];

    let result: ReturnType<typeof validateExtractionResult>;
    if (structured !== undefined && structured !== null) {
      result = validateExtractionResult(structured);
      if (result === null) {
        appendError(
          paths,
          `worker: 抽出結果が不正なため破棄: ${JSON.stringify(structured)}`,
        );
        return;
      }
    } else {
      const resultText = w["result"];
      if (typeof resultText !== "string") {
        appendError(paths, "worker: claude 出力に result 文字列が無い");
        return;
      }
      result = parseExtractionResult(resultText);
      if (result === null) {
        appendError(
          paths,
          `worker: 抽出結果が不正なため破棄: ${JSON.stringify(resultText)}`,
        );
        return;
      }
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
