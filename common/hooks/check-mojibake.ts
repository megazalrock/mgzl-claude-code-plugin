import { readFileSync, existsSync } from "fs";

interface PostToolUseInput {
  tool_input: {
    file_path?: string;
  };
}

const raw = readFileSync(0, "utf-8");
const input: PostToolUseInput = JSON.parse(raw);
const filePath = input.tool_input.file_path;

if (!filePath || !existsSync(filePath)) {
  process.exit(0);
}

const content = readFileSync(filePath, "utf-8");
const lines = content.split("\n");

const matches: string[] = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("\uFFFD")) {
    matches.push(`  L${i + 1}: ${lines[i]}`);
    if (matches.length >= 5) break;
  }
}

if (matches.length > 0) {
  const context = matches.join("\n");
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `U+FFFD detected in ${filePath} (${matches.length} lines). Re-read the file and fix the corrupted characters.\n${context}`,
    })
  );
}
