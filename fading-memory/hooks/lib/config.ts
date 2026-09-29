/** fading-memory の動作定数。寿命計算・trash 保持・headless モデル・slug の長さ上限をここに集約する */
export const config = {
  // 明示的に remember された記憶は自動抽出より長く index に残す
  // #63: 旧値(auto 15日)では busy なプロジェクト(arrangement-env/front)で index 常駐が約230件に膨張し、
  // 大半が score 0 のままだった。score 1 化した記憶の実測では約87%が作成から10日以内に有効判定されており、
  // auto 10日は有効になる記憶の取りこぼしを抑えつつ index を約6割に縮小できる。manual は auto の2倍を維持
  baseTtlDays: { auto: 10, manual: 20 },
  perScoreDays: 7,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
  // slug の長さ上限（生成目標）。SessionStart で注入する目次の各行が `- <slug>: <title>` のため、slug の長さがそのまま注入量になる（#65）。
  // 説明は title が担うので slug は識別子として足りる長さに抑える。
  // remember / remember-permanent の SKILL.md、抽出プロンプトはこの生成目標を文章で書いているので、変える場合はそちらも揃えること
  slug: {
    minWords: 2,
    maxWords: 4,
    maxLength: 30,
    // maintain がリネーム対象を選ぶ検出閾値（長さのみ）。生成目標と同じ30文字で検出すると、mgzl の既存記憶では58件中57件が該当してしまう。
    // 語数も条件に加えると、"in" のような短い単語で語数だけ膨らむ slug まで対象になってしまう
    // （実測(2026-09-29): 31文字・6語の slug を改名しても1文字しか縮まらない例があった）。
    // 45文字超に絞ると、mgzl 26/57件・約636文字、front 56/120件・約1,236文字の削減。40文字超と比べて、改名件数は約6割で削減量の約7割が得られる。
    // maintain の SKILL.md はこの数値を文章で書いているので、変える場合はそちらも揃えること
    rename: { maxLength: 45 },
  },
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
