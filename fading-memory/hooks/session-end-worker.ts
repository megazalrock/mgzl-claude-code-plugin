import { readFileSync } from "node:fs";
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
import { extractTranscriptText, sessionIdFromTranscriptPath } from "./lib/transcript.ts";

// 前処理でプロンプトが有限長になったため実行時間は短いが、モデル側の停止不能に備えて残す
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

/** 1 回の抽出実行の結果。session-end.log へ 1 行の JSON として記録する */
interface RunLog {
  /** 1 つの root を複数プロジェクトが共有しうるため、行ごとに発信元の cwd を残す */
  projectDir: string;
  sessionId: string;
  transcript_bytes: number;
  extracted_bytes: number;
  omitted_messages: number;
  duration_ms: number;
  exit_code: number | null;
  memories_saved: number;
}

async function main(): Promise<void> {
  const projectDir = process.argv[2];
  const transcriptPath = process.argv[3];
  if (projectDir === undefined || transcriptPath === undefined) {
    console.error("usage: session-end-worker.ts <projectDir> <transcriptPath>");
    process.exit(1);
  }

  const paths = dataPaths(projectDir);
  const startedAt = Date.now();
  const log: RunLog = {
    projectDir: paths.projectDir,
    sessionId: sessionIdFromTranscriptPath(transcriptPath),
    transcript_bytes: 0,
    extracted_bytes: 0,
    omitted_messages: 0,
    duration_ms: 0,
    exit_code: null,
    memories_saved: 0,
  };
  const emitLog = (): void => {
    log.duration_ms = Date.now() - startedAt;
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...log }));
  };

  try {
    ensureDirs(paths);
    const { memories } = loadMemories(paths);
    const catalog = memories.map((m) => `- ${m.slug}: ${m.meta.title}`).join("\n");

    // 子プロセスに JSONL を読ませると数 MB のページング読み取りでタイムアウトするため、
    // ここで会話本文だけを抜き出してプロンプトに埋め込む
    const jsonl = readFileSync(transcriptPath, "utf8");
    log.transcript_bytes = Buffer.byteLength(jsonl, "utf8");
    const extracted = extractTranscriptText(jsonl);
    log.extracted_bytes = extracted.extractedBytes;
    log.omitted_messages = extracted.omittedMessages;
    const prompt = buildExtractionPrompt(extracted.text, catalog);

    const proc = Bun.spawn({
      cmd: [
        "claude",
        // プロンプトは argv 長の上限を超えうるため stdin から渡す
        "-p",
        "--model",
        config.headlessModel,
        "--output-format",
        "json",
        // ユーザーの CLAUDE.md の人格設定やプラグインが出力へ混入するのを防ぐ
        "--safe-mode",
        // 会話本文を渡すのでツールは不要。拒否時の謝罪文混入と埋め込み指示の実行を防ぐ
        "--tools",
        "",
        "--permission-prompts",
        "none",
        // 出力を構造化し、散文の混入を CLI 側で排除する
        "--json-schema",
        JSON.stringify(EXTRACTION_JSON_SCHEMA),
      ],
      cwd: projectDir,
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(prompt);
    await proc.stdin.end();
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
    log.exit_code = exitCode;

    if (exitCode !== 0) {
      appendError(paths, `worker: claude が exit ${exitCode}: ${stderr.slice(0, 500)}`);
      emitLog();
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
        emitLog();
        return;
      }
    } else {
      const resultText = w["result"];
      if (typeof resultText !== "string") {
        appendError(paths, "worker: claude 出力に result 文字列が無い");
        emitLog();
        return;
      }
      result = parseExtractionResult(resultText);
      if (result === null) {
        appendError(
          paths,
          `worker: 抽出結果が不正なため破棄: ${JSON.stringify(resultText)}`,
        );
        emitLog();
        return;
      }
    }

    const report = applyExtraction(paths, result, new Date().toISOString());
    log.memories_saved = report.created.length + report.updated.length;
    emitLog();
  } catch (e) {
    try {
      appendError(paths, `worker: ${String(e)}`);
      emitLog();
    } catch {
      // ログ書き込みすら失敗した場合は諦める
    }
  }
}

await main();
