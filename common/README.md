# common プラグイン

汎用的なエージェント・スキル・コマンドを格納するプラグイン。

## エージェント別の推奨権限設定

各エージェントをスムーズに実行するために、プロジェクトの `.claude/settings.local.json` に以下の権限を追加する。

### skill-reference-collector

外部GitHubリポジトリからスキル/エージェントの実装パターンを収集するエージェント。
`$TMPDIR` にリポジトリを一時クローンする。

```json
{
  "permissions": {
    "allow": [
      "Bash(git clone --depth 1 https://github.com/affaan-m/everything-claude-code.git:*)",
      "Read($TMPDIR**)",
      "Glob($TMPDIR**)",
      "Grep($TMPDIR**)"
    ]
  },
  "sandbox": {
    "permissions": {
      "network": {
        "allow": ["github.com"]
      }
    }
  }
}
```

### mutation-tester / mutation-testing

ミューテーションテストを worktree 隔離環境で実行するエージェント＋スキル。
worktree 内でファイル編集を行うため、以下の権限設定が必要。

`.claude/settings.local.json` 以下の設定を追加
```json
{
  "permissions": {
    "allow": ["Edit(/.claude/worktrees/**)"]
  },
  "sandbox": {
    "filesystem": {
      "allowWrite": ["./.claude/worktrees/"]
    }
  }
}
```

