import { describe, expect, test } from "bun:test";
import { parseTargetArgs } from "./args.ts";

describe("parseTargetArgs", () => {
  test("引数が無ければ cwd を使い、全件指定は無し", () => {
    expect(parseTargetArgs([], "/cwd")).toEqual({ projectDir: "/cwd", all: false });
  });

  test("projectDir だけを渡せばそれを使う", () => {
    expect(parseTargetArgs(["/proj"], "/cwd")).toEqual({ projectDir: "/proj", all: false });
  });

  test("--all はパスの後ろでも前でも受け付ける", () => {
    expect(parseTargetArgs(["/proj", "--all"], "/cwd")).toEqual({ projectDir: "/proj", all: true });
    expect(parseTargetArgs(["--all", "/proj"], "/cwd")).toEqual({ projectDir: "/proj", all: true });
  });

  test("--all だけなら cwd を使う", () => {
    expect(parseTargetArgs(["--all"], "/cwd")).toEqual({ projectDir: "/cwd", all: true });
  });
});
