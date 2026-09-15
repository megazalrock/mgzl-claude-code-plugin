import {
  addedLines,
  containsJapanese,
  extractCommentBlocks,
  isMarkdownFile,
} from "./lib/comments.ts";
import { changedLineNumbers } from "./lib/edit-range.ts";
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

  const outcome = isMarkdownFile(filePath)
    ? await lintMarkdown(payload.toolName, filePath, payload.toolInput)
    : await lintComments(payload.toolName, filePath, payload.toolInput);
  if (outcome === undefined) return;

  const reason = formatReason(outcome);
  if (reason === "") return;

  console.log(outcome.errors.length > 0 ? postToolUseBlock(reason) : postToolUseAdvisory(reason));
}

/** 日本語なしで lint 不要と判断した場合は undefined を返す */
async function lintMarkdownText(text: string): Promise<LintOutcome | undefined> {
  // 日本語が 1 文字も無ければ textlint を読み込まずに終わる。辞書読み込みで待たせないため
  if (!containsJapanese(text)) return undefined;
  const { lintAll } = await import("./lib/lint.ts");
  return await lintAll([text], "markdown");
}

async function readFileText(filePath: string): Promise<string | undefined> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return undefined;
  }
}

function filterByLines(outcome: LintOutcome, lines: ReadonlySet<number>): LintOutcome {
  return {
    errors: outcome.errors.filter((finding) => lines.has(finding.line)),
    infos: outcome.infos.filter((finding) => lines.has(finding.line)),
  };
}

/**
 * Markdown は編集後のファイル全文を lint し、報告は書き換えた行に載る指摘だけに絞る。
 * 差分の行だけをつないで lint すると frontmatter の区切りやコードフェンスが脱落し、
 * 構造を前提としたルールが散文として誤検知するため。
 */
async function lintMarkdownEdit(
  filePath: string,
  toolInput: Record<string, unknown>,
): Promise<LintOutcome | undefined> {
  const newString = readStringField(toolInput, "new_string");
  if (newString === undefined) return undefined;
  const oldString = readStringField(toolInput, "old_string") ?? "";

  const content = await readFileText(filePath);
  const changed =
    content === undefined ? undefined : changedLineNumbers(content, oldString, newString);
  // 全文を読めない、または書き換え位置を特定できない場合は差分の行だけを見る従来の経路に落とす
  if (content === undefined || changed === undefined) {
    const lines = addedLines(oldString, newString);
    return lines.length === 0 ? undefined : await lintMarkdownText(lines.join("\n"));
  }

  const outcome = await lintMarkdownText(content);
  return outcome === undefined ? undefined : filterByLines(outcome, changed);
}

async function lintMarkdown(
  toolName: string,
  filePath: string,
  toolInput: Record<string, unknown>,
): Promise<LintOutcome | undefined> {
  if (toolName === "Edit") return await lintMarkdownEdit(filePath, toolInput);
  const content = readStringField(toolInput, "content");
  if (toolName !== "Write" || content === undefined) return undefined;
  return await lintMarkdownText(content);
}

/** Markdown 以外はコメントだけを抜き出して lint する */
async function lintComments(
  toolName: string,
  filePath: string,
  toolInput: Record<string, unknown>,
): Promise<LintOutcome | undefined> {
  const lines = targetLines(toolName, toolInput);
  if (lines.length === 0) return undefined;

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
