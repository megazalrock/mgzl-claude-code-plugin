import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildQuestion,
  buildReport,
  type EvalRow,
  NONE_KEY,
  parseArgs,
  readGolden,
} from "./run.ts";

function row(overrides: Partial<EvalRow>): EvalRow {
  return {
    candidate: "c",
    expected: "a",
    kind: "paraphrase",
    choice: "a",
    noneProbability: 0.1,
    top3: ["a", "b", "c"],
    confidence: 0.9,
    top1Probability: 0.8,
    top2Probability: 0.1,
    elapsedMs: 1000,
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("既定値は実データのディレクトリと同梱の golden", () => {
    const args = parseArgs([]);
    expect(args.golden).toBe(join(import.meta.dir, "golden.json"));
    expect(args.memories).toContain("fading-memory");
    expect(args.concurrency).toBe(3);
  });

  test("フラグで上書きできる", () => {
    const args = parseArgs(["--memories", "/m", "--golden", "/g.json", "--concurrency", "2"]);
    expect(args).toEqual({ memories: "/m", golden: "/g.json", concurrency: 2, details: false });
  });

  test("数値でない concurrency は例外", () => {
    expect(() => parseArgs(["--concurrency", "abc"])).toThrow();
  });
});

describe("readGolden", () => {
  test("expected の null と文字列の両方を読める", () => {
    const parsed = readGolden([
      { candidate: "x", expected: null, kind: "novel" },
      { candidate: "y", expected: "slug", kind: "sibling" },
    ]);
    expect(parsed).toEqual([
      { candidate: "x", expected: null, kind: "novel" },
      { candidate: "y", expected: "slug", kind: "sibling" },
    ]);
  });

  test("ambiguous の acceptable を読み、省略時は付けない", () => {
    const parsed = readGolden([
      { candidate: "x", expected: "a", acceptable: ["a", "b"], kind: "ambiguous" },
      { candidate: "y", expected: null, kind: "boundary" },
    ]);
    expect(parsed).toEqual([
      { candidate: "x", expected: "a", acceptable: ["a", "b"], kind: "ambiguous" },
      { candidate: "y", expected: null, kind: "boundary" },
    ]);
  });

  test("acceptable が文字列配列でなければ例外", () => {
    expect(() =>
      readGolden([{ candidate: "x", expected: "a", acceptable: [1], kind: "ambiguous" }]),
    ).toThrow();
  });

  test("未知の kind は例外", () => {
    expect(() => readGolden([{ candidate: "x", expected: null, kind: "other" }])).toThrow();
  });

  test("配列でなければ例外", () => {
    expect(() => readGolden({})).toThrow();
  });
});

describe("buildQuestion", () => {
  test("slug を criteria のキーにし none を足す", () => {
    const question = buildQuestion([{ slug: "a", title: "タイトルA" }]);
    expect(question.type).toBe("choice");
    if (question.type !== "choice") return;
    expect(question.criteria["a"]).toBe("タイトルA");
    expect(question.criteria[NONE_KEY]).toBeDefined();
  });
});

describe("buildReport", () => {
  test("expected が null のケースは none を選べば正解", () => {
    const report = buildReport([
      row({ expected: null, kind: "novel", choice: NONE_KEY, top3: ["a"] }),
    ]);
    expect(report).toContain("kind=novel total=1 errors=0 top1_accuracy=1.000");
    // 正解 slug が無いケースは top3 の分母に入れない
    expect(report).toContain("top3_total=0");
  });

  test("top1 を外しても top3 に入れば top3_hit になる", () => {
    const report = buildReport([row({ choice: "b", top3: ["b", "a", "c"] })]);
    expect(report).toContain("top1_accuracy=0.000");
    expect(report).toContain("top3_hit=1.000");
    expect(report).toContain('mismatch kind=paraphrase candidate="c" expected=a choice=b');
  });

  test("top1 を外しても acceptable の兄弟なら acceptable_hit になる", () => {
    const report = buildReport(
      [
        row({
          kind: "ambiguous",
          expected: "a",
          acceptable: ["a", "b"],
          choice: "b",
          top3: ["b", "a"],
        }),
      ],
      true,
    );
    expect(report).toContain("kind=ambiguous total=1");
    expect(report).toContain("top1_accuracy=0.000");
    expect(report).toContain("acceptable_hit=1.000 acceptable_total=1");
    expect(report).toContain("detail kind=ambiguous");
  });

  test("acceptable を持たないケースは acceptable_hit の分母に入れない", () => {
    const report = buildReport([row({ kind: "boundary", expected: null, choice: NONE_KEY })]);
    expect(report).toContain("acceptable_hit=0.000 acceptable_total=0");
  });

  test("none_p と top1_p の最小最大を出す", () => {
    const report = buildReport([
      row({ noneProbability: 0.2, top1Probability: 0.7 }),
      row({ noneProbability: 0.4, top1Probability: 0.5 }),
    ]);
    expect(report).toContain("none_p_min=0.200 none_p_max=0.400");
    expect(report).toContain("top1_p_min=0.500 top1_p_max=0.700");
  });

  test("error の行は正解にせず分母からも外す", () => {
    const report = buildReport([
      row({ error: "boom", choice: null, expected: null, kind: "novel" }),
      row({ kind: "paraphrase" }),
    ]);
    expect(report).toContain("overall total=2 errors=1 top1_accuracy=1.000");
    expect(report).toContain('error="boom"');
  });
});
