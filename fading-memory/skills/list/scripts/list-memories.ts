import { remainingDays } from "../../../hooks/lib/expiry.ts";
import { visibleMemories } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";
import { sortByScore } from "../../../hooks/lib/ranking.ts";

// SKILL.md は --all をパスの前後どちらに置いても渡しうるため、位置に依存せず取り出す
const args = process.argv.slice(2);
const showAll = args.includes("--all");
const projectDir = args.find((a) => a !== "--all") ?? process.cwd();

const paths = dataPaths(projectDir);
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

// 全件で同一の基準時刻を使い、行ごとに残り日数がずれないようにする
const now = Date.now();

// 既定では index.md に載っている記憶だけを出す。絞り込み条件は目次生成と共有し、一覧と目次の食い違いを防ぐ
const targets = showAll ? memories : visibleMemories(memories, now);

console.log(`total=${targets.length}`);
// title は空白を含みうるため行末に置く
for (const m of sortByScore(targets)) {
  const remain = remainingDays(m.meta, now);
  const remaining = remain === Infinity ? "infinite" : String(remain);
  const lastReferenced =
    m.meta.lastReferenced === null ? "null" : m.meta.lastReferenced.slice(0, 10);
  console.log(
    `score=${m.meta.score} slug=${m.slug} remaining=${remaining} lastReferenced=${lastReferenced} permanent=${m.meta.permanent} origin=${m.meta.origin} title=${m.meta.title}`,
  );
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
