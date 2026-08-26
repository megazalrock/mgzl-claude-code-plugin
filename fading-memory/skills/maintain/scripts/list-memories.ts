import { expiresAt } from "../../../hooks/lib/expiry.ts";
import { sortForIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const paths = dataPaths(process.cwd());
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

for (const m of sortForIndex(memories)) {
  const exp = expiresAt(m.meta);
  const expires = exp === Infinity ? "never" : new Date(exp).toISOString();
  console.log(
    `slug=${m.slug} permanent=${m.meta.permanent} expires=${expires} file=${m.file} title=${m.meta.title}`,
  );
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
