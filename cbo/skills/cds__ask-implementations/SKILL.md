---
name: cds:ask-implementations
description: 引数で渡した内容について、デザインシステムリポジトリ（環境変数 CDS_REPO_PATH で指定）の実装をclaude CLIで調査する。「CDSの実装を調べて」「デザインシステムで〇〇はどう実装されている？」「CDSのコンポーネントを調べて」などの要求時に使用。※事前に環境変数 CDS_REPO_PATH の設定が必要。
argument-hint: [調査内容]
allowed-tools: Bash
model: sonnet
---

# cds:ask

デザインシステムリポジトリの実装を `claude` CLI の非対話モードで調査するスキル。

## 前提条件

- 環境変数 `CDS_REPO_PATH` にデザインシステムリポジトリのパスを設定すること

## コンテキスト

- 調査内容: $ARGUMENTS

## ワークフロー

### Step 1: 引数の確認

`$ARGUMENTS` が未指定または空の場合、ユーザーに調査内容を指定するよう伝えて終了する。

### Step 2: claude CLI で調査を実行

以下のコマンドを Bash ツールで実行する。タイムアウトは10分（600000ms）に設定する。

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/ask-cds.ts" "$ARGUMENTS"
```
### Step 3: 結果の報告

`claude` CLI の出力結果をそのままユーザーに報告する。

## 使用例

### 例1: コンポーネントの実装調査

```
ユーザー: /cds__ask-implementations Button コンポーネントの実装を調べて
```

### 例2: デザイントークンの調査

```
ユーザー: /cds__ask-implementations テーマのカラートークンはどのように定義されている？
```

### 例3: コンポーネントの処理フロー調査

```
ユーザー: /cds__ask-implementations DatePicker コンポーネントのバリデーション処理を教えて
```

## 注意事項

- デザインシステムリポジトリは読み込み専用で調査する（編集は行わない）
- 調査には時間がかかる場合がある（最大10分）
