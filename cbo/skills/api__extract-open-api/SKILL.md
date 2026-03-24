---
name: api:extract-open-api
description: 外部リポジトリのOpenAPIファイルからスケジュール関連APIのエンドポイント情報を抽出し、仕様を提供する。「スケジュールAPIの仕様を確認して」「APIのエンドポイントを調べて」「スケジュールAPIのスキーマを見せて」などの要求時、またスケジュール機能の新規実装、API連携の調査、実装計画作成時のAPI仕様確認が必要な場合に使用される。※事前に環境変数 OPENAPI_FILE にOpenAPIファイルのパスを設定する必要がある。
model: sonnet
---

# スケジュールAPI仕様抽出

## 前提条件

- 環境変数 `OPENAPI_FILE` にOpenAPIファイルのパスを設定すること（例: `/path/to/api/public/docs/openapi.json`）

## 抽出スクリプト

`extract-schedule-api.ts` を `bun` で実行して、OpenAPIファイルからスケジュール関連の情報を抽出する。
オプション一覧は `bun "${CLAUDE_SKILL_DIR}/scripts/extract-schedule-api.ts" --help` で確認する。

## ワークフロー

### ステップ1: エンドポイント一覧の抽出

まず `--summary` オプションでスケジュールAPIの全体像を把握する:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/extract-schedule-api.ts" --summary
```

### ステップ2: 必要な詳細情報の抽出

要求に応じて適切なオプションを選択して実行する:

| 要求 | 使用するオプション |
|---|---|
| エンドポイントのパラメータを知りたい | `--paths` |
| リクエスト/レスポンスの型を知りたい | `--schemas` |
| レスポンス構造を知りたい | `--responses` |
| すべての仕様を確認したい | `--all` |

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/extract-schedule-api.ts" --paths
bun "${CLAUDE_SKILL_DIR}/scripts/extract-schedule-api.ts" --schemas
```

## 注意事項

- スクリプトの実行には `bun` が必要
- `$ref` で参照されているスキーマは `--schemas` オプションで別途抽出する
