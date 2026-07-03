# ロジックレビュー結果（reviewer-for-logic）

## src/activity-feed.ts

### ✅ 良い点

- `Activity` / `FeedQuery` に型を定義し、公開関数の入出力が明示されている。
- `DEFAULT_MIN_SCORE` や `API_BASE` を定数として切り出しており、意図が読み取りやすい。
- `latestActivities` に「直近 count 件を新しい順で返す」という意図コメントがあり、期待挙動が明示されている（このおかげで後述のバグを検出できた）。

### [5] 必須修正 (ブロッカー)

**問題**: `fetchFeed` が `fetchActivities(userId)` を `await` せずに `return` しているため、`try/catch` の `catch` が絶対に実行されず、エラー時のフォールバック（`[]` を返す）が機能しない。

**理由**:
- `return fetchActivities(userId)` は Promise をそのまま返しているだけで、`fetchFeed` 内では解決も拒否も待っていない。したがって `axios.get` が失敗（ネットワーク障害・4xx/5xx）して Promise が reject しても、その reject は `fetchFeed` の外側の呼び出し元へ伝播し、`catch { return [] }` は決して走らない。
- `fetchFeed` の設計意図は「失敗時に `[]` を返して安全に劣化させる」ことだが、実際にはあらゆる API 失敗時に例外が呼び出し元へ throw される。呼び出し元が `fetchFeed` は throw しない前提で `try/catch` を書いていなければ、未処理の Promise 拒否となり画面破綻・クラッシュに繋がる。API 失敗時に必ず発生する確定的な欠陥である。

**提案**:
```typescript
export const fetchFeed = async (userId: string): Promise<Activity[]> => {
  try {
    return await fetchActivities(userId) // await を付けないと catch が機能しない
  } catch (e: unknown) {
    // 後述 [3] の通り、握りつぶさず Bugsnag 通知＋型ナローイングを行うのが望ましい
    return []
  }
}
```

### [4] 強く推奨

**問題**: `resolveMinScore` の `query.minScore || DEFAULT_MIN_SCORE` は、`minScore` に `0` が明示指定された場合でもデフォルト値 `10` を返してしまう。

**理由**:
- `0` は falsy のため `0 || DEFAULT_MIN_SCORE` は `DEFAULT_MIN_SCORE`（=10）に評価される。`FeedQuery.minScore` は任意プロパティであり、「スコア 0 以上をすべて含めたい（＝しきい値 0）」という正当な入力が握りつぶされ、意図せず 0〜9 のアクティビティが除外される。
- 「未指定」と「明示的な 0」を区別できていないのが根本原因。

**提案**:
```typescript
export const resolveMinScore = (query: FeedQuery): number => {
  return query.minScore ?? DEFAULT_MIN_SCORE // null/undefined のときだけデフォルトへ
}
```

### [3] 推奨

**問題1（sanitizeMessage）**: `message.trim().replace('\n', ' ')` は最初の 1 つの改行しか置換しない。

**理由**: `String.prototype.replace` に文字列を渡すと最初の一致のみ置換される。複数行のメッセージでは 2 つ目以降の `\n` が残り、サニタイズ（1 行化）の意図が達成されない。加えて `\r\n` / `\r` は考慮されていない。

**提案**:
```typescript
export const sanitizeMessage = (message: string): string => {
  return message.trim().replace(/\r\n|\r|\n/g, ' ') // 全改行をグローバル置換
}
```

**問題2（latestActivities）**: `count === 0` のとき、`activities.slice(-count)` は `slice(-0)` → `slice(0)` となり配列全体を返す。

**理由**: `-0 === 0` のため `slice(-0)` は先頭からの全要素を返す。結果として `latestActivities(activities, 0)` は「直近 0 件（空配列）」ではなく全件を新しい順で返してしまう。ページサイズや上限計算の結果として `count` が 0 になり得る場面では期待と真逆の結果になる。負値が渡された場合も `slice` の挙動が非直感的になる。

**提案**:
```typescript
export const latestActivities = (activities: Activity[], count: number): Activity[] => {
  if (count <= 0) return []
  return activities.slice(-count).reverse()
}
```

**問題3（fetchFeed の catch パターン）**: 仮に [5] の `await` を修正しても、`catch { return [] }` は全種類のエラーを無条件に握りつぶしており、プロジェクト標準（API エラーは `unknown` で受け `instanceof AxiosError` でナローイングし Bugsnag へ通知する）に反する。

**理由**: 非 Axios 由来の想定外エラー（プログラミングエラー等）まで `[]` に丸め込まれ、障害の検知・通知が失われる。ステータス別のハンドリングもできない。

**提案**:
```typescript
import type { AxiosError } from 'axios'

// catch (e: unknown) 内で
if (e instanceof AxiosError) {
  // 必要ならステータス別メッセージ処理
  $bugsnag.notify(e)
} else {
  // 想定外エラーとして扱う
}
return []
```

### [2] 軽微

**問題**: `fetchActivities` が `res.data` をそのまま `Activity[]` として返しており、レスポンス形状の検証がない。

**理由**: API が想定外の形（`null`・オブジェクト・欠損フィールド）を返した場合、そのまま下流（`latestActivities` の `slice` など）へ渡り、実行時エラーや不正なレンダリングを誘発し得る。型注釈はコンパイル時保証にすぎず、実データの妥当性は担保されない。最低限、配列であることの確認や欠損時のフォールバックを検討したい。

### [1] 情報

- 本レビューは差分のみで判断可能だったため、変更後ファイル全体の追加参照は行っていない。
- `fetchActivities` はモジュール非公開だが `fetchFeed` 経由でのみ利用される前提と解釈した。直接利用箇所がある場合は [5] のエラーハンドリング欠落の影響範囲が広がる。

## 📚 参考情報

- MDN: `String.prototype.replace` — 文字列引数は最初の一致のみ置換。全置換は正規表現 `g` フラグまたは `replaceAll` を使用。
- `Array.prototype.slice(-0)` は `slice(0)` と等価（`-0 === 0`）で全要素を返す点に注意。
- try/catch でエラーを捕捉するには、返す Promise を `return await` で待つ必要がある（no-return-await 問題との兼ね合いは、捕捉が目的なら await を優先）。
