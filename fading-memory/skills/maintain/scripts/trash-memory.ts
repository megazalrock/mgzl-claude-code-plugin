import { loadMemories, moveToTrash } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const slug = process.argv[2];
if (slug === undefined) {
  console.error("usage: trash-memory.ts <slug>");
  process.exit(1);
}

const paths = dataPaths(process.cwd());
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
