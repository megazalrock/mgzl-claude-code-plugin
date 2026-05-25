#!/usr/bin/env bun

const testPath = process.argv[2];

if (!testPath) {
  console.error("エラー: テスト対象のファイルパスを指定してください。");
  console.error("");
  console.error(`使用方法: bun run ${process.argv[1]} <ファイルパス>`);
  console.error("例: bun run run-test.ts composables/utils/UseDate.test.ts");
  console.error("例: bun run run-test.ts pages/schedules/");
  console.error("");
  console.error("※ ファイルパスを指定せずに全テストを実行すると非常に時間がかかります。");
  process.exit(1);
}

const testCommand = ["vitest", "run", "--reporter", "dot", "--maxWorkers", "6"];

const proc = Bun.spawn([...testCommand, testPath], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});

const exitCode = await proc.exited;
process.exit(exitCode);
