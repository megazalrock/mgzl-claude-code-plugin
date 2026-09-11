# cbo プラグイン

開発ワークフロー支援プラグイン。コードレビュー、実装計画、PR 管理などの機能を提供する。

## 環境変数の設定

プロジェクトの `.claude/settings.local.json` に以下の `env` ブロックを追加する。

### 必須

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `MGZL_DIR` | 実装計画書・レビュー結果などの保存先ベースディレクトリ | `.mgzl` |

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
├── reviews/                  # レビュー結果（md 報告書）
└── tmp/                      # 一時ファイル・スクリーンショット
```

### 任意（使用するスキルに応じて設定）

| 変数名 | 使用スキル | 説明 | 例 |
|--------|-----------|------|-----|
| `API_REPO_PATH` | `api:ask-implementations` | API リポジトリの絶対パス | `/path/to/api-repo` |
| `CDS_REPO_PATH` | `cds:ask-implementations` | デザインシステムリポジトリの絶対パス | `/path/to/craftbank-design-system` |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `impl:execute` | Agent Teams（チーム実行）を有効化する。難易度: 高の並列ステップをチームメイトへ委譲するチーム実行フローで必要 | `1` |

```json
{
  "env": {
    "MGZL_DIR": ".mgzl",
    "API_REPO_PATH": "/path/to/api-repo",
    "CDS_REPO_PATH": "/path/to/craftbank-design-system",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` は Claude Code 組み込みの環境変数で、既定では無効。未設定の場合 `impl:execute` のチーム実行フローは通常の並列実行へ縮退する（チームメイトが起動しないため、完了後の shutdown 送信も空振りする）。チーム実行を使うなら設定する。ユーザー全体で有効にする場合は `~/.claude/settings.json` の `env` に置いてもよい。

## パーミッションの設定

スキル・エージェント内のコマンド置換（`!`echo $MGZL_DIR``）を実行するため、以下のパーミッションを `.claude/settings.local.json` に追加する。

```json
{
  "permissions": {
    "allow": [
      "Bash(echo $MGZL_DIR)"
    ]
  }
}
```
