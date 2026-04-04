# mgzl-claude-code-plugin

個人用 Claude Code プラグイン。Skills・Agents・Commands を管理する。

## プロジェクト概要

- **目的**: 自作の Claude Code 拡張を一元管理し、プラグインとして導入できるようにする
- **公開予定**: なし（個人利用のみ）
- **プラグイン形式**: [Claude Code Plugin 標準構造](https://code.claude.com/docs/en/plugins) に準拠

## ディレクトリ構成

```
.claude-plugin/                    # marketplace.json（マーケットプレイス定義）
common/                            # "mgzl" プラグイン（汎用ツール）
cbo/                               # "cbo" プラグイン（開発ワークフロー支援）
```

## 開発コマンド

```bash
bun install          # 依存関係のインストール
```

## 開発ルール

### スキル作成
- `<plugin>/skills/<skill-name>/SKILL.md` にフロントマター (`name`, `description`) を必ず記載
- SKILL.md は 500 行以内を目標とする
- 補足情報は `references/` サブディレクトリに分離
- スクリプトが必要な場合は `scripts/` サブディレクトリに TypeScript で作成し `bun` で実行
- スクリプトへのパス参照は `${CLAUDE_SKILL_DIR}/scripts/<script>` を使用する
- `description` は説明文を先に書き、末尾に「」付きでトリガーフレーズを3〜5個配置する（例: `...「コミットして」「commit」などの依頼時に使用する。`）

### SKILL.md で使える文字列置換変数
- `${CLAUDE_SKILL_DIR}` — SKILL.md が置かれたディレクトリ。スクリプト・ファイル参照用
- `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` — スキル呼び出し時の引数
- `${CLAUDE_SESSION_ID}` — セッションID
- `${CLAUDE_PLUGIN_ROOT}` — プラグインのインストールルート（hook・MCP設定向け）
- `${CLAUDE_PLUGIN_DATA}` — 永続データディレクトリ（キャッシュ・依存関係保存用）

### エージェント作成
- `<plugin>/agents/<agent-name>.md` にフロントマター (`name`, `description`, `model`, `tools`) を記載
- 使用するスキルがある場合は `skills` フロントマターで指定

### 共通
- コミットは Conventional Commits 形式 (`feat:`, `fix:`, `refactor:`, `chore:`)
- スクリプトは TypeScript + bun。シェルスクリプトは既存のもの以外新規作成しない

## マーケットプレイス構造

- `.claude-plugin/marketplace.json` — リポジトリ全体のマーケットプレイス定義。プラグイン一覧を持つ
- `common/.claude-plugin/plugin.json` — mgzl プラグインのメタデータ
- `cbo/.claude-plugin/plugin.json` — cbo プラグインのメタデータ
- スキル/エージェント/コマンドの追加・削除時に `marketplace.json` の編集は不要
- 新しいプラグインを追加する場合のみ `marketplace.json` の `plugins` 配列に追記する
- プラグインのバージョンは各プラグインの `plugin.json` の `version` フィールドで管理する

## フロントマター必須/任意フィールド

| 種別 | 必須 | 任意 |
|------|------|------|
| Skill | `name`, `description` | `argument-hint`, `allowed-tools`, `model`, `context`, `disable-model-invocation`, `version` |
| Agent | `name`, `description`, `model`, `tools` | `skills` |
