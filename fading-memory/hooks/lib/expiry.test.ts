import { describe, expect, test } from "bun:test";
import { expiresAt, remainingDays } from "./expiry.ts";
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
    origin: "auto",
    related: [],
    ...over,
  };
}

describe("expiresAt", () => {
  test("auto の score 0 は created + 10日", () => {
    expect(expiresAt(meta({}))).toBe(createdMs + 10 * DAY);
  });

  test("manual の score 0 は created + 20日", () => {
    expect(expiresAt(meta({ origin: "manual" }))).toBe(createdMs + 20 * DAY);
  });

  test("score 1 につき 7 日延長される", () => {
    expect(expiresAt(meta({ score: 3 }))).toBe(createdMs + (10 + 21) * DAY);
  });

  test("延長に上限は無い", () => {
    expect(expiresAt(meta({ score: 100 }))).toBe(createdMs + (10 + 700) * DAY);
  });

  test("lastReferenced があればそれを起点にし、created は使わない", () => {
    const lastRef = new Date(createdMs + 200 * DAY).toISOString();
    expect(expiresAt(meta({ score: 2, lastReferenced: lastRef }))).toBe(
      createdMs + (200 + 10 + 14) * DAY,
    );
  });

  test("permanent は Infinity", () => {
    expect(expiresAt(meta({ permanent: true }))).toBe(Infinity);
  });

  test("manual と lastReferenced は直交して効く", () => {
    const lastRef = new Date(createdMs + 100 * DAY).toISOString();
    expect(expiresAt(meta({ origin: "manual", score: 1, lastReferenced: lastRef }))).toBe(
      createdMs + (100 + 20 + 7) * DAY,
    );
  });
});

describe("remainingDays", () => {
  test("permanent は Infinity", () => {
    expect(remainingDays(meta({ permanent: true }), createdMs)).toBe(Infinity);
  });

  test("期限ちょうどの時刻では 0", () => {
    expect(remainingDays(meta({}), createdMs + 10 * DAY)).toBe(0);
  });

  test("期限を過ぎていれば負値になる", () => {
    expect(remainingDays(meta({}), createdMs + 13 * DAY)).toBe(-3);
  });

  test("端数は切り上げる", () => {
    expect(remainingDays(meta({}), createdMs + 9.5 * DAY)).toBe(1);
  });

  test("score による延長が残り日数に反映される", () => {
    expect(remainingDays(meta({ score: 3 }), createdMs)).toBe(31);
  });
});
