# ロジックレビュー結果（reviewer-for-logic）

## src/inventory-allocator.ts

### ✅ 良い点

- `allocate` 内で `stock.get(req.sku)` が見つからない場合に `shortfall: req.quantity` として早期 `continue` しており、不変条件（未引当のまま `reserved` を触らない）が保たれている点は良好です。
- `releaseReservation` は `Math.max(0, item.reserved - quantity)` で `reserved` が負値に落ち込まないよう防御しており、単体では堅実な実装です。
- `sortRestockPlans` は `[...plans]` でコピーしてから `sort` しており、引数の破壊的変更を避ける意識が見えます（ただし後述のとおり `allocate` 側では同じ配慮が漏れています）。

### [5] 必須修正 (ブロッカー)

**問題**: `SKU_PATTERN` に `g` フラグが追加され、`RegExp.prototype.test()` を使う `isValidSku` がステートフルになっている。

**理由**: `g`（または `y`）フラグ付きの正規表現オブジェクトで `.test()` を呼ぶと、マッチ成功時に `lastIndex` がマッチ末尾位置まで進み、次回の `.test()` 呼び出しはその位置から検索を再開します。同じ有効な SKU 文字列（例: `"AB-1234"`）に対して連続で `isValidSku` を呼ぶと、

- 1回目: `lastIndex=0` から検索 → マッチ成功、`true`、`lastIndex` が7（文字列末尾）に進む
- 2回目: `lastIndex=7` から検索 → 残り文字列がないためマッチ失敗、`false`、`lastIndex` は0にリセット
- 3回目: 再び `true`...

という具合に、同じ入力に対して呼び出しごとに `true`/`false` が交互に反転します。バリデーション関数が呼び出し履歴に依存して結果を変えるのは明確な不具合で、複数リクエストを順にバリデーションするような用途（本来 `isValidSku` が想定する使われ方）では確実に誤判定が発生します。

**提案**:
```typescript
// test() のみで使うなら g フラグは不要（不要な状態を持たせない）
const SKU_PATTERN = /^[A-Z]{2}-\d{4}$/

export const isValidSku = (sku: string): boolean => {
  return SKU_PATTERN.test(sku)
}
```

### [5] 必須修正 (ブロッカー)

**問題**: `sortRestockPlans` の比較関数が `Number(a.expectedAt > b.expectedAt)` となっており、`0` か `1` しか返さず負の値を返すことがない。

**理由**: `Array.prototype.sort` の比較関数は「`a` を先にすべきとき負値」「等しいとき0」「`b` を先にすべきとき正値」を返す契約になっています。この実装は `a.expectedAt < b.expectedAt`（`a` を先にすべきケース）でも `0` を返すため、"等しい（並べ替え不要）" と誤って伝えてしまいます。

具体的には、V8 は要素数が少ない配列（目安として10要素以下）に対して二分挿入ソートを使い、挿入位置を `compare(new, sorted[mid]) < 0` の判定で二分探索します。この比較関数は負値を一切返さないため、この判定は常に `false` となり、二分探索は常に「現在位置に挿入（＝移動不要）」と結論します。結果として **入力配列がほぼそのままの順序で返り、実質的にソートされません**。復元計画の一覧のような小規模配列（典型的なユースケース）でこの関数を使うと、期待される昇順ソートが機能しない可能性が高いです。

**提案**:
```typescript
export const sortRestockPlans = (plans: RestockPlan[]): RestockPlan[] => {
  return [...plans].sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
}
```

### [4] 強く推奨

（該当なし）

### [3] 推奨

**問題**: `allocate` が引数 `requests` を `.sort()` でその場（in-place）にソートしており、呼び出し元が渡した配列そのものを書き換えてしまう。

**理由**: `Array.prototype.sort()` は破壊的で、戻り値は元の配列と同一参照です。`const ordered = requests.sort(...)` は `ordered === requests` となり、呼び出し元が引き当て後も元の順序で `requests` を使い回すことを期待していた場合に意図しない並び替えが起きます。同ファイル内の `sortRestockPlans` は `[...plans]` でコピーしてから `sort` しており、対称的な関数間で扱いが不統一になっている点からも、これは意図的な仕様というより実装漏れの可能性が高いです。

