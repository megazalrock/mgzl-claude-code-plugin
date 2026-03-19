#!/usr/bin/env bun
import { $ } from "bun";

const testPath = process.argv[2];

if (!testPath) {
  console.error("エラー: テスト対象のファイルパスを指定してください。");
  console.error("");
  console.error(`使用方法: bun ${process.argv[1]} <ファイルパス>`);
  console.error("例: bun run-test.ts composables/utils/UseDate.test.ts");
  console.error("例: bun run-test.ts pages/schedules/");
  console.error("");
  console.error("※ ファイルパスを指定せずに全テストを実行すると非常に時間がかかります。");
  process.exit(1);
}

const testCommand = process.env.TEST_COMMAND ?? "pnpm exec vitest run";
const [cmd, ...args] = testCommand.split(" ");

const proc = Bun.spawn([cmd, ...args, testPath], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
});

const exitCode = await proc.exited;
process.exit(exitCode);
