# ロジックレビュー結果（reviewer-for-logic）

## src/order-service.ts

### ✅ 良い点

- 各メソッドに JSDoc で仕様（数量の許容範囲、割引の扱い、二重確定時の挙動、監査ログ失敗時の方針）が明記されており、実装意図と実コードを突き合わせやすくなっている。
- `confirmOrder` は二重確定（409）のケースを明示的に捕捉して `false` を返す設計になっており、重複トリガーへの配慮がされている。
- `validateOrder` は空配列の注文を明示的に弾いており、境界条件の一つを正しくケアできている。

### [5] 必須修正 (ブロッカー)

**問題**: `isValidQuantity` の条件式が `||` になっており、実質的にすべての数値（`NaN` 以外）を「有効」と判定してしまう。

**理由**: JSDoc では「数量は 1 以上 100 以下のみ有効」とあるが、実装は `quantity >= 1 || quantity <= 100` となっている。任意の実数は「1以上」か「100以下」の少なくとも一方を必ず満たす（両方を同時に満たさないのは `quantity < 1 かつ quantity > 100` の場合のみで、これは論理的に成立しない）ため、`0`、負数、`0.5`、`100000` などすべて `true` を返してしまう。結果として `validateOrder` の数量チェックが機能しておらず、不正な数量（マイナス個数や巨大な個数）を持つ注文がそのまま確定可能と判定されてしまう。さらに後続の `calculateTotal` の金額計算にも影響し、負の合計金額や桁違いの請求が発生し得る。

**提案**:
```typescript
isValidQuantity(quantity: number): boolean {
  return quantity >= 1 && quantity <= 100
}
```

### [5] 必須修正 (ブロッカー)

**問題**: `calculateTotal` が `order.discount.rate` に無条件でアクセスしており、`discount` が未設定の注文で例外が発生する。

**理由**: `Order.discount` は `discount?: Discount` と optional で定義されているにもかかわらず、`calculateTotal` は `order.discount.rate` と直接プロパティアクセスしている。`fetchOrder` / `fetchOrderDetails` で取得する既存注文の多くは割引情報を持たないと想定されるため、`discount` が `undefined` の注文に対して呼び出すと `TypeError: Cannot read properties of undefined (reading 'rate')` が発生し、合計金額の計算自体が失敗する。既存の呼び出し元との後方互換性を壊す破壊的な変更になっている。

**提案**:
```typescript
calculateTotal(order: Order): number {
  const subtotal = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const rate = order.discount?.rate ?? 0
  const discounted = subtotal * (1 - rate)
  return Math.round(discounted)
}
```

### [5] 必須修正 (ブロッカー)

**問題**: `fetchOrderDetails` が `orderIds` を `for...of` ループで1件ずつ `await axios.get` しており、典型的な N+1 になっている。

**理由**: JSDoc に「注文一覧画面の初期表示で呼ばれる」「最大 500 件になりうる」と明記されている通り、この関数はホットパスかつ大量データを前提としている。現状の実装は 500 件であれば 500 回の逐次 HTTP リクエストを直列に発行することになり、1リクエストあたり仮に 100ms でも初期表示に 50 秒程度かかる計算になる。初期表示のユーザー体験を著しく損なうだけでなく、サーバー側の負荷やタイムアウトの temperature リスクも高い。並列化（もしくは適切な同時実行数での分割）が必須。

**提案**:
```typescript
async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
  const responses = await Promise.all(
    orderIds.map((id) => axios.get(`${API_BASE}/orders/${id}`))
  )
  return responses.map((res) => res.data)
}
```
※ 500件を無制限に並列発行するとAPI側のレート制限に抵触する可能性があるため、必要であれば `p-limit` 等での同時実行数制御や、複数件をまとめて取得できるバルクAPIの利用も検討したい。

### [4] 強く推奨

**問題**: `confirmOrder` の catch 節が `catch (e: any)` になっており、`AxiosError` への型の絞り込みが行われていない。

**理由**: プロジェクトの規約では API エラーは `catch (e: unknown)` で受けて `instanceof AxiosError` で絞り込むことになっている。現状は `any` で受けているため、`e.response?.status` へのアクセスが型的に無検証のまま行われており、万一 `axios.post` 以外の要因（設定ミスやライブラリ内部のバグなど）で Axios 由来ではない例外が投げられた場合に、`e.response` が意図せず存在してしまうケースなどを静的に検出できない。プロジェクト標準に沿わせることで、非 Axios エラーの取りこぼしを型レベルで防げる。

**提案**:
```typescript
import type { AxiosError } from 'axios'

async confirmOrder(order: Order): Promise<boolean> {
  try {
    await axios.post(`${API_BASE}/orders/${order.id}/confirm`)
    return true
  } catch (e: unknown) {
    if (e instanceof AxiosError && e.response?.status === 409) {
      return false
    }
    throw e
  }
}
```

