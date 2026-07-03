# ロジックレビュー結果（reviewer-for-logic）

## src/report-generator.ts

### ✅ 良い点

- `parseCsv` / `filterByCategories` / `summarizeByCategory` / `buildSummaryLines` が純粋関数として分離されており、各段の入出力を追いやすい構成になっていますわ。
- 各関数に「意図」を説明する JSDoc コメントが添えられており、実装がその意図通りに動くかを照合しやすくなっていました。実際、今回指摘する `nextStatus` と `enrichWithUsdAmount` の不具合は、いずれもこのコメントと実装の食い違いから発見できたものですの。
- `buildSummaryLines` の降順ソート自体（`b.total - a.total`）は正しく実装されていますわ。

### [5] 必須修正 (ブロッカー)

**問題**: `nextStatus` で `generating` 状態のときに `fail` イベントを受け取っても `failed` へ遷移しない。

**理由**: 関数直上のコメントには「generating は complete で ready へ、fail で failed へ」と明記されているのに、実装の `case 'generating'` には `event === 'complete'` の分岐しかなく、`fail` は素通りして `break` に落ち、`return current`（＝ `generating` のまま）になってしまいますわ。レポート生成が失敗しても状態が `generating` に固定され続け、UI 上は「生成中のまま止まって見える」「再実行 (`failed` → `generate`) の導線に入れない」といった実害につながる、典型的な「分岐の書き忘れ」ですの。

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

**問題**: `paginate` の `totalPages` 計算が `Math.floor` になっており、割り切れない件数のときにページ数を1つ少なく返す。

**理由**: `records.length / pageSize` の端数を切り捨てているため、たとえば `records.length = 105, pageSize = 10` のとき `totalPages` は `10` になりますが、実際には11ページ目に5件残っていますわ。`records` 自体のスライスは正しく返るものの、`totalPages` を信頼して「これ以上ページがあるか」を判定する呼び出し側（ページャー UI 等）は、最後のページに絶対に到達できなくなります。境界値ではなく通常のデータ量（割り切れない件数）で必ず発生する不具合ですの。

**提案**:
```typescript
const totalPages = Math.ceil(records.length / pageSize)
```

---

**問題**: `enrichWithUsdAmount` が為替レート取得の失敗を握りつぶし、コメントに明記された「レート取得失敗時はレポート生成全体を失敗させる」という意図に反した動作をしている。

**理由**: `catch { return records }` としているため、API 呼び出しが失敗しても例外は外に伝播せず、円建てのまま（USD 換算前）のレコードが正常系と同じ形でそのまま後段（`summarizeByCategory` → `paginate` / `buildSummaryLines`）に流れてしまいますわ。呼び出し元は「換算に成功したか失敗したか」を一切区別できないまま、あるときは USD、あるときは JPY の金額が混在したレポートが「正常に生成された」ものとして返ってしまいます。これは JSDoc に書かれた設計意図と実装が完全に矛盾していて、しかも本レビューの前提となっている「API エラーは `unknown` で受けて `AxiosError` で絞り込む」というプロジェクト標準にも従っておらず（型の絞り込みなし、再送出なし、通知なし）、エラーを握りつぶす典型例ですの。

**提案**:
```typescript
import { AxiosError } from 'axios'

export const enrichWithUsdAmount = async (records: SalesRecord[]): Promise<SalesRecord[]> => {
  try {
    const res = await axios.get(`${API_BASE}/rates/latest`)
    const usdJpy: number = res.data.usdJpy
    return records.map((r) => ({ ...r, amount: r.amount / usdJpy }))
  } catch (e: unknown) {
    if (e instanceof AxiosError) {
      // 呼び出し元 (bugsnag 通知など) に委ねるため、握りつぶさず再送出する
    }
    throw e
  }
}
```
呼び出し元の `generateReport` 側で、この失敗を「レポート生成失敗」として扱う分岐を用意する必要がありますわ。

### [4] 強く推奨

**問題**: `filterByCategories` が `activeCategories.includes(r.category)` を `records.filter` の中で呼んでおり、O(records数 × activeCategories数) の計算量になっている。

**理由**: 関数のコメントに「records は最大10万件、activeCategories は最大数千件になりうる」と明記されており、これは最悪ケースで数億回の比較が発生する計算量ですわ。まさに本レビュー観点で挙げられている「巨大配列に対する `Array.includes` の繰り返し」に該当します。データ量が想定どおり増えた場合、同期的にメインスレッドをブロックして応答が大きく遅延する可能性がありますの。

**提案**:
```typescript
export const filterByCategories = (
  records: SalesRecord[],
  activeCategories: string[],
): SalesRecord[] => {
  const activeSet = new Set(activeCategories)
  return records.filter((r) => activeSet.has(r.category))
}
```

---

**問題**: `summarizeByCategory` の `if (!r.amount) continue` が、`amount === 0` の正規レコードとパース失敗（`NaN`）のレコードを区別せずどちらも集計対象から丸ごと除外している。

