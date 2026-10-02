#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** コマンドライン引数を、テストパス（複数可、指定順を保持）と --coverage フラグの有無に分解する */
export function parseArgs(argv: string[]): { testPaths: string[]; coverage: boolean } {
  const coverage = argv.includes("--coverage");
  const testPaths = argv.filter((arg) => arg !== "--coverage");

  return { testPaths, coverage };
}

/** テストパスがプロジェクトルート相当（cwd 自身、または cwd の祖先）を指しているか */
export function isRootLikePath(testPath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, testPath);

  if (resolved === cwd) {
    return true;
  }

  const prefix = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;

  return cwd.startsWith(prefix);
}

/**
 * vitest の実行引数を組み立てる。
 * coverageDir を渡した場合のみカバレッジを取得し、レポートをそのディレクトリへ出力する。
 */
export function buildVitestArgs(testPaths: string[], coverageDir: string | null): string[] {
  // 対象リポジトリの vitest.config は html/json レポーターと clean: true を指定しているため、
  // 上書きしないとカバレッジ取得のたびにプロジェクトの coverage/ が消去・再生成されてしまう。
  // reportsDirectory を実行ごとの専用ディレクトリへ逃がし、reporter も必要な2つに絞る。
  // text は Bash ツール経由（非 TTY）だと 80 列に詰められパスが先頭から省略されるため、
  // フルパスをキーに持つ json-summary を併せて出す。
  // clean は専用ディレクトリが毎回新規なので消されても困らず、上書きしない。
  const coverageArgs =
    coverageDir === null
      ? []
      : [
          "--coverage",
          "--coverage.reporter=text",
          "--coverage.reporter=json-summary",
          `--coverage.reportsDirectory=${coverageDir}`,
        ];

  // 出力は Claude が読み、カバレッジ表は coverage.txt にも保存するため、色付けの制御文字を出させない。
  // --no-color は vitest 本体だけでなく istanbul の text レポーター（supports-color）も無色にする。
  return ["vitest", "run", "--no-color", "--reporter", "dot", "--maxWorkers", "6", ...coverageArgs, ...testPaths];
}

/** カバレッジ出力先ディレクトリの mkdtemp 用プレフィックス。時刻入りにして実行順に並ぶようにする */
export function coverageDirPrefix(tmpRoot: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  return path.join(tmpRoot, `test-runner-coverage-${timestamp}-`);
}

/** istanbul の text レポーターが表の上下と見出し下に出す区切り行（例: `-----|-----|...`） */
const TABLE_SEPARATOR = /^-+(\|-+)+$/;

/**
 * vitest の標準出力をカバレッジ表（`% Coverage report from ...` 行から表の末尾まで）とそれ以外に分ける。
 * 表は全ファイル分の行を含みセッションに流すと長大になるため、表はファイル保存用、rest は画面表示用に使う。
 * 表は区切り行・見出し・区切り行・各行・区切り行の順に出力されるので、3本目の区切り行を末尾とみなす。
 * 見出し行が無ければ table は null で rest は出力そのまま、表が途中で途切れていれば出力の末尾までを表とする。
 */
export function splitCoverageTable(output: string): { table: string | null; rest: string } {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("Coverage report from "));

  if (start === -1) {
    return { table: null, rest: output };
  }

  let separatorCount = 0;
  let end = lines.length;

  for (let i = start + 1; i < lines.length; i++) {
    if (TABLE_SEPARATOR.test(lines[i]?.trim() ?? "")) {
      separatorCount++;

      if (separatorCount === 3) {
        end = i + 1;
        break;
      }
    }
  }

  const tableLines = lines.slice(start, end);

  // 途切れた場合、出力末尾の改行で生じる空行を落とす
  while (tableLines.length > 0 && tableLines[tableLines.length - 1] === "") {
    tableLines.pop();
  }

  return {
    table: `${tableLines.join("\n")}\n`,
    rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n"),
  };
}

/** istanbul は計測対象が0件の指標の pct を数値ではなく "Unknown" にするため、文字列も受け付ける */
type CoveragePct = number | string;

