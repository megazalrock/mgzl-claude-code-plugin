---
name: review:file
description: 指定されたファイルをレビューする[skill]
argument-hint: [ file path ]
---

このスキルではレビューを行い、レビュー結果をまとめたり、実装計画書を作成したりすることに集中する
**このスキルの実行ではファイルの修正を行ってはならない**

# コンテキスト

- 指定されたファイル: $ARGUMENTS

# タスク

1. 指定されたファイルがない場合は、その旨をユーザー伝え終了する
2. レビュー用サブエージェントを特定し、レビューを実行する
  - テストファイルの場合は、@test-code-reviewer サブエージェントでレビュー
  - それ以外の場合は、以下の3つのサブエージェントで**並列**でレビュー:
    - @code-quality-reviewer（コード設計・構造・可読性）
    - @static-analysis-reviewer（TypeScript品質・コメント品質）
    - @security-performance-reviewer（セキュリティ・パフォーマンス）
3. 全サブエージェントのレビュー結果を統合する
4. レビュー結果を document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する
