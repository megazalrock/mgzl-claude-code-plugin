import { parseTargetArgs } from "../../../hooks/lib/args.ts";
import { expiresAt } from "../../../hooks/lib/expiry.ts";
import { selectTargets, sortForIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const { projectDir, all } = parseTargetArgs(process.argv.slice(2));

const paths = dataPaths(projectDir);
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

const now = Date.now();

// 出力行はすべて検証サブエージェントへ回るため、既定では index.md に載っている記憶だけに絞る。
// 退色した記憶まで含めるとサブエージェント数が膨らむ（issue #64）
for (const m of sortForIndex(selectTargets(memories, now, { all }))) {
  const exp = expiresAt(m.meta);
  const expires = exp === Infinity ? "never" : new Date(exp).toISOString();
  console.log(
    `slug=${m.slug} permanent=${m.meta.permanent} expires=${expires} file=${m.file} title=${m.meta.title}`,
  );
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
