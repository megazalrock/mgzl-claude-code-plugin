import { describe, expect, it } from "bun:test";
import {
  buildVitestArgs,
  coverageDirPrefix,
  formatCoverageTotal,
  isRootLikePath,
  parseArgs,
  parseCoverageTotal,
  splitCoverageTable,
} from "./run-test";

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

describe("splitCoverageTable", () => {
  const table = [
    " % Coverage report from v8",
    "----------|---------|----------|---------|---------|-------------------",
    "File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s ",
    "----------|---------|----------|---------|---------|-------------------",
    "All files |     100 |      100 |     100 |     100 |                   ",
    " foo.ts   |     100 |      100 |     100 |     100 |                   ",
    "----------|---------|----------|---------|---------|-------------------",
  ];

  it("カバレッジ表を切り出し、表を除いた前後の出力を rest として返す", () => {
    const output = [" Test Files  1 passed (1)", "", ...table, "ERROR: Coverage for lines (50%) does not meet threshold", ""].join("\n");

    expect(splitCoverageTable(output)).toStrictEqual({
      table: `${table.join("\n")}\n`,
      rest: [" Test Files  1 passed (1)", "", "ERROR: Coverage for lines (50%) does not meet threshold", ""].join("\n"),
    });
  });

  it("CRLF 改行でも切り出せる", () => {
    expect(splitCoverageTable(["before", ...table, "after"].join("\r\n"))).toStrictEqual({
      table: `${table.join("\n")}\n`,
      rest: "before\nafter",
    });
  });

  it("表の見出し行が無ければ table は null で、出力全体を rest として返す", () => {
    expect(splitCoverageTable(" Test Files  1 passed (1)\n")).toStrictEqual({
      table: null,
      rest: " Test Files  1 passed (1)\n",
    });
  });

  it("表が途中で途切れていれば出力の末尾までを表とし、rest は表より前だけになる", () => {
    expect(splitCoverageTable(["before", ...table.slice(0, 5), ""].join("\n"))).toStrictEqual({
      table: `${table.slice(0, 5).join("\n")}\n`,
      rest: "before",
    });
  });
});

describe("parseCoverageTotal", () => {
  const metric = (pct: number | string) => ({ total: 10, covered: 5, skipped: 0, pct });
  const total = {
    statements: metric(27.86),
    branches: metric(5.31),
    functions: metric(8.85),
    lines: metric(28.61),
  };

  it("json-summary の total から4指標の pct を取り出す", () => {
    expect(parseCoverageTotal({ total, "/proj/foo.ts": total })).toStrictEqual({
      statements: 27.86,
      branches: 5.31,
      functions: 8.85,
      lines: 28.61,
    });
  });

  it("計測対象が無いとき istanbul が出す文字列の pct（Unknown）もそのまま取り出す", () => {
    expect(parseCoverageTotal({ total: { ...total, branches: metric("Unknown") } })).toStrictEqual({
      statements: 27.86,
      branches: "Unknown",
      functions: 8.85,
      lines: 28.61,
    });
  });

  it("total が無ければ null", () => {
    expect(parseCoverageTotal({ "/proj/foo.ts": total })).toBeNull();
  });

  it("指標が欠けていれば null", () => {
    expect(parseCoverageTotal({ total: { statements: metric(1), branches: metric(1), functions: metric(1) } })).toBeNull();
  });

  it("pct が数値でも文字列でもなければ null", () => {
    expect(parseCoverageTotal({ total: { ...total, lines: { pct: null } } })).toBeNull();
  });

  it("オブジェクトでなければ null", () => {
    expect(parseCoverageTotal(null)).toBeNull();
    expect(parseCoverageTotal([])).toBeNull();
    expect(parseCoverageTotal("total")).toBeNull();
  });
});

describe("formatCoverageTotal", () => {
  it("4指標を1行にまとめる", () => {
    expect(formatCoverageTotal({ statements: 27.86, branches: 5.31, functions: 8.85, lines: 28.61 })).toBe(
      "カバレッジ合計: Stmts 27.86% / Branches 5.31% / Funcs 8.85% / Lines 28.61%",
    );
  });

  it("文字列の pct には % を付けない", () => {
    expect(formatCoverageTotal({ statements: 100, branches: "Unknown", functions: 0, lines: 100 })).toBe(
      "カバレッジ合計: Stmts 100% / Branches Unknown / Funcs 0% / Lines 100%",
    );
  });
});
