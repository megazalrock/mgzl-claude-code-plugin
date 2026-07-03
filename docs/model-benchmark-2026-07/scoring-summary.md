# モデル比較ベンチマーク 採点サマリ（ラウンド1+2）

実施日: 2026-07-03
方式: 既知バグ埋め込みフィクスチャを sonnet / opus の同一プロンプトのレビュアーサブエージェントに与え、検出率・誤検出・severity 較正を採点

## ラウンド1（素直なバグ・JSDoc矛盾のヒントあり / reviewer-for-logic）

| フィクスチャ | 行数 | sonnet | opus |
|---|---|---|---|
| small (date-range) | 30 | 3/3 | 3/3 |
| medium (order-service) | 74 | 5/5 | 5/5 |
| large (report-generator) | 177 | 5/6 +部分1 (L1) | 6/6 |

- 誤検出: 両モデル 0
- 両モデルとも未埋め込みの実バグ（USD換算後の¥表記）を自力検出
- severity較正: opus は12/12期待レンジ内。sonnet は small 3件を全て[5]に過大評価

## ラウンド2（hard: ヒントなし・推論必須のバグ）

### reviewer-for-logic

| フィクスチャ | 行数 | sonnet | opus |
|---|---|---|---|
| hard-medium (inventory-allocator) | 71 | 4/5（HM4完全見逃し） | 5/5 |
| hard-large (usage-billing) | 128 | 5/6（HL1は[1]で言及のみ） | 6/6（HL1は[2]と過小） |

- sonnet の見逃し HM4: snapshotStock の浅いコピーで tags 配列共有 → markLowStock が元データ汚染。sonnet は markLowStock の冪等性([2])だけ指摘し、参照共有による元データ汚染には気づかず
- HM5（負の free 未クランプ）は両モデルとも[3]と期待([4]〜[5])より過小
- HL1（UTC日付境界）は両モデルとも言及はしたが severity 過小（sonnet[1] / opus[2]）

### reviewer-for-comments

| フィクスチャ | 行数 | sonnet | opus |
|---|---|---|---|
| comments-medium (retry-client) | 58 | 6/7（CM2見逃し） | 7/7 |
| comments-large (export-pipeline) | 131 | 9/9 | 9/9 (+境界例1) |

- sonnet の見逃し CM2: JSDoc「指数バックオフ」vs 実装は線形。さらに CM1 の修正提案文の中に「指数バックオフで再試行し」という誤った記述をそのまま温存した
- 両モデルとも「指摘してはいけない正当コメント」(postOnce, UUID v4等) は正しくスルー
- opus は formatCsvRow の RFC 4180 コメント（正解データ上は正当扱い）を [3] で指摘。ただし「改行を含む値のクォート未対応なのに準拠を主張」という理屈は事実として正しく、誤検出とは断定できない境界例

## 実行時間・トークン（全14run、opus が全ペアで高速・省トークン）

| run | sonnet | opus |
|---|---|---|
| R1 small | 132s / 45,780 | 87s / 33,801 |
| R1 medium | 189s / 50,987 | 108s / 36,084 |
| R1 large | 214s / 56,469 | 171s / 41,917 |
| R2 hard-medium | 228s / 55,371 | 131s / 38,939 |
| R2 hard-large | 207s / 53,201 | 170s / 41,554 |
| R2 comments-medium | 106s / 47,435 | 94s / 37,996 |
| R2 comments-large | 194s / 58,421 | 186s / 45,547 |

## ラウンド3（hard-small: 50行未満 × hard）

### reviewer-for-logic

| フィクスチャ | 行数 | sonnet | opus |
|---|---|---|---|
| hard-small (activity-feed) | 36 | 4/4 | 4/4 |

- 両モデルとも await漏れ(catch不能)[5]、`\|\|`の0既定値化け[4]、replace先頭のみ、slice(-0) を完全検出
- severity: sonnet は HS1(replace) を期待通り[4]、opus は[3]とやや過小
- 誤検出: 両モデル 0

### reviewer-for-comments

| フィクスチャ | 行数 | sonnet | opus |
|---|---|---|---|
| comments-small (member-cache) | 44 | **5/5** | **4/5** |

- **初めて sonnet が opus を上回った**。opus は CS5（「会員」vs「ユーザー」の用語不統一）を見逃した上、当該コメントを「良い点」として賞賛
- CS1(5分vs10分の単位計算)・CS2(@throws vs null)・CS3(片側toLowerCase)・CS4(死んだTODO) は両モデル検出
- 誤検出: 両モデル 0

### 実行時間・トークン（ラウンド3）

| run | sonnet | opus |
|---|---|---|
| hard-small | 129s / 45,268 | 134s / 37,378 |
| comments-small | 160s / 51,119 | 108s / 37,919 |

## 総合結論（全3ラウンド・18run）

行数帯域別の検出成績（sonnet / opus）:

| 帯域 | easy (R1) | hard (R2/R3) |
|---|---|---|
| <50行 | 3/3 = 3/3 | logic 4/4 = 4/4、comments **5/5 > 4/5** |
| 50〜99行 | 5/5 = 5/5 | logic **4/5 < 5/5**、comments **6/7 < 7/7** |
| ≥100行 | 5/6+部分 < 6/6 | logic 5/6 < 6/6、comments 9/9 = 9/9 |

- sonnet の完全見逃し（HM4, CM2, R1のL1独立指摘漏れ）は**すべて50行以上**で発生
- opus の唯一の見逃し（CS5）は44行の小型差分で発生
- → **「50行未満は sonnet、50行以上は opus」という現行閾値は、この n=1 ベンチマークの範囲では帯域ごとの成績と正確に整合する**
- opus は18run中16runで省トークン（約2〜3割減）。実行時間もほぼ全ペアで同等以下
- 限界: 各条件 n=1（分散未測定）、単一ファイル差分のみ、正解データが自作
