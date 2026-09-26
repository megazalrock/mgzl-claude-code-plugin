import { loadMemories, moveToTrash } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

// 他スクリプトと同じく projectDir を先頭に取る。slug だけを渡す旧来の呼び出しも受け付け、その場合は cwd をプロジェクトとみなす
const args = process.argv.slice(2);
const slug = args.at(-1);
const projectDir = args.length >= 2 && args[0] !== undefined ? args[0] : process.cwd();
if (slug === undefined) {
  console.error("usage: trash-memory.ts [<projectDir>] <slug>");
  process.exit(1);
}

const paths = dataPaths(projectDir);
const mem = loadMemories(paths).memories.find((m) => m.slug === slug);
if (mem === undefined) {
  console.error(`error=not-found slug=${slug}`);
  process.exit(1);
}
if (mem.meta.permanent) {
  console.error(`error=permanent slug=${slug} 削除は行わずユーザーに報告すること`);
  process.exit(1);
}
moveToTrash(paths, slug, Date.now());
console.log(`trashed=${slug}`);
