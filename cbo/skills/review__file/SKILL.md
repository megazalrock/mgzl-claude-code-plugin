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
  - テストファイルの場合は、@reviewer-for-test-code と @reviewer-for-comments サブエージェントでレビュー
  - それ以外の場合は、以下の5つのサブエージェントで**並列**でレビュー:
    - @reviewer-for-style（コードの書き方・命名・配置・コードサイズ）
    - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
    - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
    - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
    - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
3. 全サブエージェントのレビュー結果を統合する
4. レビュー結果を document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する
