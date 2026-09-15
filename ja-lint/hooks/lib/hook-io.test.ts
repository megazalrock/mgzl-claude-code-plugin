import { describe, expect, test } from "bun:test";
import {
  describeHookError,
  extractQuote,
  formatReason,
  parseHookPayload,
  postToolUseAdvisory,
  postToolUseBlock,
  preToolUseAdvisory,
  preToolUseDeny,
  readStringField,
  type LintOutcome,
} from "./hook-io.ts";

describe("parseHookPayload", () => {
  test("tool_name と tool_input を取り出す", () => {
    const raw = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/a.ts" } });
    expect(parseHookPayload(raw)).toEqual({ toolName: "Edit", toolInput: { file_path: "/a.ts" } });
  });

  test("JSON として壊れていれば undefined", () => {
    expect(parseHookPayload("{")).toBeUndefined();
  });

  test("tool_name が無ければ undefined", () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: {} }))).toBeUndefined();
  });

  test("tool_input が無ければ空オブジェクトを補う", () => {
    expect(parseHookPayload(JSON.stringify({ tool_name: "Bash" }))).toEqual({
      toolName: "Bash",
      toolInput: {},
    });
  });
});

describe("readStringField", () => {
  test("文字列なら返す", () => {
    expect(readStringField({ a: "x" }, "a")).toBe("x");
  });

  test("文字列以外なら undefined", () => {
    expect(readStringField({ a: 1 }, "a")).toBeUndefined();
    expect(readStringField({}, "a")).toBeUndefined();
  });
});

describe("extractQuote", () => {
  test("指摘位置を含む文を句点まで切り出す", () => {
    const text = "最初の文です。ユーザの情報を取得する。最後の文です。";
    expect(extractQuote(text, text.indexOf("ユーザ"))).toBe("ユーザの情報を取得する。");
  });

  test("句点が無ければ行末まで切り出す", () => {
    const text = "前の行\n句点の無い行\n次の行";
    expect(extractQuote(text, text.indexOf("句点"))).toBe("句点の無い行");
  });

  test("長い文は前後を省略記号で切り詰める", () => {
    const text = `${"あ".repeat(40)}X${"い".repeat(40)}。`;
    const quote = extractQuote(text, 40, 20);
    expect(quote.length).toBeLessThanOrEqual(22);
    expect(quote).toContain("X");
    expect(quote.startsWith("…")).toBe(true);
    expect(quote.endsWith("…")).toBe(true);
  });
});

describe("formatReason", () => {
  test("error のみのとき件数と一覧を出す", () => {
    const outcome: LintOutcome = {
      errors: [
        { ruleId: "ja-technical-writing/ja-no-redundant-expression", message: "冗長です", quote: "取得を行う。", line: 1 },
        { ruleId: "prh", message: "ユーザの => ユーザーの", quote: "ユーザの一覧を表示する。", line: 1 },
      ],
      infos: [],
    };
    expect(formatReason(outcome)).toBe(
      [
        "ja-lint: 日本語の文章に修正が必要です（error 2 件）",
        "- 「取得を行う。」 [ja-technical-writing/ja-no-redundant-expression] 冗長です",
        "- 「ユーザの一覧を表示する。」 [prh] ユーザの => ユーザーの",
      ].join("\n"),
    );
  });

  test("info のみのとき参考セクションだけを出す", () => {
    const outcome: LintOutcome = {
      errors: [],
      infos: [{ ruleId: "ai-writing/ai-tech-writing-guideline", message: "簡潔にできます", quote: "まず最初に。", line: 1 }],
    };
    expect(formatReason(outcome)).toBe(
      ["参考（info 1 件）", "- 「まず最初に。」 [ai-writing/ai-tech-writing-guideline] 簡潔にできます"].join("\n"),
    );
  });

  test("error と info が両方あるとき空行で区切る", () => {
    const outcome: LintOutcome = {
      errors: [{ ruleId: "prh", message: "ユーザの => ユーザーの", quote: "ユーザの。", line: 1 }],
      infos: [{ ruleId: "ai-writing/ai-tech-writing-guideline", message: "簡潔に", quote: "まず最初に。", line: 1 }],
    };
    expect(formatReason(outcome)).toBe(
      [
        "ja-lint: 日本語の文章に修正が必要です（error 1 件）",
        "- 「ユーザの。」 [prh] ユーザの => ユーザーの",
        "",
        "参考（info 1 件）",
        "- 「まず最初に。」 [ai-writing/ai-tech-writing-guideline] 簡潔に",
      ].join("\n"),
    );
  });

  test("どちらも無ければ空文字", () => {
    expect(formatReason({ errors: [], infos: [] })).toBe("");
  });

  test("改行を含むメッセージは 1 行目だけにする", () => {
    const outcome: LintOutcome = {
      errors: [{ ruleId: "prh", message: "1 行目\n解説: https://example.com", quote: "あ。", line: 1 }],
      infos: [],
    };
    expect(formatReason(outcome)).toContain("[prh] 1 行目");
    expect(formatReason(outcome)).not.toContain("解説");
  });
});

describe("describeHookError", () => {
  test("モジュール未解決のエラーは依存未インストールの案内にする", () => {
    const message = describeHookError(new Error("Cannot find module '@textlint/kernel'"));
    expect(message).toContain("依存が未インストール");
  });

  test("それ以外の Error はそのままのメッセージ", () => {
    expect(describeHookError(new Error("何か失敗した"))).toBe("何か失敗した");
  });
});

describe("出力 JSON", () => {
  test("preToolUseDeny", () => {
    expect(JSON.parse(preToolUseDeny("理由"))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "理由",
      },
    });
  });

  test("preToolUseAdvisory", () => {
    expect(JSON.parse(preToolUseAdvisory("参考"))).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "参考" },
    });
  });

  test("postToolUseBlock は上位の decision と reason を使う", () => {
    expect(JSON.parse(postToolUseBlock("理由"))).toEqual({ decision: "block", reason: "理由" });
  });

  test("postToolUseAdvisory", () => {
    expect(JSON.parse(postToolUseAdvisory("参考"))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "参考" },
    });
  });
});
