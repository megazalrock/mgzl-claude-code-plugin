# ロジックレビュー結果（reviewer-for-logic）

## report-generator.ts

### ✅ 良い点

- 各関数・状態遷移の意図が JSDoc コメントで明示されており、実装と仕様の突き合わせがしやすい。
- `summarizeByCategory` が `Map` を使い 1 パス O(n) で集計できている。
- `buildSummaryLines` が集計・ソート・整形の責務を分けて表示用データを組み立てている。
- `SalesRecord.amount` に「無償提供キャンペーンのレコードは 0 になる」という業務仕様がコメントで残されている（後述の指摘の根拠にもなる有用な情報）。

---

### [5] 必須修正 (ブロッカー)

#### 5-1. `enrichWithUsdAmount` が「レポート全体を失敗させる想定」の致命的エラーを握りつぶしている

**問題**: 関数の doc コメントは「レート取得に失敗した場合はレポート生成全体を失敗させる想定」と明記しているが、実装は `catch { return records }` で例外を握りつぶし、**未換算（円のまま）のレコードをそのまま返している**。

```typescript
export const enrichWithUsdAmount = async (records: SalesRecord[]): Promise<SalesRecord[]> => {
  try {
    const res = await axios.get(`${API_BASE}/rates/latest`)
    const usdJpy: number = res.data.usdJpy
    return records.map((r) => ({ ...r, amount: r.amount / usdJpy }))
  } catch {
    return records // ← 仕様と真逆。失敗を隠蔽し円のままの値を USD として下流に流す
  }
}
```

**理由**: レート API が落ちた・タイムアウトした場合、本来は `generateReport` 全体を失敗させるべきなのに、成功扱いで円建ての金額をそのまま返す。下流の `summarizeByCategory` → `buildSummaryLines` は返り値を USD 換算済みとして扱うため、**円の値を USD として集計・表示する静かなデータ破損**が起きる（およそ 100〜150 倍ずれた数値がそのまま出力される）。ユーザーやオペレーターは失敗に気づけない。

加えて、当プロジェクトの例外処理標準（API エラーは `unknown` で受け `instanceof AxiosError` で絞り込み、想定外エラーは別処理し Bugsnag へ通知する）にも違反している。`catch {}` は例外の型を握りつぶし、Axios 由来か否かの判別も Bugsnag 通知もできていない。

**提案**:
```typescript
import { AxiosError } from 'axios'

export const enrichWithUsdAmount = async (records: SalesRecord[]): Promise<SalesRecord[]> => {
  const res = await axios.get(`${API_BASE}/rates/latest`)
  const usdJpy: number = res.data.usdJpy
  return records.map((r) => ({ ...r, amount: r.amount / usdJpy }))
}
// 呼び出し側（generateReport など）でエラーをレポート失敗として扱う。
// もしこの層で捕捉するなら、握りつぶさず再スローする:
//   } catch (e: unknown) {
//     if (e instanceof AxiosError) { /* $bugsnag.notify(e) など */ }
//     throw e // ← 仕様どおりレポート生成を失敗させる
//   }
```

#### 5-2. `nextStatus` に `generating` + `fail` → `failed` の遷移が欠落している

**問題**: doc コメントは「generating は complete で ready へ、**fail で failed へ**」と明記しているが、`case 'generating'` は `complete` しか処理しておらず、`fail` イベントを取りこぼしている。

```typescript
case 'generating':
  if (event === 'complete') {
    return 'ready'
  }
  break // ← event === 'fail' がここで素通りし、current('generating') が返る
```

**理由**: `nextStatus('generating', 'fail')` は仕様上 `'failed'` を返すべきだが、実装は `'generating'` を返す（状態が変わらない）。生成に失敗したレポートが永遠に `generating` のまま滞留し、失敗として記録・再実行トリガも走らなくなる。ドキュメント化された想定イベントに対して確実に誤った状態遷移を起こすため、ブロッカー。

**提案**:
```typescript
case 'generating':
  if (event === 'complete') {
    return 'ready'
  }
  if (event === 'fail') {
    return 'failed'
  }
  break
```

