---
name: review:diff
description: 指定されたコミットやブランチとの差分をレビュー
argument-hint: [branch/tag/commit]
model: sonnet
---

このスキルではレビューを行い、レビュー結果をまとめたり、実装計画書を作成したりすることに集中する
**このスキルの実行ではファイルの修正を行ってはならない**（教訓ファイルはレビュー対象コードではなく knowledge ストアであり、本制約の対象外）

## コンテキスト

- レビュー対象ファイル一覧: !`git diff --name-only $ARGUMENTS`

## タスク

1. レビュー対象ファイル一覧が空の場合はその旨をユーザーに通知し終了
2. **「ファイル × レビュー観点」の組み合わせごとに1つのサブエージェント呼び出し**を TaskList に1タスクとして登録する
  - 各タスクは「1つのファイルの差分を、1つの観点専門のサブエージェントでレビューする」単位
  - 観点（=サブエージェント）の選び分け:
    - テストファイル → 以下の2つ
      - @reviewer-for-test-code
      - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
    - その他のファイル → 以下の5つ
      - @reviewer-for-style（コードの書き方・命名・配置・コードサイズ）
      - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
      - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
      - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
      - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
3. 各タスクのサブエージェントへの入力は次のとおり:
  - 対象ファイルの差分を `git diff $ARGUMENTS <filepath>` で取得し、**その差分のみ**を渡す
  - **ファイル全体は渡さない**。差分だけでは判断できない場合に限り、サブエージェント側の判断で当該ファイルを Read することを許容する
4. 全タスク間に依存関係を持たせず、並列実行されるようにする
5. 全てのタスクを実行
6. 全てのレビュー結果をまとめ、 document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する
7. 知見蓄積: 統合レビュー結果に `[3]` 推奨以上（`[3]`/`[4]`/`[5]`）の指摘が **1 件以上** ある場合のみ、`${CLAUDE_SKILL_DIR}/../../references/review-lessons/accumulation-procedure.md` を Read し、その手順に従って !`echo $MGZL_DIR`/knowledge/implementation-lessons.md に汎用的なコード実装の教訓を蓄積する。`[2]` 以下のみ・0 件ならスキップする
8. 保存したレビュー報告書を mcp__jetbrains__open_file_in_editor を利用して開くかどうか AskUserQuestion でユーザーに尋ねる
9. レビュー結果の保存先パスと、蓄積した教訓の件数（スキップ時はその旨）をユーザーに伝え終了する