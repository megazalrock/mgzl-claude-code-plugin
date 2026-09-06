/** 実験の比較条件を揃えるため、モデルと effort は呼び出し側から変更できない定数にしている */
export const CODEX_MODEL = "gpt-6-astra";
export const CODEX_EFFORT = "low";

/** テストで偽の codex に差し替えるための環境変数名 */
export const CODEX_BIN_ENV = "IMPL_EXECUTE_CODEX_BIN";

export const resolveCodexBin = (env: Record<string, string | undefined>): string[] => {
  const override = env[CODEX_BIN_ENV];
  if (override === undefined || override.trim() === "") {
    return ["codex"];
  }
  return override.trim().split(/\s+/);
};

export const buildExecArgs = (args: { cwd: string; lastMessageFile: string }): string[] => [
  "exec",
  "-m",
  CODEX_MODEL,
  "-c",
  `model_reasoning_effort=${CODEX_EFFORT}`,
  "-s",
  "workspace-write",
  "-C",
  args.cwd,
  "--skip-git-repo-check",
  // Codex 側の skills 探索を止め、渡したプロンプトだけで実装させる
  "--disable",
  "skill_search",
  "--json",
  "-o",
  args.lastMessageFile,
  // プロンプトは stdin から読ませる（長文を引数に載せない）
  "-",
];
