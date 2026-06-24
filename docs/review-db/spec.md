# review-db 詳細仕様

[summary.md](./summary.md) で決定した方針を踏まえ、実装に落とせる粒度まで詰めた仕様書。

## 1. ゴール

1. `/review:diff` や GitHub Copilot、Codex、`/code-review` などから出力されたレビュー報告書を取り込み、指摘内容（finding）を構造化して保存する。
2. 各 finding に対して **人間がレビュー報告書ファイルに直接書き込んだ評価（tp/fp/nit/oos）** を構造化フィールドとして取り込み、AI レビューの精度向上に資するデータを蓄積する。
3. 蓄積データから知見を蒸留するパイプライン（次フェーズ）の入力源とする。

## 2. 用語

| 用語 | 定義 |
|---|---|
| レビュー報告書（report） | 1回のレビューで出力された 1 ファイル。複数の finding を含む |
| 指摘内容（finding） | 報告書内の個別の指摘 |
| 評価（verdict） | finding に対する判定。`tp` / `fp` / `nit` / `oos` の 4 値、または未評価（NULL） |
| 報告者（reporter） | レビューを行った主体（例：`Codex`、`ClaudeCode code-review`、`GitHub Copilot`、サブエージェント名） |

verdict の意味は [summary.md](./summary.md) を参照。

