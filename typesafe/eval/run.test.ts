import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT_FRAMING, TOOL_FRAMING } from "../hooks/lib/pipeline.ts";
import { buildReport, type EvalRow, framingFor, parseArgs, readGolden } from "./run.ts";

const ROWS: EvalRow[] = [
  {
    request: "今の変更をコミットして",
    expected: "mgzl:commiting-to-git",
    winner: "mgzl:commiting-to-git",
    event: "UserPromptSubmit",
    gateMean: 0.82,
    maxFits: 0.91,
  },
  {
    request: "このプロジェクトの AutoMemory を棚卸しして",
    expected: "mgzl:audit-memory",
    winner: "fading-memory:maintain",
    event: "UserPromptSubmit",
    gateMean: 0.71,
    maxFits: 0.55,
  },
  {
    request: "モナドとは何ですか",
    expected: null,
    winner: null,
    event: "UserPromptSubmit",
    gateMean: 0.12,
    maxFits: 0,
  },
  {
    request: "Slack のチャンネルにこの結果を投稿して",
    expected: null,
    winner: "mgzl:create-issue",
    event: "UserPromptSubmit",
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
      'mismatch event=UserPromptSubmit request="このプロジェクトの AutoMemory を棚卸しして" expected=mgzl:audit-memory winner=fading-memory:maintain gate=0.71 fits=0.55',
    );
    expect(report).toContain(
      'mismatch event=UserPromptSubmit request="Slack のチャンネルにこの結果を投稿して" expected=null winner=mgzl:create-issue gate=0.64 fits=0.41',
    );
  });

  test("該当ありで何も提案しなかった場合も誤りとして数える", () => {
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        event: "UserPromptSubmit",
        gateMean: 0.2,
        maxFits: 0,
      },
    ]);
    expect(report).toContain("wrong_suggestion_rate=1.000");
    expect(report).toContain('mismatch event=UserPromptSubmit request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.20 fits=0.00');
  });

  test("request は先頭 60 文字に切り詰める", () => {
    const long = "あ".repeat(80);
    const report = buildReport([
      {
        request: long,
        expected: "mgzl:commiting-to-git",
        winner: null,
        event: "UserPromptSubmit",
        gateMean: 0.2,
        maxFits: 0,
      },
    ]);
    expect(report).toContain(`mismatch event=UserPromptSubmit request="${"あ".repeat(60)}"`);
    expect(report).not.toContain("あ".repeat(61));
  });

  test("該当なしで例外になった場合は不一致に出るが unneeded_suggestion_rate の分母(without_skillのうち例外を除いたもの)には含めない", () => {
    const report = buildReport([
      {
        request: "Slack のチャンネルにこの結果を投稿して",
        expected: null,
        winner: null,
        event: "UserPromptSubmit",
        gateMean: 0,
        maxFits: 0,
        error: "Jev did not answer the 'which' choice question (call 1)",
      },
    ]);
    expect(report).toContain("errors=1");
    expect(report).toContain("unneeded_suggestion_rate=0.000");
    expect(report).toContain(
      'mismatch event=UserPromptSubmit request="Slack のチャンネルにこの結果を投稿して" expected=null winner=null gate=0.00 fits=0.00 error="Jev did not answer the \'which\' choice question (call 1)"',
    );
  });

  test("該当ありで例外になった場合は wrong_suggestion_rate の分母(with_skillのうち例外を除いたもの)から除外され、不一致に 1 回だけ出る", () => {
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        event: "UserPromptSubmit",
        gateMean: 0,
        maxFits: 0,
        error: "roster is empty",
      },
    ]);
    expect(report).toContain("with_skill=1");
    expect(report).toContain("errors=1");
    expect(report).toContain("wrong_suggestion_rate=0.000");
    const mismatchCount = report
      .split("\n")
      .filter((line) => line.startsWith("mismatch")).length;
    expect(mismatchCount).toBe(1);
    expect(report).toContain(
      'mismatch event=UserPromptSubmit request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.00 fits=0.00 error="roster is empty"',
    );
  });

  test("event 別の内訳を出す", () => {
    const report = buildReport([
      ...ROWS,
      {
        request:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        expected: "mgzl:commiting-to-git",
        winner: "mgzl:commiting-to-git",
        event: "PreToolUse",
        gateMean: 0.95,
        maxFits: 0.88,
      },
      {
        request: "The assistant is about to perform this action:\nList files\nls typesafe/hooks",
        expected: null,
        winner: "mgzl:investigate-budgeted",
        event: "PreToolUse",
        gateMean: 0.4,
        maxFits: 0.35,
      },
    ]);
    expect(report).toContain(
      "event=UserPromptSubmit total=4 with_skill=2 without_skill=2 errors=0 wrong_suggestion_rate=0.500 unneeded_suggestion_rate=0.500",
    );
    expect(report).toContain(
      "event=PreToolUse total=2 with_skill=1 without_skill=1 errors=0 wrong_suggestion_rate=0.000 unneeded_suggestion_rate=1.000",
    );
  });
});

