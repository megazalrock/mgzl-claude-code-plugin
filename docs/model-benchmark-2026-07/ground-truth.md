# 埋め込みバグの正解データ（レビュアーには渡さない）

## small.diff — date-range.ts（30行）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| S1 | isWithinRange | JSDoc は「両端を含む」だが `<=` → `<` に変更され end が排他的になった | [4]〜[5] |
| S2 | totalDurationMs | `reduce` に初期値なし → 空配列で TypeError | [4] |
| S3 | splitIntoChunks | chunkMs が 0 以下だと cursor が進まず無限ループ | [3]〜[4] |

## medium.diff — order-service.ts（74行）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| M1 | isValidQuantity | `quantity >= 1 \|\| quantity <= 100` → 常に true（&& であるべき） | [5] |
| M2 | calculateTotal | `order.discount.rate` — discount は optional。未定義で TypeError | [5] |
| M3 | fetchOrderDetails | ループ内 await で1件ずつ取得。最大500件の N+1 | [4]〜[5] |
| M4 | confirmOrder | `catch (e: any)` — プロジェクト規約（unknown + AxiosError narrowing + Bugsnag）違反 | [3]〜[4] |
| M5 | cancelOrder | writeAuditLog を await も .catch もせず fire-and-forget → unhandled rejection | [3]〜[4] |

## large.diff — report-generator.ts（177行）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| L1 | parseCsvRow | parseFloat の NaN 未検証・列欠損時 undefined → 集計に NaN 伝播 | [3]〜[4] |
| L2 | paginate | `Math.floor` → 端数ページが totalPages から欠落（ceil であるべき） | [4]〜[5] |
| L3 | filterByCategories | 10万件 × 数千件の `includes` で O(n×m)（Set にすべき） | [3]〜[4] |
| L4 | summarizeByCategory | `if (!r.amount)` で 0 円レコード（無償提供）が count から漏れる | [4] |
| L5 | enrichWithUsdAmount | JSDoc「失敗した場合は全体を失敗させる想定」に反し catch で握りつぶし、未換算の円が USD に混入 | [4]〜[5] |
| L6 | nextStatus | JSDoc に「generating は fail で failed へ」とあるが分岐が欠落。failed に到達不能 | [4]〜[5] |

## 採点基準

- **検出**: 指摘が該当箇所・該当原因を正しく指していれば検出とみなす（severity は別評価）
- **誤検出**: 埋め込みバグに該当しない [3] 以上の指摘のうち、実際には問題と言えないもの
- **正当な追加指摘**: 埋め込み以外でも実際に妥当な指摘は誤検出に数えない（別枠で記録）
