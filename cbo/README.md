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
├── reviews/                  # レビュー結果
├── playwright_procedures/    # Playwright 手順書
└── tmp/                      # 一時ファイル・スクリーンショット
```

### 任意（使用するスキルに応じて設定）

| 変数名 | 使用スキル | 説明 | 例 |
|--------|-----------|------|-----|
| `APP_HOST` | `playwright:runner` | Playwright 操作時のベース URL | `localhost:3000` |
| `API_REPO_PATH` | `api:ask-implementations` | API リポジトリの絶対パス | `/path/to/api-repo` |
| `CDS_REPO_PATH` | `cds:ask-implementations` | デザインシステムリポジトリの絶対パス | `/path/to/craftbank-design-system` |
| `OPENAPI_FILE` | `api:extract-open-api` | OpenAPI 定義ファイルの絶対パス | `/path/to/openapi.json` |

```json
{
  "env": {
    "MGZL_DIR": ".mgzl",
    "APP_HOST": "localhost:3000",
    "API_REPO_PATH": "/path/to/api-repo",
    "CDS_REPO_PATH": "/path/to/craftbank-design-system",
    "OPENAPI_FILE": "/path/to/openapi.json"
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
