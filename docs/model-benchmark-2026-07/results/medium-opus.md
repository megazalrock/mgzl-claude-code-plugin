# ロジックレビュー結果（reviewer-for-logic）

## order-service.ts

### ✅ 良い点

- `validateOrder` で `order.items.length === 0` を最初に弾いており、空注文を確定させない防御ができています。
- `confirmOrder` の「409 のときだけ `false`、それ以外は再送出」という分岐方針自体は、二重確定と本当の障害を区別できて妥当です。
- `calculateTotal` で `Math.round` により 1 円未満を丸めており、金額計算の意図（コメント）と整合しています。

### [5] 必須修正 (ブロッカー)

**問題**: `isValidQuantity` の論理演算子が `||` になっており、常に `true` を返します。

```typescript
isValidQuantity(quantity: number): boolean {
  return quantity >= 1 || quantity <= 100
}
```

**理由**: 「1 以上 100 以下のみ有効」という JSDoc の意図に反しています。`||` では、任意の実数が「1 以上」か「100 以下」のどちらかを必ず満たすため、この関数は入力に関わらず常に `true` になります。
- `quantity = 0` → `0 >= 1`(false) `|| 0 <= 100`(true) = **true**（本来は無効）
- `quantity = 200` → `200 >= 1`(true) = **true**（本来は無効）
- `quantity = -5` → `-5 <= 100`(true) = **true**（本来は無効）

結果として、この関数を利用する `validateOrder` の数量チェック（`order.items.some((i) => !this.isValidQuantity(i.quantity))`）も一切機能せず、数量 0 や負数、100 超の不正な注文が確定可能と判定されます。

**提案**:
```typescript
isValidQuantity(quantity: number): boolean {
  return quantity >= 1 && quantity <= 100
}
```
併せて、小数の数量（例: `1.5`）を許容しない想定であれば `Number.isInteger(quantity)` の併用も検討してください。

### [5] 必須修正 (ブロッカー)

**問題**: `calculateTotal` が、オプショナルな `order.discount` を `undefined` チェックせずに参照しており、割引のない注文で実行時例外になります。

```typescript
calculateTotal(order: Order): number {
  const subtotal = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const discounted = subtotal * (1 - order.discount.rate)   // ← order.discount が undefined だと throw
  return Math.round(discounted)
}
```

**理由**: `Order` インターフェースでは `discount?: Discount` とオプショナル定義されているため、割引コードのない注文（大多数のケース）では `order.discount` が `undefined` になります。その場合 `order.discount.rate` は `TypeError: Cannot read properties of undefined (reading 'rate')` を投げ、合計金額計算が丸ごと失敗します。既存の `calculateTotal`（割引導入前）は割引なしで動作していたため、この変更は明確なデグレードです。

**提案**:
```typescript
calculateTotal(order: Order): number {
  const subtotal = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const rate = order.discount?.rate ?? 0
  const discounted = subtotal * (1 - rate)
  return Math.round(discounted)
}
```
さらに堅牢性のため、`rate` を `0 <= rate <= 1` にクランプ（または範囲外を弾く）することも推奨します。`Discount.rate` の JSDoc は「0.0〜1.0」を要求していますが実行時には保証されておらず、負値なら合計が増え、`1` 超なら合計が負になります（下記 [3] 参照）。

### [4] 強く推奨

**問題**: `fetchOrderDetails` が、注文 ID ごとに逐次 `await` で 1 件ずつ API を呼ぶ N+1 になっています。

```typescript
async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
  const orders: Order[] = []
  for (const id of orderIds) {
    const res = await axios.get(`${API_BASE}/orders/${id}`)
    orders.push(res.data)
  }
  return orders
}
```

**理由**: JSDoc に「注文一覧画面の初期表示で呼ばれる」「最大 500 件になりうる」と明記されており、初期表示というホットパスで最大 500 回の HTTP リクエストが**直列**に発行されます。1 リクエスト 100ms でも合計約 50 秒かかり、画面初期表示が実質的に破綻します。件数（データ量）に比例して線形に悪化する典型的な N+1 です。

**提案**: 一括取得エンドポイントがあればそれを使うのが最善です。無ければ最低限、直列を並列化してください（サーバ負荷を考慮し同時実行数は制限するのが望ましい）。
```typescript
// バッチAPIがある場合（推奨）
async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
  const res = await axios.post(`${API_BASE}/orders/batch`, { ids: orderIds })
  return res.data
}

// バッチAPIが無い場合（次善策・並列化）
async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
  const results = await Promise.all(
    orderIds.map((id) => axios.get(`${API_BASE}/orders/${id}`)),
  )
  return results.map((res) => res.data)
}
```
なお `Promise.all` は 1 件でも失敗すると全体が reject する点、500 並列がサーバに与える負荷にも留意してください（p-limit 等での同時実行数制御を推奨）。

