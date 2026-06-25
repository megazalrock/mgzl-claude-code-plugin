# review-db 実装タスク

[spec.md](./spec.md) で確定した仕様を実装に落とすためのタスクリスト。実装に着手する前に必ず spec.md / [summary.md](./summary.md) を一読すること。

## 前提

- 言語・ランタイム：TypeScript + bun
- ORM：Drizzle ORM + better-sqlite3
- バリデーション：zod
- ID 採番：UUIDv7
- CLI 引数パース：Node.js 標準 `util.parseArgs`（外部ライブラリ追加禁止）
- 既存ルール：CLAUDE.md・[[feedback_simple_script_output]]・[[feedback_skill_trigger_words]] に準拠

## タスク一覧（フェーズ別）

### Phase 0: 依存追加

| # | タスク | 完了基準 |
|---|---|---|
| 0-1 | `package.json` に `drizzle-orm` / `drizzle-kit` / `better-sqlite3` / `zod` / `uuidv7` を追加 | `bun install` が成功し、各モジュールが import 可能 |

### Phase 1: DB スキーマとマイグレーション

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 1-1 | `cbo/skills/review__import-report/scripts/schema.ts` 作成（spec.md § 4.3 をそのまま実装） | 0-1 | `import { reports, findings } from './schema'` が解決可能 |
| 1-2 | `drizzle.config.ts` を `cbo/skills/review__import-report/scripts/` 配下に作成（`schema.ts` を入力、`migrations/` を出力先に） | 1-1 | `drizzle-kit generate` で SQL マイグレーションが生成される |
| 1-3 | 初期マイグレーション SQL を生成して `migrations/` にコミット | 1-2 | `migrations/0000_init.sql` 等が存在し、`reports` / `findings` テーブル + UNIQUE 制約 + インデックスが含まれる |
| 1-4 | DB 接続ユーティリティ（`db.ts`）作成。`${CLAUDE_PLUGIN_DATA}/review.sqlite` を開き、`PRAGMA foreign_keys = ON` を設定 | 1-1 | 単体で db オブジェクトを export できる |
| 1-5 | マイグレーション適用ヘルパ（`migrate.ts`）作成。未適用のものを自動適用 | 1-3, 1-4 | 関数を呼ぶと migrations/ 配下を全適用、再実行で no-op |

### Phase 2: CLI 実装（`review-db.ts`）

すべて `cbo/skills/review__import-report/scripts/review-db.ts` に集約。サブコマンド分岐は `switch`、オプションは `util.parseArgs` で実装。

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 2-1 | エントリポイント・サブコマンド分岐の骨組み。`migrate` サブコマンドを実装（1-5 を呼ぶ） | 1-5 | `bun run review-db.ts migrate` で DB が初期化される |
| 2-2 | `import-report` サブコマンド（spec.md § 5.3）。`<path>` の mtime 取得、`--findings` JSON 読込、zod 検証、`--model` 受け取り、UPSERT、`key=value` 出力 | 2-1 | サンプル JSON を渡して UPSERT が成功し、既存パスで再実行すると findings が CASCADE 再構築される |
| 2-3 | `set-verdict` サブコマンド | 2-1 | 指定 finding-id の verdict / verdict_reason が更新される |
| 2-4 | `list reports`（`--limit` / `--json`） | 2-1 | デフォルトは key=value 1 行 1 レコード、`--json` で配列形式 |
| 2-5 | `list findings`（`--report-id` / `--unverdicted` / `--reporter` / `--full` / `--json`） | 2-1 | body はデフォルト 80 字 + `…`、`--full` で全文 |
| 2-6 | `show finding <id>`（`--full` / `--json`） | 2-1 | body はデフォルト 200 字 + `…`、`--full` で全文 |
| 2-7 | `export`（`--format json\|csv` / `--output`） | 2-1 | `findings` 全件＋ `reports` JOIN 結果を出力 |
| 2-8 | `--help` 表示。サブコマンド一覧とオプションを簡素に列挙 | 2-1 | `bun run review-db.ts --help` で全サブコマンドが見える |

