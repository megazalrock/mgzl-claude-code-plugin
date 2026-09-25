import { describe, expect, it } from "bun:test";
import { buildVitestArgs, isRootLikePath, parseArgs } from "./run-test";

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
    expect(buildVitestArgs(["pages/foo.test.ts"], false)).toStrictEqual([
      "vitest",
      "run",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "pages/foo.test.ts",
    ]);
  });

  it("カバレッジ有りの引数を組み立てる", () => {
    expect(buildVitestArgs(["pages/foo.test.ts"], true)).toStrictEqual([
      "vitest",
      "run",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "--coverage",
      "--coverage.reporter=text",
      "--coverage.clean=false",
      "pages/foo.test.ts",
    ]);
  });

  it("複数のテストパスを全て末尾に並べる", () => {
    expect(buildVitestArgs(["pages/foo.test.ts", "pages/bar/"], true)).toStrictEqual([
      "vitest",
      "run",
      "--reporter",
      "dot",
      "--maxWorkers",
      "6",
      "--coverage",
      "--coverage.reporter=text",
      "--coverage.clean=false",
      "pages/foo.test.ts",
      "pages/bar/",
    ]);
  });
});
