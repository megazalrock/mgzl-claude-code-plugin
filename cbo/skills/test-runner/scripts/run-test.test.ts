import { describe, expect, it } from "bun:test";
import { buildVitestArgs, coverageDirPrefix, extractCoverageTable, isRootLikePath, parseArgs } from "./run-test";

describe("parseArgs", () => {
  it("--coverage が先頭でもテストパスを取り出す", () => {
    expect(parseArgs(["--coverage", "pages/foo.test.ts"])).toStrictEqual({
      testPaths: ["pages/foo.test.ts"],
      coverage: true,
    });
  });

  it("--coverage が末尾でもテストパスを取り出す", () => {
    expect(parseArgs(["pages/foo.test.ts", "--coverage"])).toStrictEqual({
      testPaths: ["pages/foo.test.ts"],
      coverage: true,
    });
  });

  it("--coverage が無ければ coverage は false", () => {
    expect(parseArgs(["pages/foo.test.ts"])).toStrictEqual({
      testPaths: ["pages/foo.test.ts"],
      coverage: false,
    });
  });

  it("複数のテストパスを指定順のまま全て取り出す", () => {
    expect(parseArgs(["pages/foo.test.ts", "pages/bar/", "composables/baz.test.ts"])).toStrictEqual({
      testPaths: ["pages/foo.test.ts", "pages/bar/", "composables/baz.test.ts"],
      coverage: false,
    });
  });

  it("--coverage がテストパスの間にあっても全てのテストパスを取り出す", () => {
    expect(parseArgs(["pages/foo.test.ts", "--coverage", "pages/bar/"])).toStrictEqual({
      testPaths: ["pages/foo.test.ts", "pages/bar/"],
      coverage: true,
    });
  });

  it("引数が無ければ testPaths は空", () => {
    expect(parseArgs([])).toStrictEqual({ testPaths: [], coverage: false });
  });

  it("--coverage だけなら testPaths は空", () => {
    expect(parseArgs(["--coverage"])).toStrictEqual({ testPaths: [], coverage: true });
  });
});

describe("isRootLikePath", () => {
  it("カレントディレクトリ相当のパスは true", () => {
    expect(isRootLikePath(".", "/proj")).toBe(true);
    expect(isRootLikePath("./", "/proj")).toBe(true);
    expect(isRootLikePath("/proj", "/proj")).toBe(true);
  });

  it("上位ディレクトリは true", () => {
    expect(isRootLikePath("..", "/proj")).toBe(true);
    expect(isRootLikePath("/", "/proj")).toBe(true);
  });

  it("配下のディレクトリ・ファイルは false", () => {
    expect(isRootLikePath("pages/", "/proj")).toBe(false);
    expect(isRootLikePath("pages/foo.test.ts", "/proj")).toBe(false);
    expect(isRootLikePath("/proj/pages", "/proj")).toBe(false);
  });
});

describe("buildVitestArgs", () => {
  it("カバレッジ無しの引数を組み立てる", () => {
    expect(buildVitestArgs(["pages/foo.test.ts"], null)).toStrictEqual([
      "vitest",
      "run",
      "--no-color",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "pages/foo.test.ts",
    ]);
  });

  it("カバレッジ有りなら text と json-summary を指定ディレクトリへ出力する引数を組み立てる", () => {
    expect(buildVitestArgs(["pages/foo.test.ts"], "/tmp/cov")).toStrictEqual([
      "vitest",
      "run",
      "--no-color",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "--coverage",
      "--coverage.reporter=text",
      "--coverage.reporter=json-summary",
      "--coverage.reportsDirectory=/tmp/cov",
      "pages/foo.test.ts",
    ]);
  });

  it("複数のテストパスを全て末尾に並べる", () => {
    expect(buildVitestArgs(["pages/foo.test.ts", "pages/bar/"], "/tmp/cov")).toStrictEqual([
      "vitest",
      "run",
      "--no-color",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "--coverage",
      "--coverage.reporter=text",
      "--coverage.reporter=json-summary",
      "--coverage.reportsDirectory=/tmp/cov",
      "pages/foo.test.ts",
      "pages/bar/",
    ]);
  });
});

describe("coverageDirPrefix", () => {
  it("一時ディレクトリ配下に UTC 時刻入りのプレフィックスを作る", () => {
    expect(coverageDirPrefix("/var/tmp", new Date("2026-10-02T03:04:05.678Z"))).toBe(
      "/var/tmp/test-runner-coverage-20261002T030405Z-",
    );
  });
});

describe("extractCoverageTable", () => {
  const table = [
    " % Coverage report from v8",
    "----------|---------|----------|---------|---------|-------------------",
    "File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s ",
    "----------|---------|----------|---------|---------|-------------------",
    "All files |     100 |      100 |     100 |     100 |                   ",
    " foo.ts   |     100 |      100 |     100 |     100 |                   ",
    "----------|---------|----------|---------|---------|-------------------",
  ];

  it("前後の出力を除いてカバレッジ表だけを切り出す", () => {
    const output = [" Test Files  1 passed (1)", "", ...table, "ERROR: Coverage for lines (50%) does not meet threshold", ""].join("\n");

    expect(extractCoverageTable(output)).toBe(`${table.join("\n")}\n`);
  });

  it("CRLF 改行でも切り出せる", () => {
    expect(extractCoverageTable(table.join("\r\n"))).toBe(`${table.join("\n")}\n`);
  });

  it("表の見出し行が無ければ null", () => {
    expect(extractCoverageTable(" Test Files  1 passed (1)\n")).toBeNull();
  });

  it("表が途中で途切れていれば出力の末尾までを返す", () => {
    expect(extractCoverageTable(table.slice(0, 5).join("\n"))).toBe(`${table.slice(0, 5).join("\n")}\n`);
  });
});
