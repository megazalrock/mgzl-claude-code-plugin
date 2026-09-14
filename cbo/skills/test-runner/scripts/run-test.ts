#!/usr/bin/env bun

import path from "node:path";

/** コマンドライン引数を、テストパスと --coverage フラグの有無に分解する */
export function parseArgs(argv: string[]): { testPath: string | undefined; coverage: boolean } {
  const coverage = argv.includes("--coverage");
  const rest = argv.filter((arg) => arg !== "--coverage");

  return { testPath: rest[0], coverage };
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

/** vitest の実行引数を組み立てる */
export function buildVitestArgs(testPath: string, coverage: boolean): string[] {
  // 対象リポジトリの vitest.config は html/json レポーターと clean: true を指定しているため、
  // 上書きしないとカバレッジ取得のたびにプロジェクトの coverage/ が消去・再生成されてしまう。
  // このスキルは標準出力のテキスト表だけを必要とするので、reporter を text に、clean を false に固定する。
  const coverageArgs = coverage
    ? ["--coverage", "--coverage.reporter=text", "--coverage.clean=false"]
    : [];

  return ["vitest", "run", "--reporter", "dot", "--maxWorkers", "6", ...coverageArgs, testPath];
}

if (import.meta.main) {
  const { testPath, coverage } = parseArgs(process.argv.slice(2));

  if (!testPath) {
    console.error("エラー: テスト対象のファイルパスを指定してください。");
    console.error("");
    console.error(`使用方法: bun run ${process.argv[1]} <ファイルパス> [--coverage]`);
    console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts");
    console.error("例: bun run run-test.ts pages/schedules/");
    console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts --coverage");
    console.error("");
    console.error("※ ファイルパスを指定せずに全テストを実行すると非常に時間がかかります。");
    process.exit(1);
  }

  if (coverage && isRootLikePath(testPath, process.cwd())) {
    console.error(
      "エラー: プロジェクトルート相当のパスに対するカバレッジ取得は禁止されています。ファイルまたは末端のディレクトリを指定してください。",
    );
    process.exit(1);
  }

  const proc = Bun.spawn(buildVitestArgs(testPath, coverage), {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}
