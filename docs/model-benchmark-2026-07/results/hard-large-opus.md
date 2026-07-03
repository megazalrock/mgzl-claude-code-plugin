# ロジックレビュー結果（reviewer-for-logic）

## usage-billing.ts

使用量集計・請求書生成のロジックを追加する差分です。単価テーブル・日次集計・請求書生成・複数ユーザー集計を実装していますが、集計と単価判定の中核ロジックに**確実に誤った結果を返す欠陥が複数**あります。以下、深刻度順に報告します。

### ✅ 良い点

- `groupByDay` の `Map` を使った日次集計は素直で読みやすく、`?? 0` による初期値補完も適切です。
- `buildMonthlyInvoices` が `Promise.all` で並列化されている点は、`sumUnitsForUsers`（後述の欠陥あり）と対照的に非同期の扱いが正しいです。
- 型定義（`DailyUsage` / `Invoice` / `UsageWindow` など）が明確で、意図を追いやすい構造になっています。

---

### [5] 必須修正 (ブロッカー)

#### 5-1. `rateForVolume`: `.sort()` が辞書順ソートのため 2000 以上の単価が絶対に適用されない

**問題**: しきい値キーを `Object.keys(TIER_RATES).sort()` で並べていますが、`sort()` は既定で**文字列（辞書順）ソート**です。`['0','100','500','2000']` は辞書順で `['0','100','2000','500']` になります。ループは「条件に合致した最後の代入」を採用する実装のため、並び順が数値昇順でないと最上位ティアが正しく選ばれません。

**理由**: `units = 3000` の場合を追うと、
- `'0'` → `3000>=0` で `rate=1.2`
- `'100'` → `rate=0.9`
- `'2000'` → `3000>=2000` で `rate=0.4`（本来はここが最終値であるべき）
- `'500'` → `3000>=500` で `rate=0.65`（辞書順で `'2000'` の後ろに来るため、これが最終値になる）

結果、`units >= 2000` の全区間で本来の `0.4` ではなく `0.65` が返り、**最上位の割引ティア（2000 units 以上）が永久に適用されません**。請求金額が過大になる会計上の重大バグです。皮肉にも、整数風キーは `Object.keys` が数値昇順で返すため、`.sort()` を付けたことでバグが混入しています。

**提案**:
```typescript
export const rateForVolume = (units: number): number => {
  // 数値昇順でソートし、しきい値以上のうち最大のものを採用する
  const thresholds = Object.keys(TIER_RATES)
    .map(Number)
    .sort((a, b) => a - b)
  let rate = TIER_RATES[String(thresholds[0])]
  for (const t of thresholds) {
    if (units >= t) {
      rate = TIER_RATES[String(t)]
    }
  }
  return rate
}
```

#### 5-2. `accumulateWindows`: 共有された `EMPTY_WINDOW` を破壊的更新するため全ユーザーが同一オブジェクトを指す

**問題**: `const window = windows.get(e.userId) ?? EMPTY_WINDOW` は、未登録ユーザーに対してモジュール定数 `EMPTY_WINDOW` の**同一参照**を返します。その後 `window.units += ...` で直接ミューテートし `windows.set(...)` するため、`Map` の各エントリが同じ 1 つのオブジェクトを共有します。

**理由**: 2 ユーザー分のイベントを追うと、
- userA 初回: `window = EMPTY_WINDOW`、`units=10` に更新、`set('A', EMPTY_WINDOW)`
- userB 初回: `windows.get('B')` は `undefined` → 再び `EMPTY_WINDOW`（=`{units:10}` に汚染済み）を取得し `units=15` に更新、`set('B', EMPTY_WINDOW)`

結果、`'A'` も `'B'` も同一オブジェクトを指し、値は全ユーザーの合算になります。個別ユーザーのウィンドウ集計として**完全に誤った値**を返します。さらにモジュール定数 `EMPTY_WINDOW` が永続的に汚染され、以降の呼び出しも初期値が 0 でなくなります。

