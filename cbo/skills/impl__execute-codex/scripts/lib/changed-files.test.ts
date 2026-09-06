import { describe, expect, it } from "bun:test";
import { diffChangedFiles, parsePorcelain } from "./changed-files";

describe("parsePorcelain", () => {
  it("2 文字のステータスと空白を除いたパスの集合を返す", () => {
    const output = [" M src/a.ts", "?? src/new.ts", "A  src/added.ts"].join("\n");

    const files = parsePorcelain(output);

    expect(files).toStrictEqual(new Set(["src/a.ts", "src/new.ts", "src/added.ts"]));
  });

  it("リネーム行は矢印の右側のパスを使う", () => {
    const output = "R  src/old.ts -> src/renamed.ts";

    const files = parsePorcelain(output);

    expect(files).toStrictEqual(new Set(["src/renamed.ts"]));
  });

  it("空出力は空集合になる", () => {
    expect(parsePorcelain("")).toStrictEqual(new Set());
  });
});

describe("diffChangedFiles", () => {
  it("after にだけ含まれるパスをソート済み配列で返す", () => {
    const before = new Set(["src/pre.ts"]);
    const after = new Set(["src/pre.ts", "src/z.ts", "src/a.ts"]);

    const changed = diffChangedFiles({ before, after });

    expect(changed).toStrictEqual(["src/a.ts", "src/z.ts"]);
  });

  it("実行前から変更済みだったファイルは含めない", () => {
    const before = new Set(["src/pre.ts"]);
    const after = new Set(["src/pre.ts"]);

    expect(diffChangedFiles({ before, after })).toStrictEqual([]);
  });
});
