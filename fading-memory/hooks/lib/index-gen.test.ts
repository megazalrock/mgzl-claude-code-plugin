import { describe, expect, test } from "bun:test";
import type { MemoryMeta } from "./frontmatter.ts";
import { renderIndex, sortForIndex, visibleMemories } from "./index-gen.ts";
import type { LoadedMemory } from "./maintenance.ts";

const DAY = 24 * 60 * 60 * 1000;
const CREATED_MS = Date.parse("2026-01-01T00:00:00.000Z");

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
      origin: "auto",
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
    const text = renderIndex([mem("a", {})], CREATED_MS);
    expect(text).toContain("- [title of a](memories/a.md)");
  });

  test("有効期限を過ぎた記憶は載せず、permanent は常に載せる", () => {
    const now = CREATED_MS + 400 * DAY;
    const text = renderIndex([mem("faded", {}), mem("keep", { permanent: true })], now);
    expect(text).toContain("- [title of keep](memories/keep.md)");
    expect(text).not.toContain("faded");
  });

  test("期限ちょうどの記憶は載せない", () => {
    const now = CREATED_MS + 15 * DAY;
    expect(renderIndex([mem("edge", {})], now)).not.toContain("edge");
  });
});

describe("visibleMemories", () => {
  test("有効期限内の記憶だけを返し、入力配列を破壊しない", () => {
    const now = CREATED_MS + 400 * DAY;
    const list = [mem("faded", {}), mem("keep", { permanent: true })];
    expect(visibleMemories(list, now).map((m) => m.slug)).toEqual(["keep"]);
    expect(list.map((m) => m.slug)).toEqual(["faded", "keep"]);
  });
});
