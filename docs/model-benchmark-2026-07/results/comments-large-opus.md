# コメントレビュー結果（reviewer-for-comments）

## export-pipeline.ts

### ✅ 良い点

- `JOB_ID_PATTERN` に付いた `// ジョブ ID はサーバー側で UUID v4 として発行される` は、正規表現（`4[0-9a-f]{3}` と `[89ab]` で UUID v4 のバージョン・バリアントを表現）が「なぜこの形か」を的確に説明しており、実装とも一致した良い *why* コメントです。
- `DOWNLOAD_URL_TTL_MINUTES` に付いた `// S3 の presigned URL は 15 分で失効するため、取得後は速やかにダウンロードを開始する` は、定数値の背景と運用上の注意点（*why*）を説明しており有用です。

### [4] 強く推奨

**問題**: `selectExportTargets` の JSDoc が実装と正反対の説明になっています。
```typescript
/**
 * エクスポート対象のレコードを返す。
 * アーカイブ済みのレコードは対象から除外する。   // ← ここが逆
 */
export const selectExportTargets = (records: ExportRecord[]): ExportRecord[] => {
  return records.filter((r) => r.archived)   // アーカイブ済みだけを「残す」
}
```
**理由**: コメントは「アーカイブ済みを除外する」と述べていますが、`filter((r) => r.archived)` はアーカイブ済みレコードだけを *残す*（非アーカイブを除外する）処理です。読み手がコメントを信じると呼び出しコードを誤ります。実装の当否ではなく、コメントと実装の矛盾を指摘しています。
**提案**:
```typescript
/**
 * エクスポート対象のレコードを返す。
 * （現状の実装は archived が true のレコードのみを返す。コメントと実装のどちらが正か要確認）
 */
```

---

**問題**: `sortByCreatedAt` のコメント（本文・`@returns` 双方）が「昇順」と述べているのに、実装は降順です。
```typescript
/**
 * レコードを作成日時の昇順で並べ替えて返す。          // ← 実際は降順
 * @returns 作成日時の昇順でソートされた新しい配列       // ← 実際は降順
 */
export const sortByCreatedAt = (records: ExportRecord[]): ExportRecord[] => {
  return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))  // b vs a = 降順
}
```
**理由**: `b.createdAt.localeCompare(a.createdAt)` は降順ソートです。コメントの「昇順」は実装と食い違っており、`@returns` タグの記述も同様に誤っています。
**提案**:
```typescript
/**
 * レコードを作成日時の降順で並べ替えて返す。
 * @returns 作成日時の降順でソートされた新しい配列
 */
```

---

**問題**: `POLL_INTERVAL` の JSDoc が単位を「ミリ秒」と記載していますが、実際は「秒」です。
```typescript
/** ポーリング間隔（ミリ秒） */   // ← 実際は「秒」
const POLL_INTERVAL = 5
// ...
await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 1000))  // ×1000 している
```
**理由**: 利用箇所で `POLL_INTERVAL * 1000` として `setTimeout`（ミリ秒指定）へ渡しているため、`POLL_INTERVAL` の単位は「秒」です。仮にミリ秒なら `* 1000` は不要になります。コメントが単位を取り違えており、5 という値の意味（5 秒）を誤解させます。
**提案**:
```typescript
/** ポーリング間隔（秒） */
const POLL_INTERVAL = 5
```

---

**問題**: `toCsv` のコメントが存在しない関数名 `buildCsvRow()` を参照しています。
```typescript
// CSV のエスケープ処理は後述の buildCsvRow() で行う   // ← 実在しない
export const toCsv = (records: ExportRecord[]): string => {
  const rows = records.map(formatCsvRow)               // 実際の関数名は formatCsvRow
```
**理由**: 実際にエスケープを担う関数は `formatCsvRow`（同ファイル内で定義）であり、`buildCsvRow` はこのファイルに存在しません。参照先シンボルが解決できず、コメントが誤った案内をしています。
**提案**:
```typescript
// CSV のエスケープ処理は後述の formatCsvRow() で行う
```

---

