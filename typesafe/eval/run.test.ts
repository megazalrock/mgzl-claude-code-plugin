import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildReport, type EvalRow, type GoldenCase, parseArgs } from "./run.ts";

const ROWS: EvalRow[] = [
  {
    request: "今の変更をコミットして",
    expected: "mgzl:commiting-to-git",
    winner: "mgzl:commiting-to-git",
    gateMean: 0.82,
    maxFits: 0.91,
  },
  {
    request: "このプロジェクトの AutoMemory を棚卸しして",
    expected: "mgzl:audit-memory",
    winner: "fading-memory:maintain",
    gateMean: 0.71,
    maxFits: 0.55,
  },
  {
    request: "モナドとは何ですか",
    expected: null,
    winner: null,
    gateMean: 0.12,
    maxFits: 0,
  },
  {
    request: "Slack のチャンネルにこの結果を投稿して",
    expected: null,
    winner: "mgzl:create-issue",
    gateMean: 0.64,
    maxFits: 0.41,
  },
];

describe("buildReport", () => {
  test("件数と 2 つの誤り率を key=value で出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain("total=4");
    expect(report).toContain("with_skill=2");
    expect(report).toContain("without_skill=2");
    expect(report).toContain("wrong_suggestion_rate=0.500");
    expect(report).toContain("unneeded_suggestion_rate=0.500");
  });

  test("勝者の fits を 0.1 刻みの帯にして件数と正解率を出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain("band=0.4-0.5 count=1 accuracy=0.000");
    expect(report).toContain("band=0.5-0.6 count=1 accuracy=0.000");
    expect(report).toContain("band=0.9-1.0 count=1 accuracy=1.000");
    expect(report).not.toContain("band=0.0-0.1");
  });

  test("不一致ケースを一覧で出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain(
      'mismatch request="このプロジェクトの AutoMemory を棚卸しして" expected=mgzl:audit-memory winner=fading-memory:maintain gate=0.71 fits=0.55',
    );
    expect(report).toContain(
      'mismatch request="Slack のチャンネルにこの結果を投稿して" expected=null winner=mgzl:create-issue gate=0.64 fits=0.41',
    );
  });

  test("該当ありで何も提案しなかった場合も誤りとして数える", () => {
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        gateMean: 0.2,
        maxFits: 0,
      },
    ]);
    expect(report).toContain("wrong_suggestion_rate=1.000");
    expect(report).toContain('mismatch request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.20 fits=0.00');
  });

  test("request は先頭 60 文字に切り詰める", () => {
    const long = "あ".repeat(80);
    const report = buildReport([
      { request: long, expected: "mgzl:commiting-to-git", winner: null, gateMean: 0.2, maxFits: 0 },
    ]);
    expect(report).toContain(`mismatch request="${"あ".repeat(60)}"`);
    expect(report).not.toContain("あ".repeat(61));
  });

  test("該当なしで例外になった場合は不一致に出るが unneeded_suggestion_rate には含めない", () => {
    const report = buildReport([
      {
        request: "Slack のチャンネルにこの結果を投稿して",
        expected: null,
        winner: null,
        gateMean: 0,
        maxFits: 0,
        error: "Jev did not answer the 'which' choice question (call 1)",
      },
    ]);
    expect(report).toContain("errors=1");
    expect(report).toContain("unneeded_suggestion_rate=0.000");
    expect(report).toContain(
      'mismatch request="Slack のチャンネルにこの結果を投稿して" expected=null winner=null gate=0.00 fits=0.00 error="Jev did not answer the \'which\' choice question (call 1)"',
    );
  });

  test("該当ありで例外になった場合は wrong_suggestion_rate に含まれ不一致に 1 回だけ出る", () => {
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        gateMean: 0,
        maxFits: 0,
        error: "roster is empty",
      },
    ]);
    expect(report).toContain("errors=1");
    expect(report).toContain("wrong_suggestion_rate=1.000");
    const mismatchCount = report
      .split("\n")
      .filter((line) => line.startsWith("mismatch")).length;
    expect(mismatchCount).toBe(1);
    expect(report).toContain(
      'mismatch request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.00 fits=0.00 error="roster is empty"',
    );
  });
});

describe("parseArgs", () => {
  test("--cwd を必須にし、golden と concurrency に既定値を入れる", () => {
    const args = parseArgs(["--cwd", "/Users/otto/workspace/mgzl-claude-code-plugin"]);
    expect(args.cwd).toBe("/Users/otto/workspace/mgzl-claude-code-plugin");
    expect(args.golden).toBe(join(import.meta.dir, "golden.json"));
    expect(args.concurrency).toBe(4);
  });

  test("--golden と --concurrency を受け取る", () => {
    const args = parseArgs(["--cwd", "/x", "--golden", "/y/g.json", "--concurrency", "8"]);
    expect(args.golden).toBe("/y/g.json");
    expect(args.concurrency).toBe(8);
  });

  test("--cwd が無ければ例外にする", () => {
    expect(() => parseArgs([])).toThrow("--cwd is required");
  });

  test("--concurrency が数値でなければ例外にする", () => {
    expect(() => parseArgs(["--cwd", "/x", "--concurrency", "abc"])).toThrow(
      "--concurrency must be a number, got 'abc'",
    );
  });
});

describe("golden.json", () => {
  test("30 件で、該当あり 20 件・該当なし 10 件", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    expect(Array.isArray(parsed)).toBe(true);
    const cases: GoldenCase[] = Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "object" &&
          item !== null &&
          "request" in item &&
          typeof item.request === "string" &&
          "expected" in item &&
          (typeof item.expected === "string" || item.expected === null)
            ? [{ request: item.request, expected: item.expected }]
            : [],
        )
      : [];
    expect(cases).toHaveLength(30);
    expect(cases.filter((c) => c.expected !== null)).toHaveLength(20);
    expect(cases.filter((c) => c.expected === null)).toHaveLength(10);
  });
});
