---
name: document-saver
description: 調査内容や議論のまとめを統一フォーマットの.mdファイルとして保存するスキル。「.mdにまとめて」「ドキュメントを保存」「調査結果をまとめて」「これを記録して」「ナレッジとして保存」「メモを残して」「議論をまとめて保存」「レビュー結果を保存」などの依頼時に呼び出される。
allowed-tools: Write, Read, Glob, Bash(bun */scripts/get-timestamp.ts)
model: sonnet
---

## ワークフロー

### Step 1: 種類の特定とファイル名の決定

以下のいずれかのドキュメント種類を特定する：
- **レビュー結果**: レビューエージェント（code-quality-reviewer、static-analysis-reviewer、security-performance-reviewer、test-code-reviewer）が出力したレビュー結果
- **実装計画書**: implementation-plan-creator サブエージェントが出力した実装計画書
- **調査レポート**: コードベースや技術調査の結果
- **技術メモ**: 実装中に得た知見や気づき
- **議論まとめ**: 会話で決定した内容や要件のまとめ
- **その他**: 上記に当てはまらない一般的なドキュメント

**保存先**: デフォルトは !`echo ${MGZL_DIR:-.mgzl}`/tmp/ （ユーザー指定があればそちらを優先）

**ファイル名**: `yyyyMMdd-hhmmss-document-name.md`
- タイムスタンプは `get-timestamp.ts` で取得
  ```bash
  bun "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"
  ```
- `document-name` は内容を表す簡潔な英語名（ケバブケース）

### Step 2: テンプレートの読み込みと内容の整理

特定した種類に対応するテンプレートのみを `references/` から読み込み、ユーザーから提供された情報や会話の内容を整理して構成する。

| 種類 | テンプレート |
|------|-------------|
| レビュー結果 | [format-review-result.md](references/format-review-result.md) |
| 実装計画書 | [format-implementation-plan.md](references/format-implementation-plan.md) |
| 調査レポート | [format-investigation.md](references/format-investigation.md) |
| 技術メモ | [format-technical-memo.md](references/format-technical-memo.md) |
| 議論まとめ | [format-discussion-summary.md](references/format-discussion-summary.md) |
| その他 | [format-general.md](references/format-general.md) |

### Step 3: ファイルの保存

保存前にファイル名と保存先をユーザーに確認し、Writeツールで保存する。
既存ファイルがある場合は上書きする前に確認を取る。