type CoverageTotal = {
  statements: CoveragePct;
  branches: CoveragePct;
  functions: CoveragePct;
  lines: CoveragePct;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pctOf(metric: unknown): CoveragePct | null {
  if (!isRecord(metric)) {
    return null;
  }

  const { pct } = metric;

  return typeof pct === "number" || typeof pct === "string" ? pct : null;
}

/** coverage-summary.json（json-summary レポーター）の内容から total の4指標の pct を取り出す。形式が想定外なら null */
export function parseCoverageTotal(summary: unknown): CoverageTotal | null {
  if (!isRecord(summary) || !isRecord(summary.total)) {
    return null;
  }

  const { total } = summary;
  const statements = pctOf(total.statements);
  const branches = pctOf(total.branches);
  const functions = pctOf(total.functions);
  const lines = pctOf(total.lines);

  if (statements === null || branches === null || functions === null || lines === null) {
    return null;
  }

  return { statements, branches, functions, lines };
}

function formatPct(pct: CoveragePct): string {
  return typeof pct === "number" ? `${pct}%` : pct;
}

/** total の4指標を1行にまとめる */
export function formatCoverageTotal(total: CoverageTotal): string {
  return `カバレッジ合計: Stmts ${formatPct(total.statements)} / Branches ${formatPct(total.branches)} / Funcs ${formatPct(total.functions)} / Lines ${formatPct(total.lines)}`;
}

/** coverage-summary.json を読んで合計行を作る。ファイルの欠落・読み取り失敗・想定外の形式ではその旨の1行を返す */
function readCoverageTotalLine(summaryPath: string): string {
  if (!existsSync(summaryPath)) {
    return "カバレッジ合計: （coverage-summary.json が生成されなかったため不明）";
  }

  let summary: unknown;

  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch {
    return "カバレッジ合計: （coverage-summary.json を読み取れなかったため不明）";
  }

  const total = parseCoverageTotal(summary);

  return total === null ? "カバレッジ合計: （coverage-summary.json に total が見つからなかったため不明）" : formatCoverageTotal(total);
}

if (import.meta.main) {
  const { testPaths, coverage } = parseArgs(process.argv.slice(2));

  if (testPaths.length === 0) {
    console.error("エラー: テスト対象のファイルパスを指定してください。");
    console.error("");
    console.error(`使用方法: bun run ${process.argv[1]} <ファイルパス...> [--coverage]`);
    console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts");
    console.error("例: bun run run-test.ts pages/schedules/");
    console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts pages/schedules/");
    console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts --coverage");
    console.error("");
    console.error("※ ファイルパスを指定せずに全テストを実行すると非常に時間がかかります。");
    process.exit(1);
  }

  if (coverage && testPaths.some((p) => isRootLikePath(p, process.cwd()))) {
    console.error(
      "エラー: プロジェクトルート相当のパスに対するカバレッジ取得は禁止されています。ファイルまたは末端のディレクトリを指定してください。",
    );
    process.exit(1);
  }

  if (!coverage) {
    const proc = Bun.spawn(buildVitestArgs(testPaths, null), {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env },
    });

    process.exit(await proc.exited);
  }

  // os.tmpdir() は $TMPDIR を優先し、未設定時は OS 既定の一時ディレクトリを返す
  const coverageDir = mkdtempSync(coverageDirPrefix(os.tmpdir(), new Date()));
  const proc = Bun.spawn(buildVitestArgs(testPaths, coverageDir), {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env },
  });

  // 表を除いて出すため、ストリームで流さず終了まで蓄積する
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const { table, rest } = splitCoverageTable(output);
  const tablePath = path.join(coverageDir, "coverage.txt");

  if (table !== null) {
    writeFileSync(tablePath, table);
  }

  process.stdout.write(rest);
  console.log("");
  const summaryPath = path.join(coverageDir, "coverage-summary.json");
  console.log(readCoverageTotalLine(summaryPath));
  console.log(`カバレッジ表: ${table === null ? "（出力に表が見つからなかったため未保存）" : tablePath}`);
  console.log(`カバレッジ JSON: ${existsSync(summaryPath) ? summaryPath : "（vitest が生成しなかったため無し）"}`);

  process.exit(exitCode);
}
