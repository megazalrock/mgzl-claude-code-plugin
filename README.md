# mgzl-claude-code-plugin

個人用の Claude Code プラグイン。
自作の Skills・Agents・Commands を一元管理する。

## 構成

```
.
├── .claude-plugin/
│   └── plugin.json              # プラグインメタデータ（必須）
├── skills/                      # スキル定義
│   ├── commiting-to-git/
│   │   └── SKILL.md
│   ├── refactoring-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   │       └── skill-authoring-best-practices.md
│   └── web-search-with-codex/
│       ├── SKILL.md
│       └── scripts/
│           └── codex_search.sh
├── agents/                      # エージェント定義
│   └── web-research-collector.md
├── commands/                    # スラッシュコマンド定義
│   └── load-ai-instructions.md
└── README.md
```

## インストール

```bash
/plugin install mgzl-claude-code-plugin
```

または、ローカルパスを指定してインストール：

```bash
/plugin install /path/to/mgzl-claude-code-plugin
```

## スキル一覧

| スキル名 | 説明 | トリガー例 |
|---|---|---|
| `commiting-to-git` | 差分分析 → コミットメッセージ生成 → コミット | `コミットして`、`git commit` |
| `refactoring-skill` | SKILL.md のベストプラクティス分析・改善 | スキルのリファクタリング依頼 |
| `web-search-with-codex` | Codex CLI を使った Web 検索 | Web 検索クエリ |

## エージェント一覧

| エージェント名 | 説明 |
|---|---|
| `web-research-collector` | Web 検索で情報を収集し日本語レポートを生成 |

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `/load-ai-instructions` | `ai_instructions.md` を読み込む |

## 新しいスキルの追加方法

1. `skills/<skill-name>/SKILL.md` を作成（フロントマター必須）
2. 必要に応じて `references/` や `scripts/` サブディレクトリを追加

```yaml
---
name: skill-name
description: >
  トリガー条件を記載。"具体的なフレーズ" や "キーワード" を含める。
version: 1.0.0
---
```

## 新しいエージェントの追加方法

`agents/<agent-name>.md` を作成（フロントマター必須）。

```yaml
---
name: agent-name
description: エージェントの説明
model: sonnet
tools:
  - Read
  - WebSearch
---
```

## 依存関係

- [OpenAI Codex CLI](https://github.com/openai/codex) - `web-search-with-codex` スキルで使用（任意）

## 参考

- [Claude Code Plugins 公式ドキュメント](https://code.claude.com/docs/en/plugins)
- [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) - 公式プラグインリポジトリ