describe("framingFor", () => {
  test("PreToolUse は TOOL_FRAMING", () => {
    expect(framingFor("PreToolUse")).toBe(TOOL_FRAMING);
  });

  test("UserPromptSubmit は PROMPT_FRAMING", () => {
    expect(framingFor("UserPromptSubmit")).toBe(PROMPT_FRAMING);
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

describe("readGolden", () => {
  test("プロンプト向けのエントリはそのまま読む", () => {
    expect(readGolden([{ request: "a", expected: "x" }, { request: "b", expected: null }])).toEqual([
      { request: "a", expected: "x", event: "UserPromptSubmit" },
      { request: "b", expected: null, event: "UserPromptSubmit" },
    ]);
  });

  test("tool_name 付きのエントリは request を組み立てて PreToolUse にする", () => {
    expect(
      readGolden([
        {
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
          expected: "mgzl:commiting-to-git",
        },
      ]),
    ).toEqual([
      {
        request:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        expected: "mgzl:commiting-to-git",
        event: "PreToolUse",
      },
    ]);
  });

  test("配列でなければ例外にする", () => {
    expect(() => readGolden({})).toThrow("golden must be an array");
  });

  test("request も tool_name も無ければ index 付きで例外にする", () => {
    expect(() => readGolden([{ request: "a", expected: "x" }, { expected: null }])).toThrow(
      "golden.json entry 1 is malformed",
    );
  });

  test("tool_input から request を組み立てられなければ index 付きで例外にする", () => {
    expect(() =>
      readGolden([{ tool_name: "Bash", tool_input: { description: "x" }, expected: null }]),
    ).toThrow("golden.json entry 0 is malformed");
  });

  test("ファイルから読んでも不正なエントリで例外にする", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typesafe-golden-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify([{ request: "a", expected: "x" }, { expected: "y" }]));
    const parsed: unknown = JSON.parse(await Bun.file(path).text());
    expect(() => readGolden(parsed)).toThrow("golden.json entry 1 is malformed");
  });
});

describe("golden.json", () => {
  test("40 件で、プロンプト向け 30 件（20/10）とツール向け 10 件（5/5）", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    const cases = readGolden(parsed);
    expect(cases).toHaveLength(40);

    const prompts = cases.filter((c) => c.event === "UserPromptSubmit");
    expect(prompts).toHaveLength(30);
    expect(prompts.filter((c) => c.expected !== null)).toHaveLength(20);
    expect(prompts.filter((c) => c.expected === null)).toHaveLength(10);

    const tools = cases.filter((c) => c.event === "PreToolUse");
    expect(tools).toHaveLength(10);
    expect(tools.filter((c) => c.expected !== null)).toHaveLength(5);
    expect(tools.filter((c) => c.expected === null)).toHaveLength(5);
  });

  test("ツール向けケースの request は行為向けの前置きで始まる", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    for (const item of readGolden(parsed).filter((c) => c.event === "PreToolUse")) {
      expect(item.request.startsWith("The assistant is about to perform this action:\n")).toBe(true);
    }
  });
});