### [4] 強く推奨

**問題**: `cancelOrder` が `this.writeAuditLog(...)` を `await` も `catch` もせずに呼び出しており、監査ログ書き込み失敗時に意図した挙動（「本処理は止めない」）にならない。

**理由**: JSDoc の意図は「監査ログの記録失敗で本処理（キャンセル）は止めない」というフェイルセーフな設計だが、実装は `await` を付けずに `writeAuditLog` を呼んでいるだけなので、これは「本処理を止めない」のではなく「エラーハンドリングを放棄したまま非同期処理を投げっぱなしにする」実装になっている。`writeAuditLog` 内の `axios.post` が失敗すると、誰にも捕捉されない Promise の reject（unhandled rejection）が発生する。Node.js の実行環境によってはこれがプロセス全体をクラッシュさせたり、少なくとも意図せぬエラーログ／監視アラートを引き起こす。意図通りに「失敗を握りつぶしつつ本処理には影響させない」なら、明示的に `catch` して失敗を記録すべき。

**提案**:
```typescript
async cancelOrder(order: Order): Promise<void> {
  await axios.post(`${API_BASE}/orders/${order.id}/cancel`)
  try {
    await this.writeAuditLog(order.id, 'cancelled')
  } catch (e) {
    // 監査ログの失敗はキャンセル処理自体を失敗させないが、可観測性のため記録は残す
    console.error('failed to write audit log for order cancellation', order.id, e)
  }
}
```

### [3] 推奨

**問題**: `Discount.rate` の値域（0.0〜1.0）がどこでも検証されていない。

**理由**: `Discount` インターフェースのコメントには「割引率 0.0〜1.0」とあるが、`validateOrder` にも `calculateTotal` にもこの範囲を検証するロジックがない。`rate` が `1` を超える値であれば `calculateTotal` の結果が負の金額になり得るし、`rate` が負であれば割引のつもりが割増になってしまう。呼び出し元が必ず正しい値を渡す保証がない限り、境界チェックを入れておきたい。

**提案**:
```typescript
validateOrder(order: Order): boolean {
  if (order.items.length === 0) {
    return false
  }
  if (order.items.some((i) => !this.isValidQuantity(i.quantity))) {
    return false
  }
  if (order.discount && (order.discount.rate < 0 || order.discount.rate > 1)) {
    return false
  }
  return order.status === 'pending'
}
```

### [3] 推奨

**問題**: `fetchOrderDetails` は1件でもリクエストが失敗すると、それまでに取得できていた注文も含めて全件が失われるオールオアナッシングの挙動になっている。

**理由**: 現状の実装（および提案した `Promise.all` 版）は、途中の1件が失敗すると例外を投げて処理全体が止まる。最大500件のうち1件がネットワーク断やタイムアウトで失敗しただけで一覧画面全体が表示できなくなるのは、一覧表示という性質上ユーザー体験として厳しい可能性がある。部分的な失敗を許容する設計（`Promise.allSettled` を使い、成功分だけ返す・失敗件数をログに残す等）を検討する余地がある。

**提案**:
```typescript
async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
  const results = await Promise.allSettled(
    orderIds.map((id) => axios.get(`${API_BASE}/orders/${id}`))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<{ data: Order }> => r.status === 'fulfilled')
    .map((r) => r.value.data)
}
```

### [2] 軽微

**問題**: `cancelOrder` は注文の現在の `status` を確認せずにキャンセル API を呼び出している。

**理由**: すでに `shipped`（出荷済み）や `cancelled`（キャンセル済み）の注文に対してもクライアント側では何のガードもなく `cancelOrder` を呼べてしまう。サーバー側で最終的に弾かれる想定であれば実害は小さいが、クライアント側でも早期に無意味な状態遷移をブロックしておくと、不要なAPI呼び出しやユーザーへの誤解を防げる。

**提案**: 呼び出し前に `order.status` を確認し、`shipped` / `cancelled` の場合は早期リターンまたはエラーを投げることを検討。

### [1] 情報

- `Order.discount` を optional のままにするか、常に存在する前提（デフォルト値付き）に倒すか、設計方針を確認したい。現状は型は optional なのに `calculateTotal` の実装だけが「必ず存在する」前提になっており、型とロジックが矛盾している。
- `isValidQuantity` のバグ（[5]）は `validateOrder` を実質無効化しているため、`calculateTotal` の金額計算（[5]）とあわせて優先的に修正することを推奨する。

## 📚 参考情報
- 非同期処理を `await` せずに呼び出す場合は、必ず `.catch()` で明示的にハンドリングし、unhandled rejection を発生させないようにする。
- ループ内で1件ずつ `await` するのではなく `Promise.all` / `Promise.allSettled` で並列化することで、N+1 的な逐次リクエストを回避できる。
