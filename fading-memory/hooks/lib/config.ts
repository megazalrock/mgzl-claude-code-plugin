/** fading-memory の動作定数。寿命計算・trash 保持・headless モデルをここに集約する */
export const config = {
  // 明示的に remember された記憶は自動抽出より長く index に残す
  // #63: 旧値(auto 15日)では busy なプロジェクト(arrangement-env/front)で index 常駐が約230件に膨張し、
  // 大半が score 0 のままだった。score 1 化した記憶の実測では約87%が作成から10日以内に有効判定されており、
  // auto 10日は有効になる記憶の取りこぼしを抑えつつ index を約6割に縮小できる。manual は auto の2倍を維持
  baseTtlDays: { auto: 10, manual: 20 },
  perScoreDays: 7,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
  // 抽出プロンプトへ埋め込む会話本文の上限。トランスクリプト全文（数 MB）を子に読ませると
  // 読み取りループだけでタイムアウトするため、ここで前処理側の予算を固定する
  transcriptMaxBytes: 200 * 1024,
  // 重複記憶の判定閾値。issue #54 の評価実験（typesafe/eval/memory-dedup。削除済みのため git 履歴を参照）の実測から導いた値で、
  // none 確率と confidence の分布を見て「迷いなく新規」「迷いなく重複」を切り出している
  dedup: {
    // none 確率がこれ以上なら新規
    newAbove: 0.45,
    // none 確率がこれ以下かつ confidence 以上なら重複
    duplicateBelow: 0.3,
    duplicateMinConfidence: 0.55,
    // Claude に提示する候補の足切り確率と件数
    candidateMinProbability: 0.02,
    maxCandidates: 3,
    // criteria が数十件になると既定の 3 秒では応答が返りきらない
    timeoutMs: 15000,
    // 1 質問あたりの criteria 上限。none を足して 255 に収まる値。
    // 255 は https://docs.typesafe.ai/primitives/choice の
    // "A Choice question accepts up to 255 options" が根拠
    // （1 リクエストあたりの質問数と本文サイズの上限は docs に記載が無く未確認）
    maxCriteriaPerQuestion: 254,
  },
} as const;
// as const は定数オブジェクトのリテラル型固定のためで、型の偽装ではない

export type FadingMemoryConfig = typeof config;