## 3. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ レビュー報告書（Markdown ファイル）                          │
│  ├ Codex / Copilot / ClaudeCode code-review が出力          │
│  └ 人間が各 finding に評価マーク（verdict / reason）を追記   │
└──────────────────┬──────────────────────────────────────────┘
                   │ ファイルパス渡し
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ bun scripts/review-db.ts import-report                       │
│  ├─→ finding-extractor サブエージェントを呼び出し           │
│  │    （Markdown → 構造化 JSON 変換、verdict も抽出）       │
│  └─→ SQLite に INSERT                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ ${CLAUDE_PLUGIN_DATA}/review.sqlite                          │
│  ├ reports                                                  │
│  └ findings（verdict 込み）                                 │
└─────────────────────────────────────────────────────────────┘
```

## 4. データベース

### 4.1 保存場所

- パス：`${CLAUDE_PLUGIN_DATA}/review.sqlite`
- プロジェクト横断で 1 ファイルに蓄積する。
- バックアップは利用者の責任（個人利用想定）。

### 4.2 ORM / マイグレーション

- **Drizzle ORM** を採用する。
  - スキーマファーストで TypeScript の型推論が強く、マイグレーションの自動生成が利く。
  - bun + better-sqlite3 ドライバで動作する。
- マイグレーションファイルは `cbo/scripts/review-db/migrations/` に配置。
- 初回起動時に未適用のマイグレーションを自動適用する（CLI 内で実行）。

### 4.3 スキーマ

```ts
// cbo/scripts/review-db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),                       // UUIDv7
  filePath: text('file_path').notNull().unique(),    // 絶対パス。冪等キー
  createdAt: text('created_at').notNull(),           // ISO8601
  model: text('model'),                              // nullable
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),                       // UUIDv7
  reportId: text('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),                      // 指摘本文（全文）
  targetPath: text('target_path'),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
  codeBefore: text('code_before'),
  codeAfter: text('code_after'),
  severity: integer('severity').notNull(),           // 1-5
  category: text('category').notNull(),              // design/logic/style/comments/security/performance/test
  reporter: text('reporter').notNull(),              // 自由文字列
  verdict: text('verdict'),                          // tp/fp/nit/oos | NULL
  verdictReason: text('verdict_reason'),             // nullable
});
```

### 4.4 制約・インデックス

- `findings.severity` は `CHECK (severity BETWEEN 1 AND 5)`
- `findings.category` は `CHECK (category IN (...))`
- `findings.verdict` は `CHECK (verdict IN ('tp','fp','nit','oos') OR verdict IS NULL)`
- インデックス：
  - `idx_findings_report_id`（report ごとの取得用）
  - `idx_findings_verdict`（未評価 finding の検索用）
  - `idx_findings_reporter`（reporter 別集計用）
  - `reports.file_path` は UNIQUE 制約（冪等キー）。専用インデックスは UNIQUE 制約により自動生成される

### 4.5 冪等性

- 冪等キーは **report の絶対ファイルパス**（`reports.file_path` の UNIQUE 制約）。
- `import-report` 実行時に同一パスの report があれば、当該 report の `id` を保持したまま **findings を CASCADE で全削除 → ファイルから再抽出して再 INSERT**（UPSERT 動作）する。
  - これにより、評価追記後の再 import は同じ report に対する findings の差し替えとして自然に表現される。
  - finding ID は再生成される点に注意（finding ID を外部から参照している場合は壊れる。本仕様では外部参照は想定しない）。
- ファイルを移動・リネームした場合は別 report として扱われる。意図せず重複した場合は手動 DELETE で対処する（将来的に `relocate` サブコマンドの追加を検討、§ 10）。

## 5. CLI: `bun scripts/review-db.ts`

すべてのサブコマンドは `cbo/scripts/review-db.ts` をエントリポイントとする。

### 5.1 サブコマンド一覧

| サブコマンド | 役割 |
|---|---|
| `import-report <path>` | 報告書ファイルを取り込み、finding-extractor を呼んで DB に投入。verdict もファイル内の記述から抽出する。冪等キーは絶対ファイルパス。同じパスで再実行すると UPSERT（report は同 ID 保持、findings は CASCADE 削除して再 INSERT） |
| `set-verdict <finding-id> <verdict> [--reason <text>]` | 単一 finding に評価を書き込む（ad-hoc 修正用。通常はファイル編集＋ `import-report` で同期する） |
| `list reports [--limit N]` | 報告書一覧を表示 |
| `list findings [--report-id <id>] [--unverdicted] [--reporter <name>]` | finding 一覧を表示 |
| `show finding <id>` | finding の詳細を表示 |
| `export [--format json\|csv] [--output <path>]` | 全 finding をエクスポート |
| `migrate` | マイグレーションを手動実行 |

### 5.2 出力形式

- 既定は `key=value` の 1 行 1 レコード形式（[[feedback_simple_script_output]] に準拠）。
- `--json` フラグで JSON 出力に切り替え可能。
- `export` のみ用途上 JSON / CSV を選択。

### 5.3 `import-report` 詳細

1. ファイル存在チェックと絶対パスへの正規化。
2. `finding-extractor` サブエージェントを呼び出し、構造化 JSON を取得。
3. JSON Schema で検証（zod 等）。失敗時はエラー終了。
4. トランザクション内で UPSERT：
   - 同一 `file_path` の report が存在する場合：当該 report の `id` を保持しつつ、紐づく findings を CASCADE で全削除し、新しい findings を INSERT。
   - 存在しない場合：UUIDv7 で `report.id` を発番し、`reports` と `findings` を INSERT。
5. 投入結果を `key=value` で表示（`report_id=...`, `findings_count=...`, `verdicted_count=...`, `unverdicted_count=...`）。

### 5.4 評価の同期フロー

評価は **レビュー報告書ファイルへの追記** が一次情報源。DB はファイルの抽出結果を保持するキャッシュ層として扱う。

1. 人間が報告書ファイルを開き、各 finding の近くに評価マークを追記する（後述 § 7）。
2. `bun scripts/review-db.ts import-report <path>` を再実行する。
3. 同一パスの report は UPSERT され、既存 findings は CASCADE で削除されたうえで評価込みで再 INSERT される。
4. ad-hoc な修正のみ DB へ直接反映したい場合は `set-verdict <finding-id> <verdict> [--reason ...]` を使う。ただしファイルとの整合性は手動管理になる点に注意。

## 6. エージェント: `finding-extractor`

### 6.1 役割

レビュー報告書（Markdown）を読み、指摘内容を構造化 JSON として抽出する。

### 6.2 配置と仕様

| 項目 | 内容 |
|---|---|
| 配置先 | `cbo/agents/finding-extractor.md` |
| モデル | Sonnet（安定運用後に Haiku への切り替えを検討） |
| ツール権限 | `Read` のみ |
| 入力 | レビュー報告書のファイルパス、reporter 名（ヒント） |
| 出力 | 後述の JSON Schema に従う配列 |

### 6.3 出力スキーマ

```ts
type ExtractedFinding = {
  body: string;            // 指摘本文（全文）
  targetPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  codeBefore: string | null;
  codeAfter: string | null;
  severity: 1 | 2 | 3 | 4 | 5;
  category:
    | 'design' | 'logic' | 'style' | 'comments'
    | 'security' | 'performance' | 'test';
  reporter: string;        // ヒントで渡された値をそのまま採用、または報告書内に明記があれば上書き
  verdict: 'tp' | 'fp' | 'nit' | 'oos' | null;  // 報告書内の評価マークから抽出。無ければ null
  verdictReason: string | null;                  // 評価マークに reason があれば抽出
};
```

### 6.4 プロンプト方針

- 1 つのプロンプトで Codex / Copilot / ClaudeCode 全フォーマットを吸収する（reporter ごとに分岐しない）。
- severity と category は報告書中に明記がなければエージェントが内容から推定する。
- verdict と verdictReason は **`**評価**:` / `**評価理由**:` フィールド（§ 7.1）に明示的に書かれている値のみ抽出する**。値が空の場合や該当行が無い場合は必ず null とする。エージェントが推定して埋めることは禁止。
- 推定根拠を別カラムに残す要件は現時点では持たない（必要になったら schema 拡張）。

## 7. レビュー報告書内の評価記法

評価は **人間がレビュー報告書ファイル（Markdown）に直接書き込む** ことを唯一の入力経路とする。AI による自動評価は本仕様の範囲外（§ 10「将来検討」を参照）。

### 7.1 記法

各 finding ブロックの末尾に、既存テンプレート（[`cbo/skills/document-saver/references/format-review-result.md`](../../cbo/skills/document-saver/references/format-review-result.md)）と同じ `**項目**:` 形式で `**評価**` と `**評価理由**` を追記する。

```markdown
### R000 [5] 必須修正 (ブロッカー)
**問題**: ユーザー削除時のトランザクション境界が不正
**理由**: 削除途中で例外が出ると関連レコードが孤立する
**報告者**: @reviewer-for-logic
**提案**:
```typescript
// 改善後のコード例
```
**評価**: tp
**評価理由**: 実害あり。次の PR で対応する。
```

- `**評価**:` の値は `tp` / `fp` / `nit` / `oos` のいずれか、または空（未評価）。
- `**評価理由**:` は任意。空欄でもよい。複数行に渡る場合は次行以降に通常の本文として続ける。
- 評価マークが付いていない、または値が空の finding は `verdict = NULL`（未評価）として扱う。

### 7.2 テンプレート修正

既存テンプレート [`cbo/skills/document-saver/references/format-review-result.md`](../../cbo/skills/document-saver/references/format-review-result.md) に **`**評価**:`** と **`**評価理由**:`** フィールドを各 finding 例（R000〜R004）の末尾に追加する。初期値は空とし、人間が後から書き込む運用とする。詳細タスクは `tasks.md` で扱う。

### 7.3 評価ルーブリック

報告書を書き込む人間が参照する基準。エージェントの自動評価は行わないため、エージェントには織り込まない。

- **tp**：指摘が技術的に正しく、修正することでコード品質が向上する。
- **fp**：指摘が誤り、または既に解決済み・実害なし。
- **nit**：指摘自体は正しいが、品質への寄与が極めて小さい些末事項。
- **oos**：指摘は正しいがスコープ外で、当該変更で対応すべきでない。

判定に迷う場合は **より厳しい側**（`tp` > `nit` > `fp` の順で安全側）を選ぶ。

## 8. ユースケース

### 8.1 評価込みのレビュー報告書を取り込む

```bash
# 1. 人間がレビュー報告書を編集し、各 finding に評価マーク（§ 7.1）を追記する
#    例：> verdict: tp / > reason: ...

