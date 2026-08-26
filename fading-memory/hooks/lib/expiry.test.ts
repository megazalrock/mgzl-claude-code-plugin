import { describe, expect, test } from "bun:test";
import { expiresAt } from "./expiry.ts";
import type { MemoryMeta } from "./frontmatter.ts";

const DAY = 24 * 60 * 60 * 1000;
const CREATED = "2026-01-01T00:00:00.000Z";
const createdMs = Date.parse(CREATED);

function meta(over: Partial<MemoryMeta>): MemoryMeta {
  return {
    title: "t",
    created: CREATED,
    updated: CREATED,
    lastReferenced: null,
    score: 0,
    permanent: false,
    related: [],
    ...over,
  };
}

describe("expiresAt", () => {
  test("score 0 は created + 基本TTL 30日", () => {
    expect(expiresAt(meta({}))).toBe(createdMs + 30 * DAY);
  });

  test("score 1 につき 7 日延長される", () => {
    expect(expiresAt(meta({ score: 3 }))).toBe(createdMs + (30 + 21) * DAY);
  });

  test("延長は上限 120 日で頭打ちになる", () => {
    expect(expiresAt(meta({ score: 100 }))).toBe(createdMs + 120 * DAY);
  });

  test("最終参照日 + 基本TTL が下限として効く", () => {
    const lastRef = new Date(createdMs + 200 * DAY).toISOString();
    expect(expiresAt(meta({ score: 100, lastReferenced: lastRef }))).toBe(
      createdMs + (200 + 30) * DAY,
    );
  });

  test("permanent は Infinity", () => {
    expect(expiresAt(meta({ permanent: true }))).toBe(Infinity);
  });
});
