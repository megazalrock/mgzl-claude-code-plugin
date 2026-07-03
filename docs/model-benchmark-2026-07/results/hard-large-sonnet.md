# ロジックレビュー結果（reviewer-for-logic）

## src/usage-billing.ts

### ✅ 良い点

- `groupByDay` で `Map` を使って日毎に集計しており、`Array.includes` などの二重ループを避けた O(n) の実装になっている。
- `removeCancelledEvents` の呼び出し想定である `cancelledIds` に `Set` を使っており、`Array.includes` によるO(n)探索を避けている（後述の通り実装自体には別の不具合あり）。
- `buildMonthlyInvoices` は `userIds.map(async …)` を `Promise.all` で束ねており、非同期処理の直列化（N+1的な待ち）を避けた正しい並行処理パターンになっている。

---

### [5] 必須修正 (ブロッカー)

#### 1. `rateForVolume`: しきい値を文字列としてソートしているため、最上位ティアの単価が誤って上書きされる

**問題**: `Object.keys(TIER_RATES).sort()` はデフォルトの文字列比較でソートされるため、`['0', '100', '500', '2000']` は `['0', '100', '2000', '500']` という誤った順序になる（`"2000" < "500"` は辞書順では真）。

**理由**: ループ内は「これまでの最大しきい値」を意識せず、`units >= t` を満たすたびに無条件で `rate` を上書きし続ける実装になっている。ソート順が誤っているため、`units = 3000` のようなケースで
- `t = '0'` → rate = 1.2
- `t = '100'` → rate = 0.9
- `t = '2000'` → rate = 0.4 （本来はこれが正解）
- `t = '500'` → `3000 >= 500` は真なので rate = 0.65 で **上書きされてしまう**

結果として、2000 units 以上の全ての利用者が本来の単価 0.4 ではなく 0.65 で請求されてしまう（最上位の大口ボリュームディスカウントが一切適用されない）。これは請求金額に直結するため最優先で修正が必要。

**提案**:
```typescript
export const rateForVolume = (units: number): number => {
  const thresholds = Object.keys(TIER_RATES)
    .map(Number)
    .sort((a, b) => a - b) // 数値としてソートする
  let rate = TIER_RATES[String(thresholds[0])]
  for (const t of thresholds) {
    if (units >= t) {
      rate = TIER_RATES[String(t)]
    }
  }
  return rate
}
```

---

#### 2. `removeCancelledEvents`: ループ中に `splice` しているため、連続するキャンセル済みイベントを取りこぼす

**問題**: `for` ループで前方向にインデックスを進めながら `events.splice(i, 1)` で要素を削除している。削除すると後続要素が1つ前に詰まるが、`i` はそのままインクリメントされるため、詰まってきた次の要素の判定がスキップされる。

**理由**: 例えば `events = [A(cancelled), B(cancelled), C]` の場合、
- `i=0`: `A` が cancelled → splice → `events = [B, C]`
- `i=1`（インクリメント後）: `events[1]` は `C`。本来チェックされるはずだった `B`（インデックス0に詰まった）は判定されずスキップされる

結果、連続してキャンセルされたイベントのうち **奇数番目のみ**が削除され、偶数番目は残ってしまう。実運用では一括キャンセルなどで連続したキャンセルは十分起こり得るため、集計・請求額に直接影響する重大なバグ。加えて、この実装は引数で渡された配列自体を破壊的に変更しており（呼び出し元の配列が意図せず書き換わる）、これも副作用として問題。

**提案**:
```typescript
export const removeCancelledEvents = (
  events: UsageEvent[],
  cancelledIds: Set<string>,
): UsageEvent[] => {
  return events.filter((e) => !cancelledIds.has(e.id))
}
```

---

#### 3. `accumulateWindows`: 初期値に共有オブジェクト `EMPTY_WINDOW` を使い回しているため、ユーザー間で集計が混ざる

**問題**: `windows.get(e.userId) ?? EMPTY_WINDOW` は、該当ユーザーが未登録の場合にモジュールスコープの単一オブジェクト `EMPTY_WINDOW` への参照をそのまま `window` に代入している。その後 `window.units += …` / `window.events += 1` で **`EMPTY_WINDOW` 自体を直接ミューテーションしてしまう**。

