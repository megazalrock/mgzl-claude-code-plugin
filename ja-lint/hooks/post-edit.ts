import {
  addedLines,
  containsJapanese,
  extractCommentBlocks,
  isMarkdownFile,
} from "./lib/comments.ts";
import {
  describeHookError,
  type LintOutcome,
  formatReason,
  parseHookPayload,
  postToolUseAdvisory,
  postToolUseBlock,
  readStringField,
} from "./lib/hook-io.ts";

function targetLines(toolName: string, toolInput: Record<string, unknown>): string[] {
  if (toolName === "Write") {
    const content = readStringField(toolInput, "content");
    return content === undefined ? [] : content.split("\n");
  }
  if (toolName === "Edit") {
    const oldString = readStringField(toolInput, "old_string") ?? "";
    const newString = readStringField(toolInput, "new_string");
    return newString === undefined ? [] : addedLines(oldString, newString);
  }
  return [];
}

async function main(): Promise<void> {
  const payload = parseHookPayload(await Bun.stdin.text());
  if (payload === undefined) return;

  const filePath = readStringField(payload.toolInput, "file_path");
  if (filePath === undefined) return;

  const lines = targetLines(payload.toolName, payload.toolInput);
  if (lines.length === 0) return;

  const outcome = await lintLines(filePath, lines);
  if (outcome === undefined) return;

  const reason = formatReason(outcome);
  if (reason === "") return;

  console.log(outcome.errors.length > 0 ? postToolUseBlock(reason) : postToolUseAdvisory(reason));
}

/** 対象外・日本語なしで lint 不要と判断した場合は undefined を返す */
async function lintLines(filePath: string, lines: string[]): Promise<LintOutcome | undefined> {
  if (isMarkdownFile(filePath)) {
    const text = lines.join("\n");
    // 日本語が 1 文字も無ければ textlint を読み込まずに終わる。辞書読み込みで待たせないため
    if (!containsJapanese(text)) return undefined;
    const { lintAll } = await import("./lib/lint.ts");
    return await lintAll([text], "markdown");
  }

  const blocks = extractCommentBlocks(filePath, lines);
  if (blocks.length === 0) return undefined;
  if (!blocks.some(containsJapanese)) return undefined;

  const { lintAll } = await import("./lib/lint.ts");
  return await lintAll(blocks, "comment");
}

try {
  await main();
} catch (e) {
  // hook 自身の不調で編集を止めないため、記録だけして正常終了する
  process.stderr.write(`ja-lint post-edit: ${describeHookError(e)}\n`);
}
process.exit(0);
