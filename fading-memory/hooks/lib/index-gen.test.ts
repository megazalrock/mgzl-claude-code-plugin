import { describe, expect, test } from "bun:test";
import type { MemoryMeta } from "./frontmatter.ts";
import { renderIndex, sortForIndex } from "./index-gen.ts";
import type { LoadedMemory } from "./maintenance.ts";

function mem(slug: string, over: Partial<MemoryMeta>): LoadedMemory {
  return {
    slug,
    file: `/x/${slug}.md`,
    body: "b",
    meta: {
      title: `title of ${slug}`,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      lastReferenced: null,
      score: 0,
      permanent: false,
      related: [],
      ...over,
    },
  };
}

describe("sortForIndex", () => {
  test("permanent が先頭、以降は有効期限の降順", () => {
    const list = [mem("low", {}), mem("keep", { permanent: true }), mem("high", { score: 5 })];
    expect(sortForIndex(list).map((m) => m.slug)).toEqual(["keep", "high", "low"]);
  });
});

describe("renderIndex", () => {
  test("タイトルと相対パスのリストを出力する", () => {
    const text = renderIndex([mem("a", {})]);
    expect(text).toContain("- [title of a](memories/a.md)");
  });
});
