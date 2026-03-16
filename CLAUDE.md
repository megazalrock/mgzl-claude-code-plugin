# mgzl-claude-code-plugin

個人用 Claude Code プラグイン。Skills・Agents・Commands を管理する。

## プロジェクト概要

- **目的**: 自作の Claude Code 拡張を一元管理し、プラグインとして導入できるようにする
- **公開予定**: なし（個人利用のみ）
- **プラグイン形式**: [Claude Code Plugin 標準構造](https://code.claude.com/docs/en/plugins) に準拠

## ディレクトリ構成

```
.claude-plugin/                    # marketplace.json（マーケットプレイス定義）
mgzl-claude-code-plugin/           # プラグイン本体
  .claude-plugin/                  # plugin.json（プラグインメタデータ）
  skills/                          # SKILL.md を含むスキルディレクトリ
  agents/                          # エージェント定義 (.md)
  commands/                        # スラッシュコマンド定義 (.md)
```

## 開発ルール

### スキル作成
- `mgzl-claude-code-plugin/skills/<skill-name>/SKILL.md` にフロントマター (`name`, `description`) を必ず記載
- SKILL.md は 500 行以内を目標とする
- 補足情報は `references/` サブディレクトリに分離
- スクリプトが必要な場合は `scripts/` サブディレクトリに TypeScript で作成し `bun` で実行
- `description` にはトリガーとなるフレーズ・キーワードを具体的に含める

### エージェント作成
- `mgzl-claude-code-plugin/agents/<agent-name>.md` にフロントマター (`name`, `description`, `model`, `tools`) を記載
- 使用するスキルがある場合は `skills` フロントマターで指定

### コマンド作成
- `mgzl-claude-code-plugin/commands/<command-name>.md` にフロントマター (`description`) を記載
- ネストは 1 階層まで（`commands/<namespace>/<command-name>.md` → `/namespace:command`）
- コマンド本文は Claude への指示として記述する（ユーザー向けメッセージではない）

### 共通
- コミットは Conventional Commits 形式 (`feat:`, `fix:`, `refactor:`, `chore:`)
- スクリプトは TypeScript + bun。シェルスクリプトは既存のもの以外新規作成しない

## マーケットプレイス構造

- `.claude-plugin/marketplace.json` — リポジトリ全体のマーケットプレイス定義。プラグイン一覧を持つ
- `mgzl-claude-code-plugin/.claude-plugin/plugin.json` — 個別プラグインのメタデータ
- スキル/エージェント/コマンドの追加・削除時に `marketplace.json` の編集は不要
- 新しいプラグインを追加する場合のみ `marketplace.json` の `plugins` 配列に追記する

## フロントマター必須フィールド

| 種別 | 必須 | 任意 |
|------|------|------|
| Skill | `name`, `description` | `argument-hint`, `allowed-tools`, `model`, `context`, `disable-model-invocation`, `version` |
| Agent | `name`, `description`, `model`, `tools` | `skills` |
| Command | `description` | `argument-hint`, `allowed-tools`, `model` |
