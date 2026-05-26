---
name: review:diff
description: 指定されたコミットやブランチとの差分をレビュー
argument-hint: [branch/tag/commit]
model: sonnet
---

このスキルではレビューを行い、レビュー結果をまとめたり、実装計画書を作成したりすることに集中する
**このスキルの実行ではファイルの修正を行ってはならない**

## コンテキスト

- レビュー対象ファイル一覧: !`git diff --name-only $ARGUMENTS`

## タスク

1. レビュー対象ファイル一覧が空の場合ははその旨をユーザーに通知し終了
2. レビュー対象ファイル一覧を元にファイルごとにファイルごとのタスクをTaskListに登録
  - ファイルごとにレビュー用のサブエージェントを決定する
    - テストファイルの場合は @reviewer-for-test-code と @reviewer-for-comments サブエージェントを選択
    - その他のファイルの場合は、以下の5つのサブエージェントで**並列**でレビュー:
      - @reviewer-for-style（コードの書き方・命名・配置・コードサイズ）
      - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
      - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
      - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
      - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
  - ファイルごとに `git diff $ARGUMENTS <filepath>` でファイルごとの差分を取得
  - ファイルごとの差分を選択したサブエージェントでレビュー
3. レビューを並列で実行するように、TaskListの依存関係を設定
4. 全てのタスクを実行
5. 全てのレビュー結果をまとめ、 document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する