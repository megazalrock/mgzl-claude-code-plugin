import { describe, expect, test } from "bun:test";
import type { MemoryMeta } from "./frontmatter.ts";
import type { LoadedMemory } from "./maintenance.ts";
import { sortByScore } from "./ranking.ts";

const CREATED = "2026-01-01T00:00:00.000Z";

function mem(slug: string, over: Partial<MemoryMeta>): LoadedMemory {
  return {
    slug,
    file: `/x/${slug}.md`,
    body: "b",
    meta: {
      title: `title of ${slug}`,
      created: CREATED,
      updated: CREATED,
      lastReferenced: null,
      score: 0,
      permanent: false,
      related: [],
      ...over,
    },
  };
}

describe("sortByScore", () => {
  test("score の降順に並ぶ", () => {
    const list = [mem("low", { score: 1 }), mem("high", { score: 5 }), mem("mid", { score: 3 })];
    expect(sortByScore(list).map((m) => m.slug)).toEqual(["high", "mid", "low"]);
  });

  test("score が同点なら有効期限の降順になる", () => {
    const list = [
      mem("older", { score: 2 }),
      mem("newer", { score: 2, created: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(sortByScore(list).map((m) => m.slug)).toEqual(["newer", "older"]);
  });

  test("score も有効期限も同じなら slug の昇順になる", () => {
    const list = [mem("beta", { score: 2 }), mem("alpha", { score: 2 })];
    expect(sortByScore(list).map((m) => m.slug)).toEqual(["alpha", "beta"]);
  });

  test("入力配列を破壊しない", () => {
    const list = [mem("low", { score: 1 }), mem("high", { score: 5 })];
    sortByScore(list);
    expect(list.map((m) => m.slug)).toEqual(["low", "high"]);
  });
});
