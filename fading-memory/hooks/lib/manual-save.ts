import { writeFileSync } from "node:fs";
import { applyExtraction, parseExtractionResult } from "./extraction.ts";
import { renderIndex } from "./index-gen.ts";
import { ensureDirs, loadMemories } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

export interface ManualSaveOptions {
  /** 作成・更新する記憶を permanent（期限なし）にするか */
  permanent: boolean;
}

/** スクリプトがそのまま標準出力・終了コードに流せる形の結果 */
export interface ManualSaveResult {
  exitCode: number;
  /** 成功時は stdout、失敗時は stderr へ出す key=value 行 */
  lines: string[];
}

/**
 * remember 系スキルの保存スクリプトが共有する手動保存フロー。
 * stdin のテキストを検証して記憶を書き込み、目次を再生成する。
 */
export function saveManualMemories(
  projectDir: string,
  stdinText: string,
  options: ManualSaveOptions,
): ManualSaveResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdinText);
  } catch {
    return { exitCode: 1, lines: ["error=invalid-json"] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { exitCode: 1, lines: ["error=invalid-input"] };
  }

  // score 加点はセッションから抽出した「実際に役立った記憶」だけに与える指標なので、
  // 手動保存の経路では入力に何が来ても加点対象を空にする
  const normalized = { ...parsed, usefulMemorySlugs: [] };

  // slug の kebab-case 検査や title/related の frontmatter インジェクション対策を
  // 抽出経路と共有するため、一度 JSON へ戻して同じパーサに通す
  const result = parseExtractionResult(JSON.stringify(normalized));
  if (result === null) {
    return { exitCode: 1, lines: ["error=invalid-input"] };
  }

  const paths = dataPaths(projectDir);
  ensureDirs(paths);
  const report = applyExtraction(paths, result, new Date().toISOString(), "manual", {
    permanent: options.permanent,
  });

  // state.json の lastMaintainedAt はメンテナンス実施の記録なのでここでは触らない
  writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories, Date.now()));

  return {
    exitCode: 0,
    lines: [
      ...report.created.map((slug) => `created=${slug}`),
      ...report.updated.map((slug) => `updated=${slug}`),
      ...report.skipped.map((slug) => `skipped=${slug}`),
    ],
  };
}

/** 保存結果を標準出力／標準エラーへ書き出し、終了コードに従ってプロセスを終える */
export function reportManualSave(result: ManualSaveResult): never {
  const write = result.exitCode === 0 ? console.log : console.error;
  for (const line of result.lines) write(line);
  process.exit(result.exitCode);
}
