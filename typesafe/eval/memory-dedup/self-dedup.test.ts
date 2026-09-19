import { describe, expect, test } from "bun:test";
import {
  buildPairings,
  formatRow,
  formatSummary,
  formatTop,
  type SelfDedupRow,
  summarize,
} from "./self-dedup.ts";

function row(overrides: Partial<SelfDedupRow>): SelfDedupRow {
  return {
    slug: "a",
    title: "タイトル A",
    verdict: "new",
    noneProbability: 0.9,
    confidence: 0.8,
    top: [],
    elapsedMs: 1000,
    ...overrides,
  };
}

describe("buildPairings", () => {
  test("slug 昇順に並べ替えて i より後ろだけを相手にする", () => {
    const pairings = buildPairings([
      { slug: "c", title: "C" },
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
    ]);
    expect(pairings.map((pairing) => pairing.candidate.slug)).toEqual(["a", "b"]);
    expect(pairings[0]?.others.map((entry) => entry.slug)).toEqual(["b", "c"]);
    expect(pairings[1]?.others.map((entry) => entry.slug)).toEqual(["c"]);
  });

  test("記憶が 1 件以下なら組は作られない", () => {
    expect(buildPairings([])).toEqual([]);
    expect(buildPairings([{ slug: "a", title: "A" }])).toEqual([]);
  });

  test("同じ組を二度作らない", () => {
    const pairings = buildPairings([
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
      { slug: "c", title: "C" },
    ]);
    const pairs = pairings.flatMap((pairing) =>
      pairing.others.map((entry) => `${pairing.candidate.slug}:${entry.slug}`),
    );
    expect(pairs).toEqual(["a:b", "a:c", "b:c"]);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("summarize", () => {
  test("verdict 別に数え、リクエスト数は候補数と一致する", () => {
    const summary = summarize([
      row({ verdict: "duplicate", elapsedMs: 1000 }),
      row({ verdict: "duplicate", elapsedMs: 2000 }),
      row({ verdict: "ambiguous", elapsedMs: 3000 }),
    ]);
    expect(summary.candidates).toBe(3);
    expect(summary.verdicts).toEqual({ duplicate: 2, ambiguous: 1, new: 0 });
    expect(summary.requests).toBe(3);
    expect(summary.totalElapsedMs).toBe(6000);
    expect(summary.avgElapsedMs).toBe(2000);
  });

  test("空なら平均はゼロ", () => {
    const summary = summarize([]);
    expect(summary.candidates).toBe(0);
    expect(summary.avgElapsedMs).toBe(0);
  });
});

describe("format", () => {
  test("top が空なら - を出す", () => {
    expect(formatTop([])).toBe("-");
    expect(formatTop([{ slug: "a", probability: 0.421 }])).toBe("a:0.42");
  });

  test("候補行は key=value 形式で title を行末に置く", () => {
    const line = formatRow(
      row({
        slug: "x",
        title: "空白 を 含む",
        verdict: "duplicate",
        noneProbability: 0.05,
        confidence: 0.91,
        top: [{ slug: "y", probability: 0.8 }],
        elapsedMs: 1234,
      }),
    );
    expect(line).toBe(
      "slug=x verdict=duplicate none_p=0.05 confidence=0.91 elapsed_ms=1234 top=y:0.80 title=空白 を 含む",
    );
  });

  test("集計行に verdict 別件数と平均が並ぶ", () => {
    const line = formatSummary(summarize([row({ verdict: "new", elapsedMs: 500 })]));
    expect(line).toBe(
      "candidates=1 duplicate=0 ambiguous=0 new=1 requests=1 total_elapsed_ms=500 avg_elapsed_ms=500.0",
    );
  });
});
