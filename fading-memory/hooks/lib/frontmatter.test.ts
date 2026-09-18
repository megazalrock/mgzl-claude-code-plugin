import { describe, expect, test } from "bun:test";
import { parseMemory, serializeMemory, type MemoryDoc } from "./frontmatter.ts";

const doc: MemoryDoc = {
  meta: {
    title: "API クライアントの再試行規約: 3回まで",
    created: "2026-08-26T10:00:00.000Z",
    updated: "2026-08-26T10:00:00.000Z",
    lastReferenced: null,
    score: 0,
    permanent: false,
    origin: "manual",
    related: ["other-slug", "another"],
  },
  body: "本文1行目\n\n本文3行目",
};

describe("serializeMemory / parseMemory", () => {
  test("ラウンドトリップで内容が保存される", () => {
    expect(parseMemory(serializeMemory(doc))).toEqual(doc);
  });

  test("lastReferenced と related が空でも往復できる", () => {
    const d: MemoryDoc = {
      meta: { ...doc.meta, lastReferenced: "2026-09-01T00:00:00.000Z", related: [] },
      body: "x",
    };
    expect(parseMemory(serializeMemory(d))).toEqual(d);
  });

  test("frontmatter が無いテキストは null", () => {
    expect(parseMemory("ただの本文")).toBeNull();
  });

  test("閉じ --- が無いテキストは null", () => {
    expect(parseMemory("---\ntitle: x\n本文")).toBeNull();
  });

  test("必須キー欠落は null", () => {
    expect(parseMemory("---\ntitle: x\n---\n本文")).toBeNull();
  });

  test("score が数値でない場合は null", () => {
    const broken = serializeMemory(doc).replace("score: 0", "score: abc");
    expect(parseMemory(broken)).toBeNull();
  });

  test("origin を持たない旧形式は auto として読む", () => {
    const legacy = serializeMemory(doc).replace("origin: manual\n", "");
    expect(parseMemory(legacy)?.meta.origin).toBe("auto");
  });

  test("未知の origin は auto として読む", () => {
    const broken = serializeMemory(doc).replace("origin: manual", "origin: unknown");
    expect(parseMemory(broken)?.meta.origin).toBe("auto");
  });
});
