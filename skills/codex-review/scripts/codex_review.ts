#!/usr/bin/env bun

/**
 * Codex Code Review Script
 * Usage: codex_review.ts [-m model] "<review target>"
 *
 * レビュー対象を自然言語で指定し、Codex にコードレビューを依頼する。
 * 差分の取得やファイルの読み込みは Codex が自律的に行う。
 */

const args = process.argv.slice(2);
let model = "";
const positionals: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-m" && i + 1 < args.length) {
    model = args[++i];
  } else {
    positionals.push(args[i]);
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

const prompt = `You are an expert code reviewer. Review the specified target thoroughly.

## Review Target
${reviewTarget}

## Instructions
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
For each finding:
- 🔴 **Critical**: Bugs, security issues that must be fixed
- 🟡 **Warning**: Code quality or performance issues that should be addressed
- 🔵 **Info**: Style or best practice suggestions

Include file path, line reference, and suggested fix for each.

### Good Points
Note positive aspects briefly.

If no issues found, state the code looks good.`;

// Build codex exec command
const codexArgs = [
  "exec",
  "--skip-git-repo-check",
  "-a",
  "never",
  "--sandbox",
  "read-only",
];

if (model) {
  codexArgs.push("-m", model);
}

codexArgs.push("--json", prompt);

const proc = Bun.spawn(["codex", ...codexArgs], {
  stdout: "pipe",
  stderr: "pipe",
});

const stdout = await new Response(proc.stdout).text();
const exitCode = await proc.exited;

if (exitCode !== 0) {
  const stderr = await new Response(proc.stderr).text();
  console.error(`Error: codex exited with code ${exitCode}`);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  process.exit(1);
}

// Parse JSON Lines output to extract the final agent message
const lines = stdout.trim().split("\n");
let lastMessage = "";

for (const line of lines) {
  try {
    const event = JSON.parse(line);
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message"
    ) {
      lastMessage = event.item.text;
    }
  } catch {
    // Skip non-JSON lines
  }
}

if (lastMessage) {
  console.log(lastMessage);
} else {
  // Fallback: retry without --json
  const fallbackArgs = [
    "exec",
    "--skip-git-repo-check",
    "-a",
    "never",
    "--sandbox",
    "read-only",
    ...(model ? ["-m", model] : []),
    prompt,
  ];

  const fallback = Bun.spawn(["codex", ...fallbackArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const fallbackOutput = await new Response(fallback.stdout).text();
  await fallback.exited;

  if (fallbackOutput.trim()) {
    console.log(fallbackOutput.trim());
  } else {
    console.error("Error: No review output received from Codex");
    process.exit(1);
  }
}
