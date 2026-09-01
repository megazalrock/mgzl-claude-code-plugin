import { remainingDays } from "../../../hooks/lib/expiry.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";
import { sortByScore } from "../../../hooks/lib/ranking.ts";

const projectDir = process.argv[2] ?? process.cwd();

const paths = dataPaths(projectDir);
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

// 全件で同一の基準時刻を使い、行ごとに残り日数がずれないようにする
const now = Date.now();

console.log(`total=${memories.length}`);
// title は空白を含みうるため行末に置く
for (const m of sortByScore(memories)) {
  const remain = remainingDays(m.meta, now);
  const remaining = remain === Infinity ? "infinite" : String(remain);
  const lastReferenced =
    m.meta.lastReferenced === null ? "null" : m.meta.lastReferenced.slice(0, 10);
  console.log(
    `score=${m.meta.score} slug=${m.slug} remaining=${remaining} lastReferenced=${lastReferenced} permanent=${m.meta.permanent} title=${m.meta.title}`,
  );
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
