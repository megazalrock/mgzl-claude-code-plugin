import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  collectConflictingExpectations,
  renderGeneratedBlock,
  replaceGeneratedBlock,
} from "./generate-prh-ignore-rules.ts";

const PRH_YML_PATH = fileURLToPath(new URL("../rules/prh.yml", import.meta.url));

describe("衝突ルールの収集", () => {
  test("漢数字を要求する 3 ルールだけが衝突する", async () => {
    expect(await collectConflictingExpectations()).toEqual(["一つ一つ", "もう一つ", "一つは"]);
  }, 60_000);

  test("jtf 側の除外語である「ただ一つ」は衝突しない", async () => {
    expect(await collectConflictingExpectations()).not.toContain("ただ一つ");
  }, 60_000);
});

describe("prh.yml の書き換え", () => {
  test("自動生成区間の外は書き換えない", () => {
    const yaml = readFileSync(PRH_YML_PATH, "utf8");
    const replaced = replaceGeneratedBlock(yaml, renderGeneratedBlock(["ダミー"]));
    expect(replaced).toContain("- expected: 基づ$1");
    expect(replaced).toContain("- expected: もと$1");
    expect(replaced).toContain("pattern: /基([^数準盤板底礎本づ])/");
    expect(replaced).toContain("- expected: ダミー");
    expect(replaced).not.toContain("- expected: 一つは");
  });

  test("マーカーが無い場合は失敗する", () => {
    expect(() => replaceGeneratedBlock("version: 1\n", renderGeneratedBlock([]))).toThrow();
  });
});

describe("生成結果の反映", () => {
  test("prh.yml が再生成後の内容と一致する", async () => {
    const yaml = readFileSync(PRH_YML_PATH, "utf8");
    const expectations = await collectConflictingExpectations();
    expect(replaceGeneratedBlock(yaml, renderGeneratedBlock(expectations))).toBe(yaml);
  }, 60_000);
});
