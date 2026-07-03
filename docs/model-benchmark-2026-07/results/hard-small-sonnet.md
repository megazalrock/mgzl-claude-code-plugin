# ロジックレビュー結果（reviewer-for-logic）

## src/activity-feed.ts

### ✅ 良い点

- `Activity` / `FeedQuery` の型が明確に定義されており、以降の実装で型安全に扱える下地ができている。
- `fetchFeed` がエラー時に空配列へフォールバックするという設計方針自体は、呼び出し元での例外ハンドリング負担を減らす妥当な考え方である。
- `latestActivities` にコメントで「直近 count 件を新しい順で返す」という意図が明記されており、期待仕様が読み取りやすい。

### [5] 必須修正 (ブロッカー)

**問題**: `fetchFeed` 内で `fetchActivities(userId)` の Promise を `await` せずに `return` しているため、`fetchActivities` が reject してもこの `try/catch` では捕捉できない。

**理由**: `async` 関数内で `try` ブロックから Promise を `await` せずに `return` すると、`try` ブロック自体は同期的に（例外を投げずに）完了してしまう。その後 Promise が reject しても、その rejection は `catch` を素通りして `fetchFeed` が返す Promise にそのまま伝播する。結果として、意図されている「失敗時は空配列を返す」というフォールバック仕様が実際には一切機能せず、`axios` のネットワークエラーや 4xx/5xx はすべて未処理のまま呼び出し元に伝わり、呼び出し元が catch していなければ unhandled rejection になる。これは `axios.get` が失敗するあらゆるケース（サーバーダウン、404、500 など）で確実に発生する。

**提案**:
```typescript
export const fetchFeed = async (userId: string): Promise<Activity[]> => {
  try {
    return await fetchActivities(userId)
  } catch (e: unknown) {
    // ここで初めて catch が機能する
    return []
  }
}
```

### [4] 強く推奨

**問題**: `resolveMinScore` が `query.minScore || DEFAULT_MIN_SCORE` としており、`minScore: 0` が明示的に指定された場合でもデフォルト値 `10` に上書きされてしまう。

**理由**: `0` は falsy 値であるため `||` 演算子ではフォールバックが発動する。`FeedQuery.minScore` は `number` 型であり `0` は正当な入力（「最低スコア0＝すべて表示」の意図）だが、現状の実装ではこれを「未指定」と区別できず、常に `10` 未満のアクティビティが除外されてしまう。

**提案**:
```typescript
export const resolveMinScore = (query: FeedQuery): number => {
  return query.minScore ?? DEFAULT_MIN_SCORE
}
```

**問題**: `sanitizeMessage` の `message.trim().replace('\n', ' ')` は最初の改行1つしか置換しない。

**理由**: `String.prototype.replace` に文字列を渡した場合、グローバルフラグ付き正規表現でない限り最初にマッチした箇所のみを置換する。複数行のメッセージ（例: `"line1\nline2\nline3"`）を渡すと `"line1 line2\nline3"` のように2つ目以降の改行が残存し、「sanitize（無害化・整形）」という関数名が示す意図（改行を持たない1行の文字列にする）を満たさない。

**提案**:
```typescript
export const sanitizeMessage = (message: string): string => {
  return message.trim().replace(/\n/g, ' ')
}
```

**問題**: `fetchFeed` の `catch` がエラーを引数なしで受けており、ネットワークエラー・404・500などあらゆる失敗を無区別に空配列へもみ消している。

**理由**: プロジェクト標準では API エラーを `catch (e: unknown)` で受けて `instanceof AxiosError` により型を絞り込み、ステータスに応じたハンドリングとエラー通知（Bugsnag 等）を行うことになっている。現状の実装ではサーバー障害・認証エラー・単なるネットワーク瞬断のいずれも区別できず、「アクティビティが0件」という誤った空状態としてユーザーに見えてしまう上、障害発生自体が検知されない。上記 `[5]` の `await` 漏れを修正した際に、あわせて対応する必要がある。

**提案**:
```typescript
export const fetchFeed = async (userId: string): Promise<Activity[]> => {
  try {
    return await fetchActivities(userId)
  } catch (e: unknown) {
    if (e instanceof AxiosError) {
      // ステータスに応じたハンドリングとエラー通知（Bugsnag等）をここで行う
    }
    return []
  }
}
```

### [3] 推奨

**問題**: `latestActivities` は `count === 0` を渡すと配列全体（を反転したもの）を返してしまい、「0件返す」という意図に反する。

**理由**: JavaScript では `-0` は数値としては `0` と等価に扱われるため、`activities.slice(-count)` に `count = 0` を渡すと `slice(-0)` は `slice(0)` と同じ、つまり配列全体を意味する。呼び出し元が「直近0件（＝何も表示しない）」のつもりで `count: 0` を渡した場合、実際には全件が新しい順で返ってしまう。

**提案**:
```typescript
export const latestActivities = (activities: Activity[], count: number): Activity[] => {
  if (count <= 0) return []
  return activities.slice(-count).reverse()
}
```

### [2] 軽微

**問題**: `latestActivities` は `count` が負数や非整数（`NaN` 含む）の場合の挙動を保証していない。

**理由**: 例えば `count: -3` を渡すと `slice(-(-3))` すなわち `slice(3)`（先頭3件を除いた残り全部）が返るなど、関数名・コメントが示す「直近 count 件」の意図とは無関係な挙動になる。呼び出し元が誤った値を渡しても検知できず、不可解な結果を返すバグの温床になり得る。

**提案**:
```typescript
export const latestActivities = (activities: Activity[], count: number): Activity[] => {
  const safeCount = Math.max(0, Math.trunc(count))
  if (safeCount === 0) return []
  return activities.slice(-safeCount).reverse()
}
```

### [1] 情報

- `FeedQuery` / `resolveMinScore` が定義されているが、今回の差分内の `fetchActivities` / `fetchFeed` ではまったく参照されておらず、`minScore` によるフィルタリングが実際には行われていない。今回渡された差分の範囲では意図的な段階実装（別PRで結線予定）か実装漏れかを判断できないため、統合先の呼び出し箇所を確認することを推奨する。

## 📚 参考情報
- MDN: `Array.prototype.slice()` — 負数インデックスの扱い、および `-0` が `0` として扱われる挙動
- MDN: `String.prototype.replace()` — 文字列パターン指定時は最初の一致のみ置換される仕様（グローバル置換には `/pattern/g` が必要）
- プロジェクト標準の API エラーハンドリングパターン（`catch (e: unknown)` + `instanceof AxiosError`）