**理由**: 最初に登場したユーザー A の処理で `EMPTY_WINDOW.units` や `.events` が加算され、`windows.set('A', EMPTY_WINDOW)` により `windows` の `'A'` キーは（コピーではなく）`EMPTY_WINDOW` への参照そのものになる。次に新しいユーザー B が登場すると、再び `windows.get('B') ?? EMPTY_WINDOW` は「A によってすでに加算済みの」同じ `EMPTY_WINDOW` を初期値として使ってしまい、さらに `windows.set('B', EMPTY_WINDOW)` で `'A'` と `'B'` が **全く同じオブジェクトを共有**することになる。以降どちらかのキーを更新すると両方に反映されてしまい、複数ユーザーが存在する時点で集計が確実に破綻する。

**提案**:
```typescript
export const accumulateWindows = (events: UsageEvent[]): Map<string, UsageWindow> => {
  const windows = new Map<string, UsageWindow>()
  for (const e of events) {
    const window = windows.get(e.userId) ?? { units: 0, events: 0 }
    window.units += e.units
    window.events += 1
    windows.set(e.userId, window)
  }
  return windows
}
```
（`EMPTY_WINDOW` 定数は初期値の使い回し目的では使用しないこと。都度新しいオブジェクトを生成する。）

---

#### 4. `sumUnitsForUsers`: `Array.prototype.forEach` に `async` コールバックを渡しているため、常に `0` を返す

**問題**: `userIds.forEach(async (id) => { … total += … })` は `forEach` が非同期コールバックの完了を待たない。`forEach` 自体は同期的に即座に完了して戻り値の `total`（まだ加算されていない `0`）がそのまま `return total` される。

**理由**: `fetchEvents` の `await` が完了するのは `forEach` の呼び出しがすでに終わった後（マイクロタスク経由）であり、`sumUnitsForUsers` の `return total` はその前に実行されてしまう。したがって、この関数は **入力が空でない限り常に `0` を返す**（`await` している側は加算前の値を受け取る）。これは典型的な「`forEach` に `async` を渡す」アンチパターンで、実運用データでは 100% 再現するバグ。

**提案**: 同ファイル内の `buildMonthlyInvoices` と同様、`Promise.all` + `map` パターンに統一する。
```typescript
export const sumUnitsForUsers = async (userIds: string[]): Promise<number> => {
  const totals = await Promise.all(
    userIds.map(async (id) => {
      const events = await fetchEvents(id)
      return events.reduce((sum, e) => sum + e.units, 0)
    }),
  )
  return totals.reduce((sum, t) => sum + t, 0)
}
```

---

### [4] 強く推奨

#### 1. `buildInvoice`: 明細行の合計と請求書の `total` が一致しないケースがある（丸め誤差のドリフト）

**問題**: `lines` の各 `amount` は `Math.round(d.units * rate)` で行ごとに丸める一方、`total` は明細行の丸め後の値を合算せず `Math.round(totalUnits * rate)` として別途独立に計算している。

**理由**: 行ごとの丸めと合計の丸めは一般に一致しない。例えば `units = [1, 1, 1]`、`rate = 0.65` の場合、各行は `Math.round(0.65) = 1` となり明細の合計は `3` だが、`total` は `Math.round(3 * 0.65) = Math.round(1.95) = 2` となり、明細の合計と請求書の合計金額が食い違う。請求書として明細と合計が一致しないのはユーザーに不信感を与える実利用上の不具合になり得る。

**提案**:
```typescript
export const buildInvoice = (userId: string, daily: DailyUsage[]): Invoice => {
  const totalUnits = daily.reduce((sum, d) => sum + d.units, 0)
  const rate = rateForVolume(totalUnits)
  const lines = daily.map((d) => ({
    description: `${d.day} 分の使用量 ${d.units} units`,
    amount: Math.round(d.units * rate),
  }))
  const total = lines.reduce((sum, l) => sum + l.amount, 0) // 明細の合計から算出する
  return { userId, lines, total }
}
```

