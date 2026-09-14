import { readFileSync } from "node:fs";
import { extractLintTargets } from "./lib/commands.ts";
import { containsJapanese } from "./lib/comments.ts";
import {
  describeHookError,
  formatReason,
  parseHookPayload,
  preToolUseAdvisory,
  preToolUseDeny,
  readStringField,
  type LintOutcome,
} from "./lib/hook-io.ts";

function readFileSafely(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const payload = parseHookPayload(await Bun.stdin.text());
  if (payload === undefined || payload.toolName !== "Bash") return;

  const command = readStringField(payload.toolInput, "command");
  if (command === undefined) return;

  const targets = extractLintTargets(command, readFileSafely);
  if (targets.length === 0) return;

  // 日本語が 1 文字も無ければ textlint を読み込まずに終わる
  if (!targets.some((t) => containsJapanese(t.text))) return;

  const { lintJapanese } = await import("./lib/lint.ts");
  const merged: LintOutcome = { errors: [], infos: [] };
  for (const target of targets) {
    if (!containsJapanese(target.text)) continue;
    const outcome = await lintJapanese(target.text, target.context);
    merged.errors.push(...outcome.errors);
    merged.infos.push(...outcome.infos);
  }

  const reason = formatReason(merged);
  if (reason === "") return;

  console.log(merged.errors.length > 0 ? preToolUseDeny(reason) : preToolUseAdvisory(reason));
}

try {
  await main();
} catch (e) {
  // hook 自身の不調でコマンド実行を止めないため、記録だけして正常終了する
  process.stderr.write(`ja-lint pre-bash: ${describeHookError(e)}\n`);
}
process.exit(0);
