---
name: impl:create
description: 対話形式で実装計画書を作成[skill]
argument-hint: [what to do]
model: opus
---

## コンテキスト
- 指示された実装内容: $ARGUMENTS

## タスク

**IMPORTANT**: 実装を開始するには**必ず**ユーザーが一度実装計画書を確認します。

実装計画の作成中にユーザーに質問をする場合は、 AskUserQuestion などを利用してわかりやすくユーザーに伝えます。

1. 実装内容を特定
  - 指示された実装内容がある場合、それを実装内容とする
  - 指示された実装内容がない場合は、コンテキストから取得する
  - コンテキスト取得から取得できない場合は、ユーザーに実装内容が不明である旨を伝えて終了する
2. 実装内容についての実装計画書を書くための情報を AskUserQuestion を利用して対話形式で収集する
3. 収集した情報を元に @implementation-plan-creator エージェントを利用して実装計画書を作成する
4. 作成した実装計画書の不明点を @implementation-plan-investigator エージェントを利用して解決し、完了したら 5. にすすむ
5. 作成した実装計画書を @implementation-plan-reviewer エージェントでレビュー
  - 問題が見つかった場合：修正して、再度 4. を実行
  - 問題が見つからなかった場合 6. に進む
6. フィードバック蓄積（レビューで修正が発生した場合のみ実行。一発承認の場合はスキップ）
  - レビューで指摘された内容から、汎用的な教訓を抽出する
  - `!`echo ${MGZL_DIR:-.mgzl}`/knowledge/implementation-plan-lessons.md` に該当カテゴリへ追記する
  - 特定の機能に依存する指摘は記録しない
7. 実装計画書が完成したら mcp__jetbrains__open_file_in_editor を利用してファイルを開くかどうか AskUserQuestion でユーザーに尋ねる
8. 実装計画のタイトルとファイルパスを伝え終了する