**提案**:
```typescript
export const allocate = (
  requests: AllocationRequest[],
  stock: Map<string, StockItem>,
): AllocationResult[] => {
  const ordered = [...requests].sort((a, b) => b.priority - a.priority)
  // ...
}
```

**問題**: `allocate` / `releaseReservation` のどちらも `quantity` の非負性や、在庫データの整合性（`reserved <= available`）を検証していない。

**理由**: `allocate` では `free = item.available - item.reserved`、`allocated = Math.min(free, req.quantity)` を計算していますが、
- `req.quantity` が負値の場合、`allocated` も負値になり得て `item.reserved += allocated` が `reserved` を不正に減算してしまいます（`releaseReservation` を経由しない在庫の巻き戻り）。
- 何らかの理由で `item.available < item.reserved`（棚卸し差異や別経路でのデータ不整合）だった場合、`free` が負値となり、同様に `allocated` が負値になって `shortfall = req.quantity - allocated` が要求数量より大きい値として算出されます。

同様に `releaseReservation(stock, sku, quantity)` も `quantity` が負値の場合、`item.reserved - quantity` は加算方向に働き、「解放」のはずの呼び出しが逆に予約数を増やしてしまいます。

いずれも呼び出し元で正の値のみが渡される前提であれば発現しませんが、その前提はこのファイル内では保証されていません。

**提案**:
```typescript
const free = Math.max(0, item.available - item.reserved)
const allocated = Math.max(0, Math.min(free, req.quantity))
```
```typescript
export const releaseReservation = (
  stock: Map<string, StockItem>,
  sku: string,
  quantity: number,
): void => {
  const item = stock.get(sku)
  if (!item || quantity <= 0) {
    return
  }
  item.reserved = Math.max(0, item.reserved - quantity)
}
```

### [2] 軽微

**問題**: `markLowStock` は既に `'low-stock'` タグが付与済みかどうかを確認せず `push` している。

**理由**: 同じ `snapshot` に対して `markLowStock` を複数回呼んだり（例: 閾値を変えて再評価する場合）、既に `'low-stock'` が付いたスナップショットを渡したりすると、同じタグが重複して蓄積されます。実害は軽微ですが、タグの重複はダウンストリームでの `includes` 判定や表示に無駄なノイズを生みます。

**提案**:
```typescript
export const markLowStock = (snapshot: StockItem[], threshold: number): StockItem[] => {
  for (const item of snapshot) {
    if (item.available - item.reserved < threshold && !item.tags.includes('low-stock')) {
      item.tags.push('low-stock')
    }
  }
  return snapshot
}
```

### [1] 情報

- `totalShortfall` は単純な `reduce` で、境界値（空配列で `0` を返す）も含めて問題は見当たりません。
- `allocate` のアルゴリズム全体（`sort` + 1パスのループ + `Map` ルックアップ）は O(n log n) で、大量データに対しても妥当な計算量です。N+1 的な問題は見当たりません。
- `SKU_PATTERN` の変更と `allocate` 系関数の追加は同一コミットに混在していますが、`allocate` は `isValidSku` を一切呼び出していません。仕様上フォーマット不正な SKU が要求に含まれることを許容する設計であれば問題ありませんが、意図的でなければ `req.sku` のフォーマット検証を呼び出し元 or `allocate` 内で行うことも検討の余地があります（バリデーション自体は今回の主眼ではないため参考情報として記載）。

## 📚 参考情報
- `RegExp.prototype.test()` と `g`/`y` フラグによる `lastIndex` の副作用: MDN "RegExp.prototype.exec()" および "test()" の解説（"regex with global flag" の落とし穴として広く知られるパターン）
- `Array.prototype.sort()` の比較関数契約（負値/0/正値を返す必要がある）: MDN "Array.prototype.sort()" — 一貫性のない比較関数は仕様上「結果が保証されない」と明記されています
