# ラウンド2: 埋め込みバグ・欠陥の正解データ（レビュアーには渡さない）

ラウンド1との違い: JSDoc と実装の矛盾のような「答えのヒント」を排除し、
推論しないと見つからない性質のバグに限定した。

## hard-medium.diff — inventory-allocator.ts（71行 / reviewer-for-logic）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| HM1 | SKU_PATTERN / isValidSku | 正規表現に `g` フラグが追加された（v0にはない）。`test()` が lastIndex を保持し、同じ有効な SKU でも呼び出しごとに true/false が交互になる | [4]〜[5] |
| HM2 | allocate | `requests.sort(...)` が呼び出し元の配列を破壊的に並べ替える（コピーせず sort） | [3]〜[4] |
| HM3 | sortRestockPlans | コンパレータが `Number(a > b)` で 0/1 しか返さず -1 を返さない → ソート結果が不正・不安定 | [4] |
| HM4 | snapshotStock + markLowStock | スプレッドは浅いコピーで `tags` 配列を共有 → markLowStock が元の在庫データの tags を汚染し、繰り返しで 'low-stock' が蓄積 | [4]〜[5] |
| HM5 | allocate | `free`（available - reserved）が負のとき（過剰予約状態）、`Math.min(free, qty)` が負を返し reserved が減少・allocated が負になる。0 でのクランプ欠如 | [4]〜[5] |

## hard-large.diff — usage-billing.ts（128行 / reviewer-for-logic）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| HL1 | groupByDay | `toISOString().slice(0,10)` で UTC 基準の日付キーに集約。円建て・ja-JP の日本向け課金なのに JST の 0:00〜8:59 のイベントが前日に計上される | [3]〜[4] |
| HL2 | removeCancelledEvents | ループ内 `splice` でインデックスを進める → 削除直後の要素がスキップされ、連続するキャンセル対象が残る。加えて入力配列を破壊 | [4]〜[5] |
| HL3 | rateForVolume | `Object.keys().sort()` が辞書順ソート（'0','100','2000','500'）→ 2000 units 以上で 500 のレートが後勝ちし誤った単価 0.65 が適用される | [4]〜[5] |
| HL4 | buildInvoice | 明細は行ごとに Math.round、合計は未丸め合算後に Math.round → 明細の合計と total が一致しないことがある | [3]〜[4] |
| HL5 | sumUnitsForUsers | `forEach(async ...)` は完了を待たない → 常に 0 を返す | [5] |
| HL6 | accumulateWindows | `?? EMPTY_WINDOW` でモジュールレベルの共有オブジェクトをそのまま使い破壊的に更新 → 全ユーザーが同一オブジェクトを共有し集計が混ざる・呼び出し間で状態が残留 | [5] |

## comments-medium.diff — retry-client.ts（58行 / reviewer-for-comments）

| ID | 箇所 | 欠陥内容 | 期待severity |
|----|------|---------|-------------|
| CM1 | fetchWithRetry JSDoc | 「見つからない場合は null を返す」と記載だが実装は NotFoundError を throw（誤解を招くコメント） | [4] |
| CM2 | fetchWithRetry JSDoc | 「指数バックオフ」と記載だが実装は `baseDelayMs * attempt` の線形バックオフ | [4] |
| CM3 | fetchWithRetry JSDoc | `@param options.timeoutMs` — 実際のフィールド名は `timeoutSeconds`（名前と単位が不一致） | [4] |
| CM4 | catch 内 | `// カウンタをインクリメント` — コードの直訳で無価値（冗長コメント） | [3] |
| CM5 | catch 内 | 「parseRetryAfter() に委ねる」— そのような関数は存在しない（参照切れ） | [4] |
| CM6 | catch 内 | `// const legacyDelay = 3000` — コメントアウトされたコード | [3] |
| CM7 | RETRYABLE_STATUS | 「〜に関しては」「〜という形で」を含む冗長な一文（60字超・日本語可読性） | [3] |

正当コメント（指摘してはいけない）: postOnce の JSDoc（実装と一致する why コメント）

## comments-large.diff — export-pipeline.ts（131行 / reviewer-for-comments）

| ID | 箇所 | 欠陥内容 | 期待severity |
|----|------|---------|-------------|
| CL1 | selectExportTargets JSDoc | 「アーカイブ済みは除外」だが実装は `filter((r) => r.archived)` でアーカイブ済み**のみ**返す（真逆） | [4] |
| CL2 | POLL_INTERVAL | 「ポーリング間隔（ミリ秒）」だが値 5 は `* 1000` して使われており実際は秒（単位の誤記） | [4] |
| CL3 | sortByCreatedAt JSDoc | 「昇順」と記載だが `b.localeCompare(a)` は降順 | [4] |
| CL4 | toCsv 上コメント | 「buildCsvRow() で行う」— 実際の関数名は formatCsvRow（リネーム追従漏れ） | [4] |
| CL5 | startExportJob 内 | `// レビュー指摘対応: LOGIC-3` — レビュー痕跡コメント | [4] |
| CL6 | waitForJob 内 | `// 🚀 fast path: ...` — 絵文字コメント | [3] |
| CL7 | summarize 内 | `// 結果を返す` — 冗長コメント | [3] |
| CL8 | exportToJson JSDoc | CSV エクスポートの説明のコピペ（JSON 実装と全く不一致） | [4] |
| CL9 | runExport JSDoc | ①②③ の丸数字を使用 | [3] |

正当コメント（指摘してはいけない）: DOWNLOAD_URL_TTL_MINUTES（whyコメント）、formatCsvRow の RFC 4180 コメント、JOB_ID_PATTERN の UUID v4 コメント

## 採点基準

ラウンド1と同じ。検出＝該当箇所・該当原因を正しく指摘。正当コメントへの指摘は誤検出として数える。