**理由**: `SalesRecord.amount` のコメントには「無償提供キャンペーンのレコードは 0 になる」と明記されており、`amount === 0` は業務上正当なレコードのはずですわ。それにもかかわらず現在の実装では、これらのキャンペーンレコードが `total` だけでなく `count`（件数）からも消えてしまい、「そのカテゴリに何件レコードがあったか」という集計自体が過小になります。さらに CSV のパース失敗による `NaN`（`!NaN` は `true`）も同じ分岐で無警告のまま握りつぶされており、データ不整合が発生していても気付けない構造になっていますの。

**提案**:
```typescript
for (const r of records) {
  if (Number.isNaN(r.amount)) {
    continue // パース失敗のみ除外。0円の正規レコード（無償キャンペーン）は件数に含める
  }
  const current = summary.get(r.category) ?? { total: 0, count: 0 }
  current.total += r.amount
  current.count += 1
  summary.set(r.category, current)
}
```

---

**問題**: `enrichWithUsdAmount` が成功して USD 換算された金額でも、`formatJpy`／`buildSummaryLines` は常に「¥」記号を付けて表示している。

**理由**: `enrichWithUsdAmount` は `amount / usdJpy` で金額を USD 換算する関数ですが、その値がそのまま `summarizeByCategory` → `buildSummaryLines` に渡り、`formatJpy` によって `¥1,234` のような円表記でフォーマットされますわ。実際には USD 換算後の数値なのに円マークが付くため、表示されたレポートの金額単位が実態と食い違い、利用者に誤った金額情報を提示してしまいます。これは見た目の体裁の問題ではなく、金額データの意味を誤って伝えるロジック上の不整合ですの。

**提案**: `formatJpy` を通貨単位に依存しないフォーマッタにするか、パイプライン全体で通貨単位（JPY/USD）を明示的に持ち回り、表示時に正しい単位を選択するようにしてくださいまし。

### [3] 推奨

**問題**: `paginate` が `pageSize <= 0` や `page <= 0`（または非整数）を検証していない。

**理由**: `pageSize = 0` のとき `totalPages` は `Infinity`（`records.length` が 0 なら `NaN`）になり、`page = 0` や負の値のときは `startIdx` が負数になって `Array.slice` の「末尾からの相対位置」解釈が働き、意図しないレコードが返る可能性がありますわ。呼び出し元がユーザー入力由来のページ番号・ページサイズをそのまま渡す構成であれば、実際に起こりうる入力ですの。

**提案**: 関数冒頭で `pageSize` が正の整数であること、`page` が1以上であることをガードし、不正値はエラーまたは既定値にフォールバックしてくださいまし。

---

**問題**: `parseCsv` が CRLF 改行（`\r\n`）を考慮しておらず、各行末に `\r` が残る可能性がある。

**理由**: `csv.split('\n')` だけでは、Windows 由来の CSV（`\r\n` 区切り）の場合、各行の最終フィールド（`recordedAt`）の末尾に `\r` が残ったまま `parseCsvRow` に渡りますわ。日付として利用する際に不正な値として扱われる恐れがあります。

**提案**:
```typescript
export const parseCsv = (csv: string): SalesRecord[] => {
  return csv
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map(parseCsvRow)
}
```

---

**問題**: `enrichWithUsdAmount` が `res.data.usdJpy` の値を検証せずにそのまま除算に使っている。

**理由**: API のレスポンス形状が想定と異なり `usdJpy` が `0`・`undefined`・非数値だった場合、`amount / usdJpy` は `Infinity` や `NaN` になり、そのまま後続処理（集計・ページング・表示）に伝播しますわ。とくに `NaN` になった場合は前述の `summarizeByCategory` の `!r.amount` 判定にも絡み、レコードが静かに消えるなど連鎖的な不整合を招きます。

**提案**: 取得した `usdJpy` が有限かつ正の数であることを確認し、条件を満たさない場合はエラーとして扱ってくださいまし（`[5]` の提案どおり再送出する経路に載せるのが自然ですわ）。

### [2] 軽微

**問題**: `enrichWithUsdAmount` は `records`（フィルタ後の配列）が空でも常に為替レート取得 API を呼び出している。

**理由**: `generateReport` の呼び出し順序上、`filterByCategories` の結果が空配列になるケース（該当カテゴリなし等）でも無条件に外部 API を呼んでおり、不要なネットワークラウンドトリップが発生しますの。

**提案**:
```typescript
export const enrichWithUsdAmount = async (records: SalesRecord[]): Promise<SalesRecord[]> => {
  if (records.length === 0) {
    return records
  }
  // 既存のロジック
}
```

### [1] 情報

- `parseCsvRow` は単純な `split(',')` によるパースで、カテゴリ名等にカンマが含まれるケースやクォート付きフィールドには対応していません。CSV の発生元が厳密に単純フォーマットであることが保証されているなら問題ありませんが、外部システムからのアップロードを想定するなら確認しておくとよいですわ。
- 今回の実装は状態遷移・ページング・通貨換算など、コメントで意図が明示されている箇所に限って実装とのズレが集中して見つかりました。今後もこの手のドキュメンテーション（意図の明文化）を維持していただけると、レビューの精度がさらに上がりますの✨

## 📚 参考情報

- プロジェクト標準の例外処理パターン（`catch (e: unknown)` → `instanceof AxiosError` による絞り込み）は `reviewer-for-logic` エージェントの embedded rule に定義されている内容を参照していますわ。
