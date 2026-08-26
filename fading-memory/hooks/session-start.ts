import { writeFileSync } from "node:fs";
import { renderIndex } from "./lib/index-gen.ts";
import { appendError } from "./lib/log.ts";
import {
  ensureDirs,
  expireMemories,
  loadMemories,
  purgeTrash,
} from "./lib/maintenance.ts";
import { dataPaths } from "./lib/paths.ts";

function resolveProjectDir(input: unknown): string {
  if (typeof input === "object" && input !== null && "cwd" in input) {
    const cwd = (input as { cwd: unknown }).cwd;
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof cwd === "string") return cwd;
  }
  return process.cwd();
}

async function main(): Promise<void> {
  // headless 抽出セッションで自分のフックが再帰的に動くのを防ぐ
  if (process.env["FADING_MEMORY_WORKER"] === "1") return;

  const input: unknown = JSON.parse(await Bun.stdin.text());
  const projectDir = resolveProjectDir(input);
  const paths = dataPaths(projectDir);

  try {
    ensureDirs(paths);
    const now = Date.now();
    purgeTrash(paths, now);
    expireMemories(paths, now);

    const { memories, malformed } = loadMemories(paths);
    if (malformed.length > 0) {
      appendError(paths, `frontmatter を解析できないため除外: ${malformed.join(", ")}`);
    }

    const index = renderIndex(memories);
    writeFileSync(paths.indexFile, index);

    if (memories.length > 0) {
      const context = [
        "# fading-memory（プロジェクト記憶）",
        "過去のセッションから自動抽出された記憶の目次である。",
        `作業に関連しそうな項目があれば ${paths.memoriesDir}/<slug>.md を Read して活用すること。`,
        "",
        index,
      ].join("\n");
      console.log(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
        }),
      );
    }
  } catch (e) {
    try {
      appendError(paths, `session-start: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合も、セッションを壊さないことを優先して無視する
    }
  }
}

await main();
