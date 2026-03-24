---
name: api:ask-implementations
description: 引数で渡した内容について、APIリポジトリ（環境変数 API_REPO_PATH で指定）の実装をclaude CLIで調査する。「APIの実装を調べて」「APIで〇〇はどう実装されている？」などの要求時に使用。※事前に環境変数 API_REPO_PATH の設定が必要。
argument-hint: [調査内容]
allowed-tools: Bash
model: sonnet
---

# api:ask

APIリポジトリの実装を `claude` CLI の非対話モードで調査するスキル。

## 前提条件

- 環境変数 `API_REPO_PATH` にAPIリポジトリのパスを設定すること

## コンテキスト

- 調査内容: $ARGUMENTS

## ワークフロー

### Step 1: 引数の確認

`$ARGUMENTS` が未指定または空の場合、ユーザーに調査内容を指定するよう伝えて終了する。

### Step 2: claude CLI で調査を実行

以下のコマンドを Bash ツールで実行する。タイムアウトは10分（600000ms）に設定する。

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/ask-api.ts" "$ARGUMENTS"
```
### Step 3: 結果の報告

`claude` CLI の出力結果をそのままユーザーに報告する。

## 使用例

### 例1: 特定APIの実装調査

```
ユーザー: /ask__api スケジュール作成APIの実装を調べて
```

### 例2: ドメインロジックの調査

```
ユーザー: /ask__api 案件の原価計算はどのように実装されている？
```

### 例3: エンドポイントの調査

```
ユーザー: /ask__api /api/schedule/monthly エンドポイントの処理フローを教えて
```

## 注意事項

- APIリポジトリは読み込み専用で調査する（編集は行わない）
- 調査には時間がかかる場合がある（最大10分）
- Serena MCP のツールが利用可能な環境で実行する必要がある
