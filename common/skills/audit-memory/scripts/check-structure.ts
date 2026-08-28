import { runCheck } from "./lib/run.ts";

/** `--project-dir <path>` を取り出す。無ければ null */
function projectDirArg(argv: string[]): string | null {
  const i = argv.indexOf("--project-dir");
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

const projectDir = projectDirArg(process.argv.slice(2));
if (projectDir === null) {
  console.log("error=missing_project_dir detail=--project-dir <path> を指定してください");
  process.exit(1);
}

// Bun.YAML は bun 1.2.21 で追加された。古い bun では parse が丸ごと失敗して全件 frontmatter_unparsable に見えるため、先に検出する
if (typeof Bun.YAML?.parse !== "function") {
  console.log("error=bun_too_old detail=Bun.YAML が使えません。bun 1.2.21 以降に更新してください");
  process.exit(1);
}

const result = runCheck(projectDir);
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
