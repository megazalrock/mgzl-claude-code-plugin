import { describe, expect, test } from "bun:test";
import {
  collectConflictingExpectations,
  findConflictingExpectations,
} from "./check-prh-conflicts.ts";

describe("辞書の衝突検査", () => {
  test("自前辞書に衝突する expected は無い", async () => {
    expect(await collectConflictingExpectations()).toEqual([]);
  }, 60_000);
});

describe("衝突の検出", () => {
  test("漢数字を含む expected は衝突として検出される", async () => {
    expect(await findConflictingExpectations(["一つ一つ"])).toEqual(["一つ一つ"]);
  }, 60_000);

  test("表記正規化ルールに触れない expected は検出されない", async () => {
    expect(await findConflictingExpectations(["ユーザビリティ"])).toEqual([]);
  }, 60_000);

  test("後方参照を含む expected は判定から除く", async () => {
    expect(await findConflictingExpectations(["一つ$1"])).toEqual([]);
  }, 60_000);
});
