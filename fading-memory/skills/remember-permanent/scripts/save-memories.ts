import { reportManualSave, saveManualMemories } from "../../../hooks/lib/manual-save.ts";

const projectDir = process.argv[2] ?? process.cwd();

reportManualSave(saveManualMemories(projectDir, await Bun.stdin.text(), { permanent: true }));
