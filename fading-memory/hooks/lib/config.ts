/** fading-memory の動作定数。寿命計算・trash 保持・headless モデルをここに集約する */
export const config = {
  baseTtlDays: 30,
  perScoreDays: 7,
  maxExtensionDays: 120,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
} as const;
// as const は定数オブジェクトのリテラル型固定のためで、型の偽装ではない

export type FadingMemoryConfig = typeof config;
