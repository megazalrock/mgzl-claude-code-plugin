# mgzl-claude-code-plugin

個人用 Claude Code プラグインパッケージ。Skills・Agents・Commands・Hooks を管理するリポジトリ。

## プロジェクト概要

- **目的**: 自作の Claude Code 拡張を一元管理し、`~/.claude` への導入を簡単にする
- **公開予定**: なし（個人利用のみ）
- **ランタイム**: スクリプトは `bun` で実行

## ディレクトリ構成

```
skills/           # SKILL.md を含むスキルディレクトリ
agents/           # エージェント定義 (.md)
commands/         # スラッシュコマンド定義 (.md)
scripts/          # セットアップ・管理用スクリプト (TypeScript)
```

## 開発ルール

### スキル作成
- `skills/<skill-name>/SKILL.md` にフロントマター (`name`, `description`, `allowed_tools`) を必ず記載
- SKILL.md は 500 行以内を目標とする
- 補足情報は `references/` サブディレクトリに分離
- スクリプトが必要な場合は `scripts/` サブディレクトリに TypeScript で作成し `bun` で実行
- description にはトリガーとなるキーワードを含める

### エージェント作成
- `agents/<agent-name>.md` にフロントマター (`name`, `description`, `model`, `tools`) を記載
- 使用するスキルがある場合は `skills` フロントマターで指定

### コマンド作成
- `commands/<command-name>.md` または `commands/<namespace>/<command-name>.md`
- ネストは 1 階層まで（`/namespace:command` 形式になる）

### 共通
- コミットは Conventional Commits 形式 (`feat:`, `fix:`, `refactor:`, `chore:`)
- スクリプトは TypeScript + bun。シェルスクリプトは既存のもの以外新規作成しない
- `~/.claude` への反映は `bun run scripts/install.ts` で行う

## インストールスクリプト

`scripts/install.ts` は以下を行う：
1. `skills/`, `agents/`, `commands/` 内の各エントリを走査
2. `~/.claude` 配下の対応ディレクトリにシンボリックリンクを作成
3. 既存ファイルがある場合はバックアップ (`~/.claude/backups/`) してから置き換え

## テスト

スキルのテストは `skill-creator` プラグインの eval 機能を利用する。