# 2. 報告書を取り込み
bun scripts/review-db.ts import-report ./reviews/2026-06-23-pr-42.md

# 3. 出力例（key=value 形式）
# report_id=01977e2a-...
# findings_count=7
# verdicted_count=5
# unverdicted_count=2

# 4. 結果確認
bun scripts/review-db.ts list findings --report-id 01977e2a-... --json
```

### 8.2 評価を後から追記する

```bash
# 1. 初回 import 時点では未評価で投入
bun scripts/review-db.ts import-report ./reviews/2026-06-23-pr-42.md

# 2. 後日、人間が報告書ファイルに評価マークを追記

# 3. 再 import で同期（同一パスなので UPSERT、findings は CASCADE で再構築）
bun scripts/review-db.ts import-report ./reviews/2026-06-23-pr-42.md
```

### 8.3 既存データの集計

```bash
# reporter 別の偽陽性率を出すため、JSON でエクスポートして任意のツールで集計
bun scripts/review-db.ts export --format json --output ./review-export.json
```

## 9. 含めない項目（再掲）

[summary.md](./summary.md) より。

- PR 番号 / ブランチ名 / 対象コミット SHA
- 人間評価者情報
- 評価日時（report.created_at で代用）
- 重複指摘リンク
- 修正コミット SHA

## 10. 将来検討

- **AI による補助評価**：人間評価が主だが、未評価 finding に対して仮判定を提示するサブエージェント（仮称 `verdict-suggester`）を後付けする余地は残す。人間が報告書に書き込む前のたたき台用途。
- **`relocate` サブコマンド**：レビュー報告書ファイルを移動・リネームした際、既存 report の `file_path` を新パスに更新する CLI を追加する。現状は手動 DELETE → 再 import で対処。
- 重複 finding の検出と紐付け（同一指摘が複数報告書に出現するケース）。
- knowledge-distiller スキルへの接続（評価済み finding の傾向を蒸留）。
- reporter マスタテーブルの導入（自由文字列から正規化）。
- Web UI / TUI ビューワー（個人利用なので優先度低）。