### [4] 強く推奨

**問題**: `cancelOrder` が、監査ログ書き込みの失敗を握りつぶさずに伝播させており、JSDoc の意図（「監査ログの記録失敗で本処理は止めない」）に反しています。

```typescript
async cancelOrder(order: Order): Promise<void> {
  await axios.post(`${API_BASE}/orders/${order.id}/cancel`)
  this.writeAuditLog(order.id, 'cancelled')   // ← 内部で await している。失敗すると reject が伝播
}

private async writeAuditLog(orderId: string, action: string): Promise<void> {
  await axios.post(`${API_BASE}/audit`, { orderId, action })
}
```

**理由**: `writeAuditLog` は内部で `await axios.post(...)` しており、監査 API が失敗すると Promise が reject します。`cancelOrder` はその戻り値を（`await` していないものの）例外として拾わないため、キャンセル本処理は成功しているのに `cancelOrder` 全体が reject します。「監査ログの失敗で本処理を止めない」という設計意図と正反対の挙動です。加えて、現状の `cancelOrder` は `writeAuditLog` を `await` していないため、監査ログの完了を待たずに関数が解決し、かつ発生した rejection は unhandled promise rejection になり得ます（await 有無いずれにせよ危険）。

**提案**: 監査ログはベストエフォートとして明示的に try/catch で握りつぶし、完了を待つなら await した上でエラーを無視します。
```typescript
async cancelOrder(order: Order): Promise<void> {
  await axios.post(`${API_BASE}/orders/${order.id}/cancel`)
  try {
    await this.writeAuditLog(order.id, 'cancelled')
  } catch (e) {
    // 監査ログ失敗は本処理を止めない（ログ出力やBugsnag通知に留める）
  }
}
```

### [3] 推奨

**問題**: `confirmOrder` の catch が `catch (e: any)` になっており、プロジェクト標準（`unknown` で受けて `instanceof AxiosError` で絞り込む）から外れています。

```typescript
} catch (e: any) {
  if (e.response?.status === 409) {
    return false
  }
  throw e
}
```

**理由**: `e: any` では型安全性が失われ、Axios 以外のエラー（ネットワーク層以外の例外や独自エラー）が混入した場合に `e.response?.status` の参照が意図せず通ってしまう可能性があります。プロジェクト標準では `unknown` で受けて `AxiosError` に絞り込み、非 Axios エラーは別分岐で扱う（Bugsnag 通知漏れを防ぐ）ことになっています。現状のロジック自体は「409 → false / それ以外 → 再送出」で概ね動きますが、標準パターンに揃えることでエラー種別の取りこぼしを防げます。

**提案**:
```typescript
import { AxiosError } from 'axios'

} catch (e: unknown) {
  if (e instanceof AxiosError) {
    if (e.response?.status === 409) {
      return false
    }
  }
  throw e
}
```

### [3] 推奨

**問題**: `Discount.rate` の値域（0.0〜1.0）が実行時に検証されていません。

**理由**: `calculateTotal` は `subtotal * (1 - order.discount.rate)` を無検証で計算します。`rate` が負値なら割引どころか合計が増え、`1` を超えると合計が負になります。JSDoc では「0.0〜1.0」を要求していますが、API 応答や呼び出し側のバグで範囲外の値が入り込むと、誤った請求金額を返します。上記 [5] の `calculateTotal` 修正と合わせて範囲チェック/クランプを入れると堅牢になります。

**提案**:
```typescript
const rate = Math.min(Math.max(order.discount?.rate ?? 0, 0), 1)
const discounted = subtotal * (1 - rate)
```

### [2] 軽微

**問題**: `fetchOrder` / `fetchOrderDetails` は `res.data` をそのまま `Order` として返しており、レスポンス形状の検証がありません。

**理由**: API が想定外の形（`null`、欠損フィールド等）を返した場合、後続の `calculateTotal` や `validateOrder` で `order.items` が `undefined` となり別の実行時例外を誘発し得ます。差分の範囲では致命的ではありませんが、境界（ネットワーク層）でのバリデーションを検討する価値があります。

### [1] 情報

- `validateOrder` は数量の妥当性を `isValidQuantity` に委譲しているため、[5] の `||`→`&&` 修正が入れば数量チェックも自動的に正しく機能します。逆に言えば、`isValidQuantity` を直さない限り `validateOrder` の数量検証は無意味である点を強調します。
- `confirmOrder` の 409 判定はビジネスロジック上の「二重確定」を表現しており、`false` を返す設計は呼び出し側で分岐しやすく妥当な選択です。

## 📚 参考情報
- 並列リクエストの同時実行数制御には `p-limit` 等の利用を推奨します（500 並列でのサーバ過負荷回避）。
- API エラーハンドリングは本プロジェクト標準の「`catch (e: unknown)` + `instanceof AxiosError`」パターンに統一してください。