**問題**: `exportToJson` の JSDoc が実装（JSON 出力）とまったく別の処理（CSV 出力）を説明しています。
```typescript
/**
 * レコードを CSV 形式でエクスポートする。                     // ← 実際は JSON
 * ヘッダ行を先頭に付与し、各レコードをカンマ区切りの行として出力する。  // ← 実際は JSON.stringify
 */
export const exportToJson = (records: ExportRecord[]): string => {
  return JSON.stringify({ records, exportedAt: new Date().toISOString() }, null, 2)
}
```
**理由**: 関数名・実装ともに JSON 出力（`JSON.stringify`）ですが、コメントは「CSV 形式」「ヘッダ行」「カンマ区切りの行」と CSV の説明になっています。`toCsv` のコメントを流用した際の取り違えと思われ、読み手を強く誤導します。
**提案**:
```typescript
/**
 * レコードを JSON 形式でエクスポートする。
 * records 配列と exportedAt（エクスポート時刻）を持つオブジェクトを整形して出力する。
 */
```

---

**問題**: レビュー履歴（作業経緯）コメントが残っています。
```typescript
export const startExportJob = async (recordIds: string[]): Promise<ExportJob> => {
  // レビュー指摘対応: LOGIC-3     // ← 作業経緯コメント
  const res = await axios.post(`${API_BASE}/exports`, { recordIds })
```
**理由**: 「レビュー指摘対応: LOGIC-3」はコードそのものの理解を助けるものではなく、「どのレビュー指摘に対応したか」という *編集の経緯* を記録するコメントです。この種の情報は Git 履歴・PR・レビュースレッドが適切な保管先です。
**提案**: 行ごと削除してください。

### [3] 推奨

**問題**: `summarize` 内の `// 結果を返す` が、コードを言い換えただけの冗長コメントです。
```typescript
  // 結果を返す
  return { count: records.length, totalSizeBytes }
```
**理由**: `return` 文が「結果を返す」ことは自明で、コメントが情報を追加していません（*what* の言い換え）。
**提案**: 行ごと削除してください。

---

**問題**: `waitForJob` 内のコメントに絵文字が含まれています。
```typescript
    // 🚀 fast path: 終端状態なら即 return
```
**理由**: コード内コメントに装飾絵文字（🚀）を含めるべきではありません。意味は絵文字ではなくテキストで表現します。
**提案**: 絵文字を除去します。例: `// fast path: 終端状態なら即座に return する`

---

**問題**: `runExport` の JSDoc に丸囲み数字（①②③）が使われています。
```typescript
/**
 * エクスポートの流れ:
 * ① 対象レコードの絞り込み
 * ② ジョブの開始
 * ③ 完了までポーリング
 */
```
**理由**: 丸囲み数字（①②③）は環境によって読みづらく、コード内では通常の数字やリストマーカーを使うべきです。コメントの内容自体は `runExport` の処理と一致しており良好なので、記法のみ修正すれば足ります。
**提案**:
```typescript
/**
 * エクスポートの流れ:
 * 1. 対象レコードの絞り込み
 * 2. ジョブの開始
 * 3. 完了までポーリング
 */
```

---

**問題**: `formatCsvRow` のコメントが「RFC 4180 に準拠」と述べていますが、実装は RFC 4180 の要件を一部満たしていません。
```typescript
// RFC 4180 に準拠し、カンマまたはダブルクォートを含む値のみクォートする
const formatCsvRow = (r: ExportRecord): string => {
  const needsQuote = r.name.includes(',') || r.name.includes('"')
```
**理由**: RFC 4180 では、値に「カンマ」「ダブルクォート」に加え「改行（CRLF）」を含む場合もクォートが必要です。実装は改行を判定しておらず、「RFC 4180 準拠」という表記は実装より広い準拠範囲を主張しています（本文の「のみクォートする」という限定と合わせても、規格名の引用が過剰）。読み手が完全準拠と誤解する恐れがあります。改行処理を追加するか否かは logic レビューの範囲ですが、コメントの主張と実装の乖離としてここで指摘します。
**提案**: 規格名の主張を控えるか、限定を明示します。例: `// カンマまたはダブルクォートを含む値をクォートする（RFC 4180 の一部。改行を含む値の扱いは未対応）`

### [1] 情報

- `waitForJob` は最大 `maxPolls` 回、`POLL_INTERVAL`（秒）間隔でポーリングするため、最悪待機時間は `maxPolls × POLL_INTERVAL` 秒になります。タイムアウトの計算根拠が読み手に伝わりにくいので、`waitForJob` 付近に一行の補足（例: `// 最大 maxPolls × POLL_INTERVAL 秒待機し、超過時は例外を投げる`）を添えると理解を助けます。

## 📚 参考情報
- RFC 4180（Common Format and MIME Type for CSV Files）: https://www.rfc-editor.org/rfc/rfc4180
- JSDoc `@returns` タグ: https://jsdoc.app/tags-returns
