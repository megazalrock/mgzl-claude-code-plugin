import { describe, expect, it } from "bun:test";
import { buildExecArgs, resolveCodexBin } from "./codex-command";

describe("resolveCodexBin", () => {
  it("環境変数が無ければ codex 単体を返す", () => {
    expect(resolveCodexBin({})).toStrictEqual(["codex"]);
  });

  it("IMPL_EXECUTE_CODEX_BIN を空白で分割して返す", () => {
    const env = { IMPL_EXECUTE_CODEX_BIN: "bun run /tmp/fake-codex.ts" };

    expect(resolveCodexBin(env)).toStrictEqual(["bun", "run", "/tmp/fake-codex.ts"]);
  });

  it("空文字の環境変数は未設定として扱う", () => {
    expect(resolveCodexBin({ IMPL_EXECUTE_CODEX_BIN: "" })).toStrictEqual(["codex"]);
  });
});

describe("buildExecArgs", () => {
  it("モデルと effort を固定した exec 引数を組み立てる", () => {
    const args = buildExecArgs({ cwd: "/work/front", lastMessageFile: "/tmp/last.md" });

    expect(args).toStrictEqual([
      "exec",
      "-m",
      "gpt-6-astra",
      "-c",
      "model_reasoning_effort=low",
      "-s",
      "workspace-write",
      "-C",
      "/work/front",
      "--skip-git-repo-check",
      "--disable",
      "skill_search",
      "--json",
      "-o",
      "/tmp/last.md",
      "-",
    ]);
  });
});
