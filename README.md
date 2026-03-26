# mgzl-claude-code-plugin

個人用 Claude Code プラグイン。Skills・Agents・Commands を一元管理する。

## インストール

### 1. マーケットプレイスを登録

`~/.claude/settings.json` の `extraKnownMarketplaces` にこのリポジトリを追加する：

```json
{
  "extraKnownMarketplaces": {
    "mgzl-marketplace": {
      "source": {
        "source": "github",
        "repo": "<owner>/mgzl-claude-code-plugin"
      }
    }
  }
}
```

### 2. プラグインをインストール

```bash
/install mgzl@mgzl-marketplace
/install cbo@mgzl-marketplace
```

## プラグイン

| 名前 | 説明 |
|------|------|
| **mgzl** (`common/`) | 汎用ツール。Git コミット自動化、Web 検索など |
| **cbo** (`cbo/`) | 開発ワークフロー支援。コードレビュー、PR 管理など |
