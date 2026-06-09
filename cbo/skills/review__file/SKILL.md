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
  - それ以外の場合は、以下の5つのサブエージェントで**並列**でレビュー:
    - @reviewer-for-style（コードの書き方・命名・配置・コードサイズ）
    - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
    - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
    - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
    - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
3. 全サブエージェントのレビュー結果を統合する
4. レビュー結果を document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する
5. 知見蓄積: 統合レビュー結果に `[3]` 推奨以上（`[3]`/`[4]`/`[5]`）の指摘が **1 件以上** ある場合のみ、`${CLAUDE_SKILL_DIR}/../../references/review-lessons/accumulation-procedure.md` を Read し、その手順に従って !`echo $MGZL_DIR`/knowledge/implementation-lessons.md に汎用的なコード実装の教訓を蓄積する。`[2]` 以下のみ・0 件ならスキップする
6. 保存したレビュー報告書を mcp__jetbrains__open_file_in_editor を利用して開くかどうか AskUserQuestion でユーザーに尋ねる
7. レビュー結果の保存先パスと、蓄積した教訓の件数（スキップ時はその旨）をユーザーに伝え終了する
