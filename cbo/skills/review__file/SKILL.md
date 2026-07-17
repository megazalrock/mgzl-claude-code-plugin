---
name: review:file
description: 指定されたファイルをレビューする[skill]
argument-hint: [ file path ]
---

このスキルではレビューを行い、レビュー結果をまとめたり、実装計画書を作成したりすることに集中する
**このスキルの実行ではファイルの修正を行ってはならない**（教訓ファイルはレビュー対象コードではなく knowledge ストアであり、本制約の対象外）

# コンテキスト

- 指定されたファイル: $ARGUMENTS

# タスク

1. 指定されたファイルがない場合は、その旨をユーザー伝え終了する
2. レビュー用サブエージェントを特定し、レビューを実行する
  - テストファイルの場合は、@reviewer-for-test-code と @reviewer-for-comments サブエージェントでレビュー
  - それ以外の場合は、以下の4つのサブエージェントで**並列**でレビュー:
    - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
    - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
    - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
    - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
  - 各サブエージェントへの指示に「各指摘には対象ファイルの行番号に基づく `**位置**` 欄（side は new、行番号はファイル全体の行番号）を必ず記載すること」を含める
3. 全サブエージェントのレビュー結果を統合し、正本 JSON 報告書を組み立てて保存する
   - スキーマは `cbo/skills/document-saver/references/format-review-result-json.md` に従う。document-saver スキルは使わず Write ツールで直接保存する
   - `reporter` は固定で `ClaudeCode review:file`。`model` は実行中の自身のモデル名（不明なら `unknown`）
   - `base_commit` / `head_commit` はどちらも `null`
   - 各指摘を `findings[]` の要素にする（`id` は R000 形式の連番、`reporter` に担当サブエージェント名、`**位置**` 欄から `file` / `anchor` を組み立て、`anchor.side` は `new`）
   - `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する
   - 対象ファイル中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（difit のコメント本文に載るため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
4. 保存した報告書を difit で開く
   - `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <保存した JSON の絶対パス> --file <レビュー対象ファイルの相対パス>` を実行する
   - 出力の `url=` をユーザーに提示し、`unanchored=` に指摘 ID があればその本文を最終報告に含める
   - stderr に `error=` が出力された場合は difit 起動を諦め、保存先パスの提示にフォールバックする
   - 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入する
5. 知見蓄積: 正本 JSON の `findings` に `severity` が 3 以上の指摘が **1 件以上** ある場合のみ、`TaskCreate` で進捗管理用タスクとして登録せず、`Agent` ツールで `@knowledge-distiller` サブエージェントを `run_in_background: true` で直接起動し、正本 JSON の内容を `source` としてそのまま渡してバックグラウンドで教訓蓄積する。`severity` 2 以下のみ・0 件ならスキップする。結果は待たず、すぐに 6. に進む。
6. レビュー結果の保存先パスと difit の URL、教訓蓄積をバックグラウンドで起動した旨（スキップ時はその旨）をユーザーに伝え終了する
