import { dataPaths } from "../../../hooks/lib/paths.ts";
import { renameMemory } from "../../../hooks/lib/rename.ts";

const [projectDir, oldSlug, newSlug] = process.argv.slice(2);
if (projectDir === undefined || oldSlug === undefined || newSlug === undefined) {
  console.error("usage: rename-memory.ts <projectDir> <oldSlug> <newSlug>");
  process.exit(1);
}

const result = renameMemory(dataPaths(projectDir), oldSlug, newSlug);
if (!result.ok) {
  console.error(`error=${result.error} slug=${result.slug}`);
  process.exit(1);
}
console.log(`renamed=${result.oldSlug} to=${result.newSlug} relatedUpdated=${result.relatedUpdated.length}`);
