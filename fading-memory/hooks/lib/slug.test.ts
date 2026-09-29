import { describe, expect, test } from "bun:test";
import { isAcceptableSlug, isSlugTooLong } from "./slug.ts";

describe("isSlugTooLong", () => {
  test("45 文字は検出閾値内、46 文字は超過", () => {
    const s45 = `abcdefghij-${"k".repeat(34)}`;
    const s46 = `abcdefghij-${"k".repeat(35)}`;
    expect(s45.length).toBe(45);
    expect(s46.length).toBe(46);
    expect(isSlugTooLong(s45)).toBe(false);
    expect(isSlugTooLong(s46)).toBe(true);
  });

  test("短い単語で語数が多くても、45文字以内なら短縮対象にしない", () => {
    expect(isSlugTooLong("git-push-ssh-blocked-in-sandbox")).toBe(false);
  });

  test("生成目標(30文字)は超えても検出閾値未満なら短縮対象にしない", () => {
    const s32 = `a-b-c-${"d".repeat(26)}`;
    expect(s32.length).toBe(32);
    expect(isSlugTooLong(s32)).toBe(false);
  });
});

describe("isAcceptableSlug", () => {
  test("書式と上下限を満たす slug を受理する", () => {
    expect(isAcceptableSlug("slug-rename-rule")).toBe(true);
  });

  test("1 語・5 語・31 文字・書式違反は拒否する", () => {
    expect(isAcceptableSlug("single")).toBe(false);
    expect(isAcceptableSlug("a-b-c-d-e")).toBe(false);
    expect(isAcceptableSlug(`abcdefghij-${"k".repeat(20)}`)).toBe(false);
    expect(isAcceptableSlug("Upper-Case")).toBe(false);
    expect(isAcceptableSlug("snake_case-slug")).toBe(false);
    expect(isAcceptableSlug("trailing-")).toBe(false);
  });
});
