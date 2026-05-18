---
name: bump-plugin-version
description: このリポジトリのプラグインの `plugin.json` のバージョンを変更内容から自動判定して上げ、テンプレート固定のコミットメッセージでコミットする。`-y` で確認スキップ。「バージョンを上げる」「version bump」「プラグインをバンプ」などの依頼時に使用する。
argument-hint: [-y]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git add:*), Bash(git commit -m:*), Bash(git push:*), Read, Edit, AskUserQuestion
---

# bump-plugin-version

このリポジトリ (`mgzl-claude-code-plugin`) 専用のスキル。
`origin/main..HEAD` の差分を分析し、変更があったプラグインの `plugin.json` の `version` を上げ、テンプレートに沿ったコミットメッセージでコミットし、最後に `git push` でリモートに反映する。

各プラグインに対し「現在のバージョン」「新バージョン」「変更概要」「生成されるコミットメッセージ」をユーザーに提示し、`AskUserQuestion` で確認を取ってから実行する。`-y` 指定時は確認をスキップして自動実行する。push はコミットが1件以上作成された場合に自動で行う。

## コンテキスト

- 引数: `$ARGUMENTS`
- ワーキングツリーの状態: !`git status --porcelain`
- origin/main からの差分ファイル一覧: !`git diff --name-only origin/main..HEAD`
- origin/main からのコミット一覧: !`git log origin/main..HEAD --oneline`

## ワークフロー

### Step 1: 引数の解析

`$ARGUMENTS` をスペース区切りでトークン化し、以下を判定する:

- `-y`: 確認スキップフラグ（位置不問・任意）
- それ以外のトークンは無視する（今後の拡張用）

### Step 2: 事前チェック

順次実施し、いずれかが失敗したら理由を明示して終了する。

1. **ワーキングツリーがクリーンか**
   - `git status --porcelain` の出力が空であることを確認
   - 空でなければ「ワーキングツリーに未コミットの変更があります。コミットまたはスタッシュしてから再実行してください。」と表示して終了
2. **origin/main..HEAD に差分があるか**
   - `git diff --name-only origin/main..HEAD` の出力が空でないことを確認
   - 空であれば「origin/main からの差分がありません。バンプ対象がありません。」と表示して終了

### Step 3: プラグインごとの変更を集計

1. **プラグインディレクトリの検出**
   - リポジトリ直下の各サブディレクトリのうち、`<dir>/.claude-plugin/plugin.json` が存在するものをプラグインとして扱う
   - リポジトリルートの `.claude-plugin/marketplace.json` はマーケットプレイス定義なので除外する
   - 各プラグインから `name`（plugin.json の `name` フィールド）と `version` を `Read` で取得する
   - 表示・コミットメッセージで使う「プラグイン名」は**ディレクトリ名**を採用する（既存履歴の慣習に従う）

2. **プラグインごとの変更ファイルを分類**
   - Step 2 で取得した差分ファイル一覧を、各プラグインのディレクトリ配下に振り分ける
   - どのプラグインにも属さないファイル（ルート直下の `CLAUDE.md`、`.claude-plugin/`、`.claude/` 配下など）は「対象外」として除外する

3. **既にバンプ済みかチェック**
   - 各プラグインについて、`git diff origin/main..HEAD -- <plugin-dir>/.claude-plugin/plugin.json` を確認する
   - 差分内に `"version"` の変更が含まれている場合は「既に v<X> から v<Y> にバンプ済み」として対象外にする
   - その旨を結果報告で示す

4. **対象プラグインが0件なら終了**
   - バンプ候補が無ければ「バンプ対象のプラグインがありません（既にバンプ済み、または対象外の変更のみ）。」と表示して終了

### Step 4: バージョン判定

対象プラグインごとに以下を実施する:

1. `git log origin/main..HEAD --oneline -- <plugin-dir>` でそのプラグインに関連するコミット一覧を取得する
2. 関連コミットのメッセージから自動判定する（後述「バージョン判定ルール」を参照）
3. 現在の `version` を semver として `MAJOR.MINOR.PATCH` に分解し、判定結果に応じて新バージョンを計算する

### Step 5: コミットメッセージの組み立て

対象プラグインごとに以下を実施する:

1. **変更概要の生成**
   - 関連コミットを分析し、変更の主題を1〜2フレーズで要約する
   - スキル名・関数名・ファイル名などはバッククォートで囲う（コマンド置換と認識されないようエスケープする）
   - 既存履歴の表現を参考に「〜の追加」「〜の修正」「〜の改善」「〜を削除」などで端的に表現する

2. **テンプレートに沿ってコミットメッセージを構築**
   - 形式: `<type>: <subject> し <plugin-dir-name> を v<new-version> にバンプ`
   - `<type>` は関連コミットの最も主要なタイプ（feat / fix / refactor / chore など、後述ルール参照）
   - 変更内容が単なるバンプのみ・あるいは複数の軽微な変更の集合の場合は `chore:` を採用する

### Step 6: 確認

`-y` フラグが**含まれていない**場合のみ実施する。`-y` が含まれている場合はスキップして Step 7 へ進む。

対象プラグインごとに以下を実施する:

1. 以下の形式で情報を表示する:

