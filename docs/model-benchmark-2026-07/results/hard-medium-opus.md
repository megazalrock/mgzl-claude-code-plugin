# ロジックレビュー結果（reviewer-for-logic）

## inventory-allocator.ts

### ✅ 良い点

- `allocate` が `stock.get(req.sku)` の未ヒット（在庫マスタに存在しない SKU）を早期 return せず、`allocated: 0, shortfall: req.quantity` として結果に含めており、欠品ケースを取りこぼさず表現できている点は良い設計です。
- `releaseReservation` が `Math.max(0, item.reserved - quantity)` で `reserved` の負数化を防いでおり、過剰リリースに対して防御的です。
- `snapshotStock` がトップレベルオブジェクトをスプレッドでコピーし、スナップショットを分離しようとする意図が明確です（ただし後述の [4] の問題あり）。

---

### [5] 必須修正 (ブロッカー)

**問題**: `isValidSku` が参照する正規表現に `g`（グローバル）フラグが付与された（`/^[A-Z]{2}-\d{4}$/` → `/^[A-Z]{2}-\d{4}$/g`）。モジュールスコープの単一インスタンスを `.test()` で使い回すため、呼び出しごとに結果が変わります。

**理由**: `g` フラグ付き正規表現は `.test()` 実行時に `lastIndex` を更新して状態を持ちます。`SKU_PATTERN` はモジュールレベルで共有される単一インスタンスなので、同一入力に対して結果が交互に true / false と揺れます。

- 1回目 `isValidSku('AB-1234')` → マッチ成功、`lastIndex` が末尾（7）へ前進 → `true`
- 2回目 `isValidSku('AB-1234')` → `lastIndex=7` から `^…$` を評価 → マッチせず、`lastIndex` を 0 にリセット → `false`
- 3回目 → 再び `true`

同じ有効な SKU でもバリデーションが通ったり通らなかったりし、在庫引き当てや入力検証の判定が非決定的に壊れます。本番で断続的に「正しい SKU が弾かれる」という再現困難な不具合を生みます。

**提案**:
```typescript
// g フラグを外す（.test() での使い回しはステートレスであるべき）
const SKU_PATTERN = /^[A-Z]{2}-\d{4}$/

export const isValidSku = (sku: string): boolean => {
  return SKU_PATTERN.test(sku)
}
// もしくは呼び出しごとに new RegExp を生成する／lastIndex を毎回リセットする
```

---

### [5] 必須修正 (ブロッカー)

**問題**: `sortRestockPlans` の比較関数 `(a, b) => Number(a.expectedAt > b.expectedAt)` が負値を返さないため、`expectedAt` 昇順ソートが正しく成立しません。

**理由**: `Array.prototype.sort` の比較関数は「a<b で負」「a==b で 0」「a>b で正」を返す契約です。本実装は `Number(a.expectedAt > b.expectedAt)` により `0` または `1` しか返さず、`a < b`（a の方が早い日付）のケースを常に `0`（＝等価）と誤って扱います。その結果、要素数が 3 以上のとき挿入位置の判定が破綻し、ソート結果が入力順や実行エンジン依存で不正になります。

例: `expectedAt` の値が `[3日, 1日, 2日]` のとき、期待は `[1日, 2日, 3日]` ですが、`1日 < 3日` の比較が `0`（等価）と判定されるため `1日` が `3日` の後ろに残り、昇順に並びません。「入荷予定が早い順に処理する」という関数本来の目的が達成されず、後続処理が誤った順序で走ります。

**提案**:
```typescript
export const sortRestockPlans = (plans: RestockPlan[]): RestockPlan[] => {
  // Date 同士は数値差で比較する（負/0/正 を正しく返す）
  return [...plans].sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
}
```

---

### [4] 強く推奨

**問題**: `snapshotStock` の浅いコピー `{ ...item }` は `tags` 配列を「参照ごと」共有するため、`markLowStock` の `item.tags.push('low-stock')` が元の `stock` 内 `StockItem.tags` まで汚染します。スナップショットが実質的に分離できていません。