### Phase 3: サブエージェント

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 3-1 | `cbo/agents/finding-extractor.md` 作成。spec.md § 6 に従う。プロンプト内に出力スキーマ（spec.md § 6.3）を明示、severity/category 推定可、verdict 推定禁止のルールを織り込む。ツール権限は `Read` のみ、モデルは Sonnet | なし | エージェントとして登録され、Markdown 報告書を渡すと finding 配列 JSON が返る |

### Phase 4: スキル本体

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 4-1 | `cbo/skills/review__import-report/SKILL.md` 作成。description はトリガーフレーズ 3〜5 個（[[feedback_skill_trigger_words]] に準拠）。手順は spec.md § 7.3 をそのまま | 2-2, 3-1 | スキルとして登録され、トリガーフレーズで起動する |
| 4-2 | スキル内のフロントマター読み取りロジック（小スクリプト or インライン処理）。YAML パーサは bun 標準 or 必要なら `yaml` を Phase 0 に追加 | 4-1 | `reporter` / `model` が取得できる。フロントマター無しなら null |

### Phase 5: 既存テンプレート / スキルの修正（spec.md § 8.4）

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 5-1 | [`cbo/skills/document-saver/references/format-review-result.md`](../../cbo/skills/document-saver/references/format-review-result.md) に YAML フロントマター（`reporter` / `model`）を追加。各 R000〜R004 例に `**評価**:` / `**評価理由**:` を空欄で追加 | なし | テンプレートを使った新規レビュー結果にフロントマターと評価欄が出現する |
| 5-2 | [`cbo/skills/review__diff/SKILL.md`](../../cbo/skills/review__diff/SKILL.md) の手順 9 に「統合レビュー結果にフロントマター（`reporter`、`model`）を埋める」旨を追加 | 5-1 | 実行時にフロントマター入りで保存される |
| 5-3 | [`cbo/skills/review__file/SKILL.md`](../../cbo/skills/review__file/SKILL.md) の手順 3 に同様の指示を追加 | 5-1 | 同上 |
| 5-4 | [`cbo/skills/review__plan/SKILL.md`](../../cbo/skills/review__plan/SKILL.md) に同様の指示を追加（必要な箇所） | 5-1 | 同上 |

### Phase 6: 動作確認

| # | タスク | 依存 | 完了基準 |
|---|---|---|---|
| 6-1 | テスト用レビュー報告書を 1 本作成（フロントマター付き、評価マーク含む 3〜5 件の finding） | 5-1 | 手動で目視可能なサンプル Markdown |
| 6-2 | 「レビュー報告書をインポートして」と発話して `review:import-report` スキルが起動 → 取り込み完了 → `bun run review-db.ts list findings --report-id <id>` で確認 | 4-1, 4-2, 6-1 | spec.md § 9.1 の標準ルートが通る |
| 6-3 | 同じ報告書ファイルの評価を 1 件書き換えて再インポート → 同 report-id で UPSERT、findings が再構築され、変更が反映される | 6-2 | spec.md § 4.5 の冪等性が機能する |
| 6-4 | `bun run review-db.ts export --format json --output ./tmp/review.json` → 出力を `jq` でパースできることを確認 | 6-2 | `jq '.[0].verdict'` 等で値が取れる |

## タスク外（明示的に対象外）

- AI による自動評価（spec.md § 8.2 のスコープ外宣言の通り）
- `relocate` サブコマンド（spec.md § 11 将来検討）
- 重複 finding 検出、knowledge-distiller 接続、reporter マスタテーブル、UI ビューワー（spec.md § 11）
- `reviewer-for-*` サブエージェント側の変更（spec.md § 8.4 注記の通り）

## 実装の流れの推奨

1. Phase 0 → 1 → 2 を順に。CLI が単体で動く状態を作る。
2. Phase 3 でサブエージェント、Phase 4 でスキルを作って結合。
3. Phase 5 はテンプレート修正のみなので、Phase 0〜4 と並行作業可能。
4. Phase 6 で end-to-end を確認。

各フェーズ完了後にコミットを切ること（Conventional Commits）。