```
プラグイン: <plugin-dir-name>
現在のバージョン: v<current>
新しいバージョン: v<new>（<patch|minor|major> バンプ）

変更の概要:
- <commit1 のサマリ>
- <commit2 のサマリ>
...

生成するコミットメッセージ:
<type>: <subject> し <plugin> を v<new> にバンプ
```

2. `AskUserQuestion` で確認を行う:
   - `question`: `<plugin-dir-name> を v<new> にバンプしますか？`
   - `header`: `バージョン更新`
   - `multiSelect`: `false`
   - `options`（**順序固定・変更厳禁**）:
     1. `label: バージョンを上げる` / `description: plugin.json を更新してコミットする`
     2. `label: 中止する` / `description: このプラグインのバンプを中止する`

3. 「中止する」が選択されたプラグインはスキップして次のプラグインへ進む

複数プラグインを同時に確認する場合は、`AskUserQuestion` の `questions` 配列にプラグインごとの質問を最大4件まで並べてもよい（5件以上ある場合は2回に分けて実施する）。

### Step 7: バージョン更新とコミット

承認された（または `-y` 指定の）プラグインごとに以下を実施する:

1. `Edit` で `<plugin-dir>/.claude-plugin/plugin.json` の `version` フィールドを新バージョンに更新する
2. `git add <plugin-dir>/.claude-plugin/plugin.json` でステージする
3. `git commit -m "<message>"` でコミットする
   - コミットコマンドは必ず `git commit -m "メッセージ"` のシンプルな形式で実行する
   - HEREDOC（`cat <<'EOF'`）や `$()` コマンド置換は使用しない（`allowed-tools` のパターンマッチに合致させるため）

複数プラグインがある場合は**プラグインごとに個別のコミット**を作成する（1コミットにまとめない）。

### Step 8: push

Step 7 で 1件以上のコミットが作成された場合のみ実施する（コミットが0件なら省略）。

1. `git push` を実行してリモートに反映する
2. push 失敗時はエラー出力を表示し、ユーザーに手動対応を促す（自動 retry や force push は行わない）

### Step 9: 結果報告

以下の形式で結果を報告する:

```
✅ バージョン更新完了
- <plugin1>: v<old1> → v<new1>
- <plugin2>: v<old2> → v<new2>

push: 成功（または 失敗・スキップ）

スキップ:
- <plugin3>: ユーザーが中止
- <plugin4>: 既に v<X> から v<Y> にバンプ済み
- <plugin5>: 変更なし
```

該当しない区分（スキップが無い等）は省略する。

## バージョン判定ルール

関連コミットのメッセージから以下の優先順位で判定する:

| 条件 | バンプ種別 |
|------|-----------|
| `<type>!:` 形式、または本文に `BREAKING CHANGE:` を含むコミットが存在する | major |
| `feat:` で始まるコミットが存在する | minor |
| 上記以外（`fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `perf:`, `style:`, `build:`, `ci:` など）のみ | patch |

複数のコミットがある場合は、**最も大きいバンプ種別を採用する**。

## コミットメッセージのテンプレート

形式: `<type>: <subject> し <plugin-dir-name> を v<new-version> にバンプ`

### `<type>` の選び方

関連コミットの主要なタイプを採用する。複数のタイプが混在する場合の優先順位は以下:

1. 関連コミットに `feat:` が含まれていれば `feat:`
2. それ以外で `fix:` が含まれていれば `fix:`
3. それ以外で `refactor:` が含まれていれば `refactor:`
4. それ以外は `chore:`

### `<subject>` の生成

- 関連コミットの最も重要な変更点を1〜2フレーズで要約する
- 複数のスキル/機能が追加された場合は「`A` と `B` の追加」のように列挙する（3件以上は「`A` などの追加」と省略してもよい）
- 変更が単一のバンプメンテのみであれば「変更を反映」のように汎用表現にしてもよい

### 例（既存履歴より）

```
chore: `merge-branch` と `organize-memory` の追加を反映し common を v1.0.30 にバンプ
feat: `debug-plugin-paths` に CLAUDE_PROJECT_DIR の表示を追加し common を v1.0.29 にバンプ
chore: cbo から Serena MCP の参照を全て削除し v1.0.29 にバンプ
chore: `codex-review` スキルを削除し common を v1.0.28 にバンプ
```

## 重要な制約

- **plugin.json 以外のファイルは編集しない**: バンプ作業で触るのは各プラグインの `plugin.json` の `version` フィールドのみ
- **プラグインごとに個別コミット**: 複数プラグインの変更を1コミットにまとめない（既存履歴の慣習）
- **バージョン番号は plugin.json の現在値が基準**: git 履歴上の最新タグではなく、実ファイルの値から +1 する
- **既にバンプ済みのプラグインは対象外**: `origin/main..HEAD` の差分に `plugin.json` の version 変更が含まれていれば二重バンプしない
- **承認なきコミットは禁止**: `-y` 指定時のみ自動承認。それ以外は `AskUserQuestion` で明示承認を得る
- **コミットコマンドの形式**: `git commit -m "メッセージ"` のシンプル形式のみ使用する（HEREDOC・コマンド置換は禁止）
