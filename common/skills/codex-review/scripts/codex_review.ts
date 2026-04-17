#!/usr/bin/env bun

/**
 * Codex Code Review Script
 * Usage: codex_review.ts [-m model] "<review target>"
 *
 * レビュー対象を自然言語で指定し、Codex にコードレビューを依頼する。
 * 差分の取得やファイルの読み込みは Codex が自律的に行う。
 */

import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

export {};

const args = process.argv.slice(2);
let model = "";
const positionals: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-m" && i + 1 < args.length) {
    model = args[++i] ?? "";
  } else if (arg) {
    positionals.push(arg);
  }
}

const reviewTarget = positionals.join(" ");

if (!reviewTarget) {
  console.error('Usage: codex_review.ts [-m model] "<review target>"');
  console.error("");
  console.error("Examples:");
  console.error('  codex_review.ts "src/utils/fooBar.ts"');
  console.error('  codex_review.ts "developブランチとの差分"');
  console.error('  codex_review.ts "最新のコミット"');
  console.error('  codex_review.ts "src/components ディレクトリ以下"');
  process.exit(1);
}

const reviewPrompt = `You are an expert code reviewer. Review the specified target thoroughly.

## Review Target
${reviewTarget}

## Instructions
Note: The sandbox is read-only. Do not run tests, builds, linters, formatters, or any command that writes to the filesystem. Base your review on static analysis only.

1. Based on the review target above, obtain the relevant code or diff:
   - File path: read the file
   - Branch diff (e.g. "develop branch diff", "developブランチとの差分"): run git diff
   - Commit (e.g. "latest commit", "最新のコミット"): use git show or git log -p
   - Directory (e.g. "src/components directory"): review files in that directory
2. Review for: bugs, code quality, performance, security, best practices
3. Format your review as:

### Summary
Brief overview of what was reviewed and overall assessment.

### Findings
For each finding, assign a severity score from 1 to 5:
- **[5] Must Fix (Blocker)**: Bugs or security issues that block release/deploy
- **[4] Strongly Recommended**: Issues that should be fixed before merge
- **[3] Recommended**: Quality/performance issues worth addressing soon
- **[2] Minor**: Optional improvements
- **[1] Info**: Informational notes, no fix required

Format each finding as: \`[score] <title>\` with file path, line reference, and suggested fix.
Sort findings by score (highest first).

### Good Points
Note positive aspects briefly.

If no issues found, state the code looks good.`;

// Build codex exec command
const codexArgs = [
  "exec",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
];

if (model) {
  codexArgs.push("-m", model);
}

const outputFile = join(tmpdir(), `codex-review-${crypto.randomUUID()}.md`);
codexArgs.push("-o", outputFile, reviewPrompt);

const proc = Bun.spawn(["codex", ...codexArgs], {
  stdout: "pipe",
  stderr: "pipe",
});

// stdout は読み捨て（-o でファイル出力されるため不要）
await new Response(proc.stdout).text();
const exitCode = await proc.exited;

if (exitCode !== 0) {
  const stderr = await new Response(proc.stderr).text();
  console.error(`Error: codex exited with code ${exitCode}`);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  process.exit(1);
}

try {
  const result = await Bun.file(outputFile).text();
  if (result.trim()) {
    console.log(result.trim());
  } else {
    console.error("Error: No review output received from Codex");
    process.exit(1);
  }
} catch {
  console.error("Error: Could not read Codex output file");
  process.exit(1);
} finally {
  await unlink(outputFile).catch(() => {});
}
