import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTail } from "./tail.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-tail-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("createTail", () => {
  test("初回は先頭から完結した行を全部返す", () => {
    const path = join(root, "a.jsonl");
    writeFileSync(path, "one\ntwo\n");
    const tail = createTail(path);
    expect(tail.read()).toEqual({ lines: ["one", "two"], reset: false });
  });

  test("2 回目は前回以降の行だけを返す", () => {
    const path = join(root, "b.jsonl");
    writeFileSync(path, "one\n");
    const tail = createTail(path);
    tail.read();
    appendFileSync(path, "two\nthree\n");
    expect(tail.read().lines).toEqual(["two", "three"]);
    expect(tail.read().lines).toEqual([]);
  });

  test("改行で終わらない断片は次回に連結される", () => {
    const path = join(root, "c.jsonl");
    writeFileSync(path, "one\ntw");
    const tail = createTail(path);
    expect(tail.read().lines).toEqual(["one"]);
    appendFileSync(path, "o\nthree\n");
    expect(tail.read().lines).toEqual(["two", "three"]);
  });

  test("ファイルが無ければ空を返し、生成されたら読み始める", () => {
    const path = join(root, "d.jsonl");
    const tail = createTail(path);
    expect(tail.read()).toEqual({ lines: [], reset: false });
    writeFileSync(path, "one\n");
    expect(tail.read()).toEqual({ lines: ["one"], reset: false });
  });

  test("切り詰められたら reset を立てて先頭から読み直す", () => {
    const path = join(root, "e.jsonl");
    writeFileSync(path, "one\ntwo\nthree\n");
    const tail = createTail(path);
    tail.read();
    writeFileSync(path, "x\n");
    expect(tail.read()).toEqual({ lines: ["x"], reset: true });
    appendFileSync(path, "y\n");
    expect(tail.read()).toEqual({ lines: ["y"], reset: false });
  });

  test("マルチバイト文字が chunk 境界で切れても壊れない", () => {
    const path = join(root, "f.jsonl");
    const tail = createTail(path);
    writeFileSync(path, "日本語\n");
    expect(tail.read().lines).toEqual(["日本語"]);
    appendFileSync(path, "追記\n");
    expect(tail.read().lines).toEqual(["追記"]);
  });
});
