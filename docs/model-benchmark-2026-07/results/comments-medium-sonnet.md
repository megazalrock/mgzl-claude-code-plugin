# コメントレビュー結果（reviewer-for-comments）

## src/retry-client.ts

### ✅ 良い点

- `postOnce` の JSDoc（「冪等でない POST は再試行しない。呼び出し側でリトライの可否を判断できるよう、エラーはそのまま伝播させる。」）は、実装（try/catch を持たずエラーがそのまま呼び出し元に伝わる）と正確に一致しており、かつ「なぜ再試行しないのか」という非自明な設計意図を短く説明できている良い comment です。

### [4] 強く推奨

**問題**: `fetchWithRetry` の JSDoc は「リソースが見つからない場合は null を返す。」と書かれていますが、実装は 404 の場合に `null` を返さず `NotFoundError` を **throw** しています（`if (e.response?.status === 404) { throw new NotFoundError(...) }`）。
**理由**: 実装と正反対の内容を主張する「誤解を招くコメント」です。この記述を信じた呼び出し側は `const data = await fetchWithRetry(...)` の結果を `null` チェックだけで済ませてしまい、実際には例外を捕捉し損ねてクラッシュします。
**提案**:
```typescript
/**
 * リソースを取得する。失敗時は指数バックオフで再試行し、
 * リソースが見つからない場合（404）は NotFoundError を throw する。
 *
 * @param url 取得先の URL
 * @param options リトライ・タイムアウト設定
 */
```

**問題**: 同じ JSDoc の `@param options.timeoutMs` は、`RetryOptions` に存在しないプロパティ名を参照しています。実際のフィールド名は `timeoutSeconds` であり（`options.timeoutSeconds * 1000` として使用されている）、単位も ms ではなく秒です。また `options` 自体の `@param` がなく、`maxAttempts` / `baseDelayMs` の説明も欠落しています。
**理由**: 存在しないシンボル名を指すタグは読者を誤誘導し、実際に使う際に型定義との食い違いに気づかせてしまいます。
**提案**:
```typescript
/**
 * @param url 取得先の URL
 * @param options.maxAttempts 最大試行回数
 * @param options.baseDelayMs リトライ間隔の基準値（ミリ秒、試行回数に比例して増加）
 * @param options.timeoutSeconds リクエスト単体のタイムアウト（秒）
 */
```

**問題**: `// Retry-After ヘッダの解釈は parseRetryAfter() に委ねる` というコメントがありますが、`parseRetryAfter()` という関数はファイル内のどこにも定義・呼び出しされていません。実際の遅延計算は `options.baseDelayMs * attempt` のみで、レスポンスの `Retry-After` ヘッダを読み取る処理は一切存在しません。
**理由**: 存在しない関数への参照であるだけでなく、「ヘッダを解釈する処理がどこかにある」という誤った期待を読者に与える誤解を招くコメントでもあります。
**提案**: 実装に合わせてコメントを修正するか削除してください。
```typescript
// 単純な線形バックオフ（Retry-After ヘッダは未対応）
const delay = options.baseDelayMs * attempt
```

### [3] 推奨

**問題**: `// カウンタをインクリメント` が `attempt += 1` の直前にありますが、コードをそのまま読み下しただけの内容です。
**理由**: コードから自明な操作を説明しているだけで、読者の理解を助けません。
**提案**: 削除してください。

**問題**: `// const legacyDelay = 3000` というコメントアウトされたコードが残っています。
**理由**: 使われていない過去の実装はコメントとして残す価値がなく、Git 履歴で十分に追跡可能です。`// keep for reference because ...` のような明示的な理由も付いていません。
**提案**: 削除してください。

**問題**: `RETRYABLE_STATUS` 直前の一文「リトライ対象とするステータスコードに関しては、サーバー側の一時的な過負荷という形で発生するものを対象とするという方針で選定を行っている」は約67文字と長く、かつ「〜に関しては」「〜という形で」（2回）といった冗長な接続表現が重なっています。
**理由**: 一文が長く婉曲表現が多いため、意図（なぜこの4つのステータスコードを選んだか）が読み取りにくくなっています。
**提案**:
```typescript
// リトライ対象は、サーバー側の一時的な過負荷に起因するステータスコードのみとする
const RETRYABLE_STATUS = [429, 502, 503, 504]
```

### [1] 情報

- `fetchWithRetry` は `NotFoundError`（404時）および最大試行回数超過時の直近のエラーを throw します。JSDoc に `@throws {NotFoundError}` 等のタグを追加すると、呼び出し側が例外処理を書く際の助けになります。

## 📚 参考情報
- JSDoc `@throws` タグの書き方: https://jsdoc.app/tags-throws
