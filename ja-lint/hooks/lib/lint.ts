import type { TargetContext } from "./commands.ts";
import { extractQuote, type Finding, type LintOutcome } from "./hook-io.ts";
import { buildDescriptor, INFO_RULE_IDS } from "./textlint-config.ts";

/** TextlintRuleSeverityLevelKeys.error の値 */
const SEVERITY_ERROR = 2;

/**
 * lint 対象を渡すための擬似パス。plugin は拡張子で選ばれる。
 * pr / markdown で Markdown として解析するのは、ai-writing の箇条書き・強調・見出しのルールと
 * ja-no-mixed-period の ListItem / Code 除外が Markdown の AST を前提にしているためである。
 */
function virtualPathFor(context: TargetContext): string {
  return context === "pr" || context === "markdown" ? "/ja-lint/input.md" : "/ja-lint/input.txt";
}

/**
 * 与えた文字列を文脈に応じて lint し、error と info に振り分けて返す。
 * textlint の読み込みは呼び出された時点で初めて行われる。
 */
export async function lintJapanese(text: string, context: TargetContext): Promise<LintOutcome> {
  const { createLinter } = await import("textlint");
  const descriptor = await buildDescriptor(context);
  const linter = createLinter({ descriptor });
  const result = await linter.lintText(text, virtualPathFor(context));

  const errors: Finding[] = [];
  const infos: Finding[] = [];
  for (const message of result.messages) {
    const finding: Finding = {
      ruleId: message.ruleId,
      message: message.message,
      quote: extractQuote(text, message.index),
    };
    const isInfo = INFO_RULE_IDS.has(message.ruleId) || message.severity !== SEVERITY_ERROR;
    if (isInfo) {
      infos.push(finding);
    } else {
      errors.push(finding);
    }
  }
  return { errors, infos };
}

/** 複数の文字列をまとめて lint し、結果を 1 つに畳み込む */
export async function lintAll(texts: string[], context: TargetContext): Promise<LintOutcome> {
  const merged: LintOutcome = { errors: [], infos: [] };
  for (const text of texts) {
    const outcome = await lintJapanese(text, context);
    merged.errors.push(...outcome.errors);
    merged.infos.push(...outcome.infos);
  }
  return merged;
}
