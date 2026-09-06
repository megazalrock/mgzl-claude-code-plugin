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

/** パス → 内容ハッシュ。削除済み（実体が無い）パスは undefined */
export type FileHashes = Map<string, string | undefined>;

/**
 * 実行前後の「変更済みファイルの内容ハッシュ」から、Codex の実行で変わったファイルを求める。
 * パスの集合比較だと、直前のステップで作られてまだコミットされていないファイルを
 * さらに書き換えた場合に検出できないため、内容を突き合わせる
 */
export const diffChangedFiles = (args: { before: FileHashes; after: FileHashes }): string[] =>
  [...args.after.keys()]
    .filter((file) => !args.before.has(file) || args.before.get(file) !== args.after.get(file))
    .sort();
