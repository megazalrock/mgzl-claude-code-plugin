import { readFileSync, writeFileSync } from "node:fs";
import { renderIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const paths = dataPaths(process.cwd());
ensureDirs(paths);
writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories));

let state: Record<string, unknown> = {};
try {
  const parsed: unknown = JSON.parse(readFileSync(paths.stateFile, "utf8"));
  if (typeof parsed === "object" && parsed !== null) {
    state = parsed as Record<string, unknown>;
    // as は既存 state の任意キーを保持したまま上書きするためだけに使用
  }
} catch {
  // state.json が無い・壊れている場合は作り直す
}
state["lastMaintainedAt"] = new Date().toISOString();
writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log("finalized=true");