#### 2. `fetchEvents`: API エラーが一切捕捉されておらず、プロジェクト標準の `AxiosError` ナローイングが行われていない

**問題**: `axios.get` の呼び出しが `try/catch` で囲われておらず、404/500 などのエラーレスポンスやネットワーク断が発生した場合、例外がそのまま呼び出し元（`sumUnitsForUsers` や `buildMonthlyInvoices` 内の `Promise.all`）まで無制御に伝播する。プロジェクト標準である「`catch (e: unknown)` → `instanceof AxiosError` でナローイング」パターンが未実装。

**理由**: `buildMonthlyInvoices` は `Promise.all` を使っているため、1ユーザー分の取得が失敗すると他の正常なユーザーの請求書生成もすべて失敗する。また、`res.data` がAPI仕様と異なる形状（配列でない、null など）で返ってきた場合も `.map` が無条件に例外を投げ、同様に呼び出し元へ無制御に伝播する。エラー種別に応じた分岐（404/500）やエラー通知（Bugsnag相当）が行われていないため、障害発生時の切り分けやユーザーへの適切なフィードバックができない。

**提案**:
```typescript
import axios, { AxiosError } from 'axios'

export const fetchEvents = async (userId: string): Promise<UsageEvent[]> => {
  try {
    const res = await axios.get(`${API_BASE}/usage/${userId}`)
    return res.data.map(
      (raw: { id: string; userId: string; units: number; occurredAt: string }) => ({
        ...raw,
        occurredAt: new Date(raw.occurredAt),
      }),
    )
  } catch (e: unknown) {
    if (e instanceof AxiosError) {
      // 404 / 500 等に応じたハンドリングと通知（Bugsnag 等）をここで行う
    }
    throw e
  }
}
```

---

### [3] 推奨

#### 1. API から取得した `occurredAt` が不正な日付文字列の場合、後続処理で例外になる

**問題**: `fetchEvents` の `new Date(raw.occurredAt)` は不正な文字列を渡されても例外を投げず `Invalid Date` を返すだけだが、その後 `groupByDay` の `e.occurredAt.toISOString()` は `Invalid Date` に対して `RangeError` を投げる。

**理由**: 外部APIのレスポンスが想定形式と異なる（欠損・不正フォーマットの日時）場合、バリデーションなしにここまで到達すると、そのユーザーの請求処理全体が例外で落ちる。件数としては稀だが、外部入力に起因するため十分起こり得る。

**提案**: `fetchEvents` でパース後に `isNaN(occurredAt.getTime())` をチェックし、不正な場合は該当イベントを除外するかエラーとして早期に報告する。

#### 2. イベントIDの重複が考慮されておらず、二重計上のリスクがある

**問題**: `groupByDay` / `accumulateWindows` はいずれもイベントの重複除去を行わずに単純加算している。ページネーションの取りこぼし・リトライ等により同一 `id` のイベントが複数回渡された場合、そのまま二重計上される。

**提案**: 集計前に `id` をキーにした重複排除ステップを挟むことを検討する。

---

### [2] 軽微

特になし。

---

### [1] 情報

- `buildMonthlyInvoices` はユーザーごとに `fetchEvents` を個別に呼び出しているが、これは要件上ユーザー単位のAPIコールが必要なためであり、N+1として問題視できるかは外部APIがバッチ取得エンドポイントを提供しているかに依存する。もし提供されているなら、まとめて取得することでリクエスト数を削減できる可能性がある（設計判断のため参考情報として記載）。
- `groupByDay` は `toISOString().slice(0, 10)` でUTC基準の日付境界を採用している。ユーザーのタイムゾームと請求の「日」の境界がずれる可能性があるが、これが意図した仕様かどうかは要件次第。

## 📚 参考情報
- MDN: [`Array.prototype.forEach`](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach) — `forEach` はコールバックの戻り値（Promiseを含む）を無視するため、非同期処理を直列/並列に待つ用途には `for...of` + `await` または `Promise.all` + `map` を使うこと。
- MDN: [`Array.prototype.splice`](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Array/splice) — ループ中の配列破壊的変更はインデックスずれを引き起こしやすく、`filter` 等の非破壊的手法が安全。
