import { writeFileSync } from "node:fs";
import { applyExtraction, parseExtractionResult } from "../../../hooks/lib/extraction.ts";
import { renderIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const projectDir = process.argv[2] ?? process.cwd();

const input = await Bun.stdin.text();
let parsed: unknown;
try {
  parsed = JSON.parse(input);
} catch {
  console.error("error=invalid-json");
  process.exit(1);
}
if (typeof parsed !== "object" || parsed === null) {
  console.error("error=invalid-input");
  process.exit(1);
}

// score 加点はセッションから抽出した「実際に役立った記憶」だけに与える指標なので、
// 手動保存の経路では入力に何が来ても加点対象を空にする
const normalized = { ...parsed, usefulMemorySlugs: [] };

// slug の kebab-case 検査や title/related の frontmatter インジェクション対策を
// 抽出経路と共有するため、一度 JSON へ戻して同じパーサに通す
const result = parseExtractionResult(JSON.stringify(normalized));
if (result === null) {
  console.error("error=invalid-input");
  process.exit(1);
}

const paths = dataPaths(projectDir);
ensureDirs(paths);
const report = applyExtraction(paths, result, new Date().toISOString());

// state.json の lastMaintainedAt はメンテナンス実施の記録なのでここでは触らない
writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories));

for (const slug of report.created) {
  console.log(`created=${slug}`);
}
for (const slug of report.updated) {
  console.log(`updated=${slug}`);
}
for (const slug of report.skipped) {
  console.log(`skipped=${slug}`);
}
