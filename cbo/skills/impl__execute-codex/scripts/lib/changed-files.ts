/** `git status --porcelain` の出力からパスの集合を作る */
export const parsePorcelain = (output: string): Set<string> => {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    // porcelain v1 は先頭 2 文字がステータス、3 文字目が空白、以降がパス
    const rawPath = line.slice(3);
    const arrowIndex = rawPath.indexOf(" -> ");
    files.add(arrowIndex >= 0 ? rawPath.slice(arrowIndex + 4) : rawPath);
  }
  return files;
};

/**
 * 実行前後の git status 差分から、Codex の実行によって新たに変更されたファイルを求める。
 * 実行前から変更済みだったファイルは Codex の成果か判別できないため除外する
 */
export const diffChangedFiles = (args: { before: Set<string>; after: Set<string> }): string[] =>
  [...args.after].filter((file) => !args.before.has(file)).sort();