**提案**:
```typescript
export const accumulateWindows = (events: UsageEvent[]): Map<string, UsageWindow> => {
  const windows = new Map<string, UsageWindow>()
  for (const e of events) {
    // 毎回新しいオブジェクトを生成し、共有参照を避ける
    const window = windows.get(e.userId) ?? { units: 0, events: 0 }
    window.units += e.units
    window.events += 1
    windows.set(e.userId, window)
  }
  return windows
}
```

#### 5-3. `sumUnitsForUsers`: `forEach` + `async` で集計を待たず、常に `0` を返す

**問題**: `userIds.forEach(async (id) => { ... total += ... })` は、`forEach` が返り値（Promise）を無視するため、コールバック内の `await fetchEvents` が完了する前に関数が `return total` に到達します。

**理由**: `total += ...` は全 fetch が解決した後に非同期で実行されますが、その時点では既に `return total`（=`0`）が呼び出し元に返っています。よってこの関数は**入力に関わらず常に `0` を返します**。非同期エラーもどこにも surface されません（未処理 Promise 拒否になり得ます）。

**提案**:
```typescript
export const sumUnitsForUsers = async (userIds: string[]): Promise<number> => {
  const perUser = await Promise.all(
    userIds.map(async (id) => {
      const events = await fetchEvents(id)
      return events.reduce((sum, e) => sum + e.units, 0)
    }),
  )
  return perUser.reduce((sum, n) => sum + n, 0)
}
```

---

### [4] 強く推奨

#### 4-1. `removeCancelledEvents`: 前方ループ中の `splice` で隣接する削除対象を取りこぼす

**問題**: `for (let i = 0; ...; i++)` の中で `events.splice(i, 1)` すると、削除により後続要素が index `i` に繰り上がるにもかかわらず、次の反復で `i` が `i+1` に進むため、**繰り上がった要素の判定がスキップ**されます。

**理由**: キャンセル対象 ID が連続して並んでいる場合、2 つ目以降が判定されずに配列へ残ります。結果としてキャンセル済みイベントが除去されず、後段の請求に混入する定常的なバグです（`cancelledIds` にヒットが連続するほど取りこぼしが増えます）。加えて、引数配列を破壊的に変更する副作用があり、呼び出し元の配列も書き換わります。

**提案**:
```typescript
export const removeCancelledEvents = (
  events: UsageEvent[],
  cancelledIds: Set<string>,
): UsageEvent[] => {
  // 非破壊で新配列を返す（取りこぼしも副作用もない）
  return events.filter((e) => !cancelledIds.has(e.id))
}
```
※ 破壊的更新が要件なら、後方ループ（`for (let i = events.length - 1; i >= 0; i--)`）にすれば取りこぼしは解消します。

---

### [3] 推奨

#### 3-1. `fetchEvents`: 例外処理が無く、プロジェクト標準（`unknown` + `AxiosError` ナローイング）に非準拠

**問題**: `axios.get` を `try/catch` で囲っておらず、エラーは呼び出し元へそのまま伝播します。プロジェクト標準では API エラーは `catch (e: unknown)` で捕捉し `instanceof AxiosError` でナローイングして Bugsnag 通知することになっていますが、その処理がありません。加えて `res.data.map(...)` は `res.data` が配列であることを前提にしており、API が非配列（部分レスポンスやエラーボディ）を返すと `TypeError` になります。

**理由**: 404/500 等のハンドリングや Bugsnag 通知が欠落し、非 Axios エラーとの区別もされません。特に `sumUnitsForUsers` / `buildMonthlyInvoices` から呼ばれた際、1 ユーザーの失敗が上位の `Promise.all` 全体を拒否させます（後述 3-3）。

