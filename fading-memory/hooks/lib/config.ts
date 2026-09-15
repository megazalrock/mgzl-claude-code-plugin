/** fading-memory の動作定数。寿命計算・trash 保持・headless モデルをここに集約する */
export const config = {
  baseTtlDays: 30,
  perScoreDays: 7,
  maxExtensionDays: 120,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
  // 抽出プロンプトへ埋め込む会話本文の上限。トランスクリプト全文（数 MB）を子に読ませると
  // 読み取りループだけでタイムアウトするため、ここで前処理側の予算を固定する
  transcriptMaxBytes: 200 * 1024,
} as const;
// as const は定数オブジェクトのリテラル型固定のためで、型の偽装ではない

export type FadingMemoryConfig = typeof config;