---

### [4] 強く推奨

#### 4-1. `paginate` の `totalPages` が `Math.floor` で端数ページを取りこぼす

**問題**: `const totalPages = Math.floor(records.length / pageSize)` は割り切れない場合に最後の部分ページを数え落とす。

**理由**: 例）`records.length = 10`, `pageSize = 3` → `Math.floor(10/3) = 3` だが実際は 4 ページ必要。`records.length = 5`, `pageSize = 10` → `totalPages = 0` になり、データがある 1 ページ目すら「存在しないページ」と表現される。ページャ UI の総ページ数が実データと食い違い、最終ページへ到達できない不具合になる。

**提案**:
```typescript
const totalPages = Math.ceil(records.length / pageSize)
```

#### 4-2. `filterByCategories` が O(n×m) で大規模データに対し二次的コストになる

**問題**: `records.filter((r) => activeCategories.includes(r.category))` は、レコードごとに配列 `activeCategories` を線形走査する。

**理由**: doc コメント自身が「records は最大 10 万件、activeCategories は最大数千件」と明記しており、最悪 10 万 × 数千 ＝ 数億回の比較になる。`Array.includes` は O(m) のため全体で O(n×m) となり、レポート生成が実データ規模で顕著に遅くなる（同期処理のためこの間ブロックする）。`Set` 化すれば O(n+m) に落とせる。

**提案**:
```typescript
export const filterByCategories = (
  records: SalesRecord[],
  activeCategories: string[],
): SalesRecord[] => {
  const active = new Set(activeCategories)
  return records.filter((r) => active.has(r.category))
}
```

#### 4-3. `summarizeByCategory` の `!r.amount` が「金額 0 の有効レコード」を件数からも除外する

**問題**: `if (!r.amount) { continue }` は `amount === 0` を集計対象から丸ごと除外する。しかし `amount` の doc コメントは「無償提供キャンペーンのレコードは 0 になる」と明記しており、0 は正当な業務値。

**理由**: 合計金額（total）に 0 を足すのは無害だが、`count`（件数）からも除外されるため、**無償提供キャンペーンのレコードがカテゴリの件数に計上されなくなる**。「件数」を実レコード件数として使う下流表示・KPI がずれる。`!r.amount` は 0 のほかに `NaN`（パース失敗）も同時に弾いてしまい、意図が「不正値の除外」なのか「0 円の除外」なのか曖昧なまま両方を落としている点も問題。

**提案**（0 円レコードも件数に含める場合）:
```typescript
for (const r of records) {
  if (Number.isNaN(r.amount)) {
    continue // パース失敗のみ除外
  }
  const current = summary.get(r.category) ?? { total: 0, count: 0 }
  current.total += r.amount // 0 加算は無害
  current.count += 1        // 0 円レコードも件数に計上
  summary.set(r.category, current)
}
```
（仕様として本当に 0 円を集計から外したいなら、その旨をコメントで明示し、`!r.amount` ではなく `r.amount === 0` の明示比較にすべき。）

#### 4-4. USD 換算後の金額を `formatJpy`（¥ 表記）で表示しており通貨単位が不整合

**問題**: `enrichWithUsdAmount` は `amount`（＝「売上金額（円）」フィールド）を `r.amount / usdJpy` で **USD 値に上書き**する。その後 `summarizeByCategory` は USD 値を合算し、`buildSummaryLines` → `formatJpy` が `¥` を付けて表示する。

**理由**: 換算後の数値は USD なのに表示は `¥`。例えば 1,000 USD 相当の合計が `¥1,000` と表示され、実際の円建て金額（約 15 万円）とは桁違いの値が「円」として提示される。フィールドの文書化された意味（円）を途中で書き換えているため、パイプライン全体で通貨単位が一貫しない。`enrichWithUsdAmount` を通す設計なら表示は `$`（USD フォーマット）にするか、円表示を維持するなら `amount` を上書きせず別フィールド（例 `usdAmount`）に持たせるべき。

**提案**:
```typescript
// 案 A: USD 表示にする
const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`

