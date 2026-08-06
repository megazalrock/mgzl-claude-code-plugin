# cbo プラグイン

開発ワークフロー支援プラグイン。コードレビュー、実装計画、Playwright 自動化、PR 管理などの機能を提供する。

## 環境変数の設定

プロジェクトの `.claude/settings.local.json` に以下の `env` ブロックを追加する。

### 必須

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `MGZL_DIR` | 実装計画書・レビュー結果・手順書などの保存先ベースディレクトリ | `.mgzl` |

```json
{
  "env": {
    "MGZL_DIR": ".mgzl"
  }
}
```

`MGZL_DIR` 配下に以下のディレクトリが自動的に使用される:

```
$MGZL_DIR/
├── implementations/          # 実装計画書
├── knowledge/                # 教訓ファイル
│   ├── implementation-plan-lessons.md  # 実装計画書作成の教訓（impl:create）
│   └── implementation-lessons.md       # コード実装の教訓（review:diff/file・impl:execute）
├── reviews/                  # レビュー結果（正本 JSON・reviewview / difit セッション sidecar・旧 md 報告書）
├── playwright_procedures/    # Playwright 手順書
└── tmp/                      # 一時ファイル・スクリーンショット
```

### 任意（使用するスキルに応じて設定）

| 変数名 | 使用スキル | 説明 | 例 |
|--------|-----------|------|-----|
| `APP_HOST` | `playwright:runner` | Playwright 操作時のベース URL | `localhost:3000` |
| `API_REPO_PATH` | `api:ask-implementations` | API リポジトリの絶対パス | `/path/to/api-repo` |
| `CDS_REPO_PATH` | `cds:ask-implementations` | デザインシステムリポジトリの絶対パス | `/path/to/craftbank-design-system` |

```json
{
  "env": {
    "MGZL_DIR": ".mgzl",
    "APP_HOST": "localhost:3000",
    "API_REPO_PATH": "/path/to/api-repo",
    "CDS_REPO_PATH": "/path/to/craftbank-design-system"
  }
}
```

## パーミッションの設定

スキル・エージェント内のコマンド置換（`!`echo $MGZL_DIR``）を実行するため、以下のパーミッションを `.claude/settings.local.json` に追加する。

```json
{
  "permissions": {
    "allow": [
      "Bash(echo $MGZL_DIR)",
      "Bash(echo $APP_HOST)"
    ]
  }
}
```

## reviewview（レビュー UI）の設定

`review:diff` は、AI の指摘を人間にトリアージさせるために reviewview の MCP サーバーを使う。`review:fix` は reviewview から判定を取り込み、修正結果を `report_fix` で報告する。`review:open` のみ引き続き difit（diff ビューア）を使う。

サーバー定義は `cbo/.mcp.json` の `reviewview` エントリにあるが、`args` は**ローカルにビルドした reviewview の絶対パス**を指しているため、環境に合わせて書き換える。`packages/server/dist/main.js` がビルド済みである必要がある。

レビューの状態（指摘・判定・差分スナップショット）は**レビュー対象リポジトリ**の `.reviewview/state.db` に保存される。指摘本文とファイル全文が含まれるため、対象リポジトリの `.gitignore` に `.reviewview/` を追加すること。

MCP サーバーが接続されていない場合、`review:diff` は**レビューを開始せずに冒頭で停止**する（レビューだけ実行して報告書を残すフォールバックはしない）。`review:fix` は reviewview の sidecar がある報告書を扱うときのみ同様に停止する。
