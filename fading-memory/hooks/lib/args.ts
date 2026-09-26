/** list / maintain スキルのスクリプトが受け取る引数 */
export interface TargetArgs {
  projectDir: string;
  all: boolean;
}

/**
 * `[projectDir] [--all]` を解釈する。SKILL.md は --all をパスの前後どちらに置いても渡しうるため、位置に依存せず取り出す。
 * projectDir が無ければ従来どおり cwd をプロジェクトとみなす
 */
export function parseTargetArgs(args: string[], cwd: string = process.cwd()): TargetArgs {
  return {
    projectDir: args.find((a) => a !== "--all") ?? cwd,
    all: args.includes("--all"),
  };
}