// 案 B: 円を維持し USD は別フィールドへ（amount の意味を壊さない）
return records.map((r) => ({ ...r, usdAmount: r.amount / usdJpy }))
```

---

### [3] 推奨

#### 3-1. `usdJpy` の値検証がなく、0 / 未定義でゼロ除算（`Infinity` / `NaN`）になりうる

**問題**: `const usdJpy: number = res.data.usdJpy` を検証せずに `r.amount / usdJpy` で除算している。

**理由**: レスポンスに `usdJpy` が無い・`0`・文字列などの場合、`amount / undefined = NaN`、`amount / 0 = Infinity` となり、以降の集計・表示が壊れる（`¥NaN` / `¥Infinity`）。HTTP は成功しても本文が不正なケースを取りこぼす。

**提案**:
```typescript
const usdJpy = Number(res.data.usdJpy)
if (!Number.isFinite(usdJpy) || usdJpy <= 0) {
  throw new Error(`invalid usdJpy rate: ${res.data.usdJpy}`)
}
```

#### 3-2. `paginate` の `pageSize` 0・範囲外 `page` に対する防御がない

**問題**: `pageSize = 0` で `records.length / pageSize` がゼロ除算（`totalPages` が `Infinity`/`NaN`）。`page < 1` では `startIdx` が負になり `slice` の挙動が意図とずれる。範囲外の `page` は空配列を返すが `totalPages` との整合はチェックされない。

**理由**: 引数はユーザー・呼び出し側由来になりうるため、境界値（`pageSize <= 0`、`page < 1`）でのガードがないと壊れた `ReportPage` を返す。

**提案**: `pageSize >= 1`・`page >= 1` を前提とするなら早期にバリデーションするか、`Math.max(1, ...)` でクランプする。

#### 3-3. `parseCsvRow` が列不足・不正行を静かに `NaN` 化して取り込む

**問題**: 列数が 4 未満の行では `amountStr` などが `undefined` になり、`parseFloat(undefined) → NaN`。`id`/`category`/`recordedAt` も `undefined` のまま `SalesRecord` として生成される。

**理由**: 不正 CSV 行が例外にならず `NaN`/`undefined` を含むレコードとして下流に流れる（現状は `summarizeByCategory` の `!r.amount` が偶然弾くが、その挙動に依存するのは脆い）。フォーマット不正を検知できないと原因追跡が難しくなる。

**提案**: 列数・`parseFloat` の結果を検証し、不正行はスキップまたはエラー収集する。

---

### [2] 軽微

#### 2-1. `parseCsv` が `\n` 固定分割で `\r\n`（CRLF）を扱えていない

**問題**: `csv.split('\n')` は Windows/Excel 由来の `\r\n` 改行を分割した際、各行末に `\r` が残る。

**理由**: 末尾列 `recordedAt` に `\r` が付き、日付比較・表示で不整合が出る可能性がある（末尾以外の列は `,` 区切りなので影響は `recordedAt` に集中）。

**提案**:
```typescript
return csv
  .split(/\r?\n/)
  .slice(1)
  .filter((line) => line.trim().length > 0)
  .map(parseCsvRow)
```

---

### [1] 情報

- `generateReport` は `paginate` にページ分だけを渡す一方、`summarizeByCategory` は `enriched` 全件を集計しており、「サマリは全体・レコード表示はページ単位」という設計意図と読める。これが意図どおりなら問題なし（仕様確認のための観察事項）。
- `formatJpy` は `Math.round` で小数を丸めるため、USD 換算値（小数）を渡すと精度が失われる。上記 4-4 を通貨単位ごと整理すれば併せて解消する。

## 📚 参考情報

- 例外処理標準（本プロジェクト規約）: API エラーは `catch (e: unknown)` で受け、`e instanceof AxiosError` で絞り込み、想定外は別処理のうえ `$bugsnag.notify(e)` で通知する。5-1 はこの規約にも違反している。
- 大規模コレクションの包含判定は `Array.includes`（O(n)）ではなく `Set.has`（O(1)）を用いる（4-2）。