**提案**:
```typescript
import { AxiosError } from 'axios'

export const fetchEvents = async (userId: string): Promise<UsageEvent[]> => {
  try {
    const res = await axios.get(`${API_BASE}/usage/${userId}`)
    if (!Array.isArray(res.data)) return []
    return res.data.map((raw) => ({ ...raw, occurredAt: new Date(raw.occurredAt) }))
  } catch (e: unknown) {
    if (e instanceof AxiosError) {
      // ステータス別ハンドリング + $bugsnag.notify(e)
    }
    throw e
  }
}
```

#### 3-2. `buildInvoice`: 明細金額の合計と `total` が丸め誤差で一致しない可能性

**問題**: 各明細は `Math.round(d.units * rate)` で丸め、`total` は `Math.round(totalUnits * rate)` と別々に丸めています。個別丸めの合計と全体丸めは一般に一致しません。

**理由**: `describeInvoice` は明細行の後に「合計」を並べて表示するため、**明細の合算と合計欄がズレる**ことがあり、会計上の整合性を欠きます。例えば端数が複数明細に散る場合、合計 ≠ Σ明細 になります。

**提案**: `total` を明細金額の合計として算出し、単一の真実の源にする。
```typescript
const lines = daily.map((d) => ({ description: ..., amount: Math.round(d.units * rate) }))
const total = lines.reduce((sum, l) => sum + l.amount, 0)
```

#### 3-3. `buildMonthlyInvoices`: エラーの all-or-nothing と無制限並列

**問題**: `Promise.all` を使っているため、1 ユーザーの `fetchEvents` が失敗すると全ユーザーの請求生成が失敗します。また `userIds` が大量の場合、同数の API リクエストを一斉発行するため、レート制限やコネクション枯渇のリスクがあります。

**理由**: 月次請求のような一括処理では、1 件の失敗で全件が落ちるのは望ましくないことが多く、大規模ユーザー集合では並列度の上限管理が必要です。

**提案**: 部分失敗を許容するなら `Promise.allSettled` を用い、失敗ユーザーを分離する。大規模時は並列度を制限（バッチ/セマフォ）する。

---

### [2] 軽微

#### 2-1. `groupByDay`: 不正な `Date` と UTC 基準の日付境界

**問題**: `e.occurredAt.toISOString()` は、`occurredAt` が不正な `Date`（`fetchEvents` で `new Date('不正な文字列')` を通した場合など）だと `RangeError: Invalid time value` を投げます。また `toISOString().slice(0,10)` は **UTC 基準**の日付で集計するため、ローカルタイムゾーンで日次集計したい要件の場合は境界がずれます。

**理由**: 上流のバリデーションが無いと、1 件の不正日時で集計全体が例外停止します。UTC 集計は意図的なら問題ありませんが、要件確認の余地があります。

**提案**: `Number.isNaN(e.occurredAt.getTime())` で不正日時を除外・警告する、もしくは集計基準タイムゾーンを明示する。

---

### [1] 情報

- `rateForVolume` に負値 `units` を渡すと、初期値 `TIER_RATES[thresholds[0]]`（先頭ティアの単価）が返ります。負値が入力され得るかは要件次第ですが、想定外入力のガードがあると堅牢です。
- 5-1・5-2・5-3 はいずれも「テストがあれば即座に検出できた」種類の欠陥です（`rateForVolume(3000)===0.4`、`accumulateWindows` の 2 ユーザー独立性、`sumUnitsForUsers` の戻り値）。ユニットテストの追加を推奨します（テスト自体の品質は本レビュー対象外）。
- `removeCancelledEvents` と `accumulateWindows` はいずれも入力・共有状態を破壊的に変更する設計です。純粋関数化すると再利用時の事故を防げます（設計面の詳細は `reviewer-for-design` の領域）。

## 📚 参考情報

- `Array.prototype.sort()` は既定で要素を文字列化して辞書順比較します（MDN）。数値ソートには比較関数 `(a, b) => a - b` が必須です。
- `Array.prototype.forEach` は非同期コールバックを await しません。非同期集計には `for await` / `Promise.all` を用います。
- 配列の反復中に要素を削除する場合は、後方ループまたは非破壊の `filter` を用いるのが定石です。
