import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const projectDir = process.argv[2] ?? process.cwd();

const paths = dataPaths(projectDir);
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

// title は空白を含みうるため行末に置く
for (const m of memories) {
  console.log(`slug=${m.slug} title=${m.meta.title}`);
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
