# mgzl-claude-code-plugin

個人用の Claude Code プラグインパッケージ。
自作の Skills・Agents・Commands・Hooks を一元管理し、`~/.claude` への導入を容易にする。

## 構成

```
.
├── skills/                  # Claude Code スキル
│   ├── commiting-to-git/    # Git コミット自動化
│   ├── refactoring-skill/   # スキルのリファクタリング支援
│   └── web-search-with-codex/ # OpenAI Codex による Web 検索
├── agents/                  # Claude Code エージェント
│   └── web-research-collector.md  # Web 調査・情報収集
├── commands/                # Claude Code コマンド（スラッシュコマンド）
│   └── load-ai-instructions.md
└── scripts/                 # セットアップ・管理用スクリプト
    └── install.ts           # ~/.claude へのシンボリックリンク設置
```

## セットアップ

```bash
bun run scripts/install.ts
```

`~/.claude` 配下の対応ディレクトリにシンボリックリンクを作成する。
既存ファイルがある場合はバックアップを取った上で置き換える。

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

1. `skills/<skill-name>/` ディレクトリを作成
2. `skills/<skill-name>/SKILL.md` を作成（フロントマター必須）
3. 必要に応じて `scripts/` や `references/` サブディレクトリを追加
4. `bun run scripts/install.ts` を実行してリンクを更新

### SKILL.md テンプレート

```markdown
---
name: skill-name
description: スキルの説明（トリガーワード含む）
allowed_tools:
  - Bash(git status)
  - Read
  - Edit
---

# スキル名

## ワークフロー

1. ステップ1
2. ステップ2
3. ステップ3
```

## 新しいエージェントの追加方法

1. `agents/<agent-name>.md` を作成（フロントマター必須）
2. `bun run scripts/install.ts` を実行してリンクを更新

### Agent テンプレート

```markdown
---
name: agent-name
description: エージェントの説明
model: sonnet
tools:
  - Read
  - WebSearch
---

# 指示内容
```

## 依存関係

- [bun](https://bun.sh/) - スクリプト実行
- [OpenAI Codex CLI](https://github.com/openai/codex) - `web-search-with-codex` スキルで使用（任意）