**理由**: スプレッド `{ ...item }` はトップレベルのプロパティのみコピーし、`tags`（配列）は同一参照のままです。`markLowStock(snapshot, threshold)` は `item.tags` へ破壊的に `push` するので、スナップショット経由で元の在庫マップの `tags` にも `'low-stock'` が追加されます。「スナップショットを取って加工しても元データは不変」という利用者の想定を破り、在庫マスタが意図せず書き換わります。

**提案**:
```typescript
export const snapshotStock = (stock: Map<string, StockItem>): StockItem[] => {
  const snapshot: StockItem[] = []
  for (const item of stock.values()) {
    // tags 配列も複製し、元データとの参照共有を断つ
    snapshot.push({ ...item, tags: [...item.tags] })
  }
  return snapshot
}
```

---

### [3] 推奨

**問題**: `allocate` の `const ordered = requests.sort(...)` が呼び出し元の `requests` 配列を破壊的に並べ替えます（`Array.prototype.sort` は in-place）。

**理由**: `sort` はコピーを返さず引数配列自体を並べ替えるため、呼び出し元が保持する `requests` の順序が priority 降順に書き換わります。同一ファイル内の `sortRestockPlans` が `[...plans].sort(...)` で明示的にコピーしているのと不整合で、呼び出し元が元の順序に依存している場合に予期しない不具合を生みます。

**提案**:
```typescript
const ordered = [...requests].sort((a, b) => b.priority - a.priority)
```

---

### [3] 推奨

**問題**: `allocate` の `const free = item.available - item.reserved` が、`reserved > available`（過剰予約状態）のとき負値になり、`allocated` が負数・`shortfall` が要求量超過という不正な結果を生みます。

**理由**: `free` が負のとき `allocated = Math.min(free, req.quantity)` は負値（`free`）を採用します。すると `item.reserved += allocated` で `reserved` が減少し、`shortfall = req.quantity - allocated` は `quantity + |free|` と要求量を上回ります。「負の引き当て」「要求量を超える欠品数」はいずれも在庫ロジック上あり得ない値で、下流の `totalShortfall` 集計なども歪みます。過剰予約は初期データや並行処理・リリース漏れで現実的に起こり得ます。

**提案**:
```typescript
const free = Math.max(0, item.available - item.reserved)
const allocated = Math.min(free, Math.max(0, req.quantity))
```

---

### [3] 推奨

**問題**: `markLowStock` は冪等性がなく、同一スナップショットに対して複数回呼ぶと `'low-stock'` タグが重複して積み上がります。

**理由**: `item.tags.push('low-stock')` は既存タグを確認しないため、再評価のたびに `['low-stock', 'low-stock', ...]` と重複が増えます。タグ集合を前提とした後続処理（フィルタ・件数集計・表示）で重複が悪影響を及ぼす可能性があります。

**提案**:
```typescript
if (item.available - item.reserved < threshold && !item.tags.includes('low-stock')) {
  item.tags.push('low-stock')
}
```

---

### [2] 軽微

**問題**: `releaseReservation` は未知の SKU を無言で `return` します。

**理由**: 存在しない SKU に対するリリースは呼び出し側のバグの兆候である可能性がありますが、現状は完全に握り潰されます。壊れる挙動ではないため軽微ですが、デバッグ容易性の観点で検知手段があると望ましいです。

**提案**: 少なくとも呼び出し規約をコメントで明示するか、必要ならログ/戻り値で「対象なし」を伝えることを検討してください。

---

### [1] 情報

- `allocate` は同一 SKU を持つ複数リクエストに対し、`item.reserved` を逐次加算することで 2 件目以降の `free` を正しく減算しており、逐次引き当ての振る舞いとしては妥当です（意図通りかは確認推奨）。
- 本レビューは差分の該当関数群に限定しています。`allocate` の priority 同値時の順序（安定ソート依存）や、`AllocationRequest.quantity` に負値が渡るケースの入力バリデーション有無は、呼び出し側の契約に依存するため要件確認を推奨します。

## 📚 参考情報

- MDN: [`RegExp.prototype.test()` と `lastIndex`（`g`/`y` フラグ利用時の状態保持）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/test)
- MDN: [`Array.prototype.sort()` の比較関数コントラクト（負/0/正 を返す）](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort)
