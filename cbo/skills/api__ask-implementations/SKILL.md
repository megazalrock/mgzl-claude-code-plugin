---
name: api:ask-implementations
description: 引数で渡した内容について、APIリポジトリ（環境変数 API_REPO_PATH で指定）の実装をclaude CLIで調査する。出力される session_id を使って、前回の文脈を引き継いだ追加質問もできる。「APIの実装を調べて」「APIで〇〇はどう実装されている？」などの要求時に使用。※事前に環境変数 API_REPO_PATH の設定が必要。
argument-hint: [調査内容]
allowed-tools: Bash
model: sonnet
---

# api:ask

APIリポジトリの実装を `claude` CLI の非対話モードで調査するスキル。
session_id を指定して再開することで、同じ文脈のまま追加質問を重ねられる。

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
bun run "${CLAUDE_SKILL_DIR}/scripts/ask-api.ts" "$ARGUMENTS"
```

出力は回答本文の後に、最終行として `session_id=<id>` が続く。

### Step 3: 結果の報告

回答本文をそのまま報告し、あわせて最終行の `session_id=<id>` も必ず報告に含める。
呼び出し元がサブエージェントの場合も、session_id が無いと追加質問ができなくなるため省略しない。

コマンドが失敗した場合は stderr のエラー内容を報告する。失敗時でも `session_id=<id>` が出力されていれば（最大ターン数到達など）、その session_id で Step 4 の追加質問として続きを依頼できる。

### Step 4: 追加質問（必要な場合のみ）

同じ話題についてさらに詳しく知りたい場合は、直近に出力された session_id を指定して追加質問する。タイムアウトは同じく10分（600000ms）に設定する。

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/ask-api.ts" --resume <session_id> "<追加質問>"
```

- `--resume` を付けない呼び出しは毎回新しいセッションになり、前の質問や回答を覚えていない。前回の回答を前提にした質問（「さっきのメソッドの呼び出し元」を尋ねるなど）は必ず `--resume` を付ける
- session_id は常に「直近の実行で出力されたもの」を使う
- 結果の報告は Step 3 と同様に、回答本文と session_id の両方を含める
- 話題が変わる場合は `--resume` を付けずに新しいセッションで質問する

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

### 例4: 前回の調査への追加質問

```
ユーザー: さっきの原価計算で、端数処理はどこでやっている？
→ 直近の session_id を指定して --resume で追加質問する
```

## 注意事項

- APIリポジトリは読み込み専用で調査する（編集は行わない）
- 調査には最大10分かかる場合もある
