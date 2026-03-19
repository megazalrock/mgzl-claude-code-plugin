---
name: impl:execute
description: TaskList管理で実装計画書を実行
argument-hint: [implementations file name | -y で確認をスキップ]
disable-model-invocation: true
model: opus
---

## コンテキスト
- 指定の実装計画書: $ARGUMENTS

## タスク

1. 実装計画書のファイルを特定する
  - 「指定の実装計画書」が指定された場合は、それを選択
  - 「指定の実装計画書」が指定されていない場合は、現在のセッションで作成された実装計画書を選択
  - 現在のセッションで作成された実装計画書がない場合は、 最新の実装計画書を5件取得し、AskUserQuestion でユーザーに選択させる

2. 選択した実装計画書の概要をまとめ、実行確認を行う
  - 「指定の実装計画書」に `-y` フラグが含まれている場合は、確認をスキップしてそのまま実行に進む
  - `-y` フラグがない場合は、AskUserQuestion でこの実装計画書で実装計画を実行してよいかユーザーに最終確認する
    - 選択肢は必ず「実行する」「実行しない」の順で並べる

3. 実装計画書のステップをタスクリストに登録
  - TaskCreate を使用して各ステップをタスクとして登録
  - subject: ステップのタイトル
  - description: ステップの詳細内容
  - activeForm: 「ステップN: [タイトル]を実装中」形式
  - 各タスクに適切な依存関係（addBlockedBy）を設定
     - 実装計画書に依存関係が記されてる場合はそれに従う
     - 実装計画書に依存関係が記されていない場合は、各ステップを直列に依存関係に設定する
  - 最後にコードレビュータスクも追加登録

4. TaskList で未完了のタスクを確認
  - 全て完了していたら、既に実装済みである旨をユーザーに通知
  - 未完了タスクがあれば5.に進む

5. 次の未完了タスクを実行
  - TaskList で並列実行可能な（ブロックされていない）未完了タスクを特定する
  - 単一タスクの場合:
    - TaskUpdate でステータスを `in_progress` に変更
    - @implementation-step-executor サブエージェントを利用して実装
    - 完了後、TaskUpdate でステータスを `completed` に変更
  - 複数タスクが並列実行可能な場合:
    a. 実装計画書の難易度情報を参照し、各タスクを「難易度: 高」と「それ以外」に分類
    b. 「難易度: 高」のタスクが1つ以上ある場合 → チーム実行フロー（5-A）へ
    c. 「難易度: 高」のタスクがない場合 → 通常並列フロー（5-B）へ

5-A. チーム実行フロー（難易度: 高の並列ステップ）
  1. TeamCreate でチームを作成（チーム名: `impl-{計画書名の略称}`）
  2. 難易度: 高の各ステップについて、チームのタスクリストに TaskCreate で登録
     - subject: ステップのタイトル
     - description: ステップの詳細内容（実装計画書から転記）
  3. 各タスクに対応する @implementation-step-executor チームメイトを Agent ツールで起動
     - team_name パラメータを設定
     - name: `step-{ステップ番号}` 形式
     - プロンプトに実装計画書のパスと担当ステップ番号を明記
  4. TaskUpdate で各チームタスクの owner を対応するチームメイト名に設定
  5. 難易度: 中/低のステップは通常通り @implementation-step-executor Agent で並列起動（チーム外）
  6. 全チームメイトの完了報告を待つ（メッセージは自動配信される）
  7. 全タスク完了後:
     - 各チームメイトに SendMessage type: "shutdown_request" を送信
     - TeamDelete でチームを削除
     - メインのタスクリストの該当タスクを TaskUpdate でステータス `completed` に変更

5-B. 通常並列フロー（難易度: 高なしの並列ステップ）
  - 各タスクの TaskUpdate でステータスを `in_progress` に変更
  - @implementation-step-executor サブエージェントを並列に起動して実装
  - 完了後、各タスクの TaskUpdate でステータスを `completed` に変更

6. TaskList で残りのタスクを確認し、未完了タスクがあれば5.を繰り返す

7. 全ステップ完了後、コードレビュータスクを実行
  - TaskUpdate でステータスを `in_progress` に変更
  - テストコードの場合は @test-code-reviewer サブエージェントでレビュー
  - それ以外は @code-quality-reviewer、@static-analysis-reviewer、@security-performance-reviewer サブエージェントで**並列**でレビュー
  - レビュー結果に問題があれば @code-fix-executor を実行し再レビュー
  - 問題がなければ TaskUpdate でステータスを `completed` に変更

8. 実装計画書のタイトルに「（実装完了）」と追記

9. 全ての作業が完了した旨をユーザーに通知

## 注意事項
- レビューを2回以上繰り返しても修正できない場合は実行を中止し、問題点を報告
- タスクの進捗はいつでも TaskList で確認可能
- チーム実行中にチームメイトがエラーや問題を報告した場合は、SendMessage で指示を送り対処する
- チームメイトが応答しなくなった場合は、shutdown_request を送信してから手動で対処する
- チーム実行の途中で中止する場合は、全チームメイトをシャットダウンしてから TeamDelete を行う
