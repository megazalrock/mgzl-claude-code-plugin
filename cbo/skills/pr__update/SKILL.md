---
name: pr:update
description: GitHubのプルリクエストのタイトルと本文を更新する。「PRを更新して」「PRの説明を書いて」「PR descriptionを作成して」などの要求時に使用。
argument-hint: [pr number]
allowed-tools: Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh pr diff:*), Bash(gh pr edit:*)
---

## コンテキスト
- PR番号: $ARGUMENTS

## タスク

### Phase 1: PR特定

1. PR番号が引数で渡された場合はそれを使用する
2. PR番号が渡されない場合、`gh pr list --author @me --state open --json number,title` で自分のOpen PRを取得し、AskUserQuestion で対象PRを選択させる

### Phase 2: 情報収集

3. 対象PRの現在の内容を確認
   - `gh pr view <PR番号> --json title,body`
4. `reference/pr_template.md` を読み込み、PRのフォーマット（セクション構成）を把握
5. 過去PRから書き方・文体を把握
   - `gh pr list --author @me --state merged --limit 5 --json number,title`
   - いくつかのPRの詳細を確認（`gh pr view <PR番号> --json title,body`）
6. 対象PRの変更内容を確認
   - 変更規模の把握: `gh pr diff <PR番号> --stat`（まず全体の変更規模を把握する）
   - 変更ファイル一覧: `gh pr diff <PR番号> --name-only`
   - コミットメッセージ: `gh pr view <PR番号> --json commits --jq '.commits[].messageHeadline'`
   - diffが大きい場合（目安: 500行以上）は、ファイル単位で `gh pr diff <PR番号> -- <ファイルパス>` で確認する
   - diffが小さい場合は全体を一括で確認してもよい

### Phase 3: タイトル・本文作成

7. タイトル候補を3つ作成
   - 日本語で変更内容を簡潔に表現
   - 異なる観点（目的/手段/影響範囲など）から作成
8. テンプレートのフォーマットに従い、過去PRの書き方を参考にして本文を作成
   - テンプレートのHTMLコメントも含めて完全に再現する
   - 各セクションの記述ガイドライン:
     - **Summary**: 変更の目的と内容を日本語で簡潔に記述。「なぜこの変更が必要か」と「何を変更したか」を含める
     - **Classification**: diffの内容から判断してチェックを入れる。新機能追加→Feature、不具合修正→Bugfix、リファクタリング・設定変更等→Others
     - **How to confirm**: ClassificationがFeatureまたはBugfixの場合とOthersの場合で書き分ける。
       - **Feature / Bugfix（UI操作を伴う変更）の場合**: 番号付きリスト＋ネストした箇条書きで記述する。
         - 番号付きの各ステップは「〇〇の状態で△△を行い以下を確認」のように操作内容を記述し、末尾を「以下を確認」で締める
         - 各ステップの下にネストした `-` で具体的な確認項目を列挙する
         - 確認項目には具体的な値・条件を含める（例:「10件以上」「3ヶ月ごと」「終日」など）
         - デグレッションチェックが必要な項目には「（デグレチェック）」と付記する
         - 例:
           ```
           1. 〇〇の状態で△△を行い以下を確認
              - 確認項目A（具体的な値を含める）
              - 確認項目B（デグレチェック）
           2. 別の操作を行い以下を確認
              - 確認項目C
           ```
       - **Others（リファクタリング・コードのみの変更）の場合**: 散文形式で記述する。
         - 「コードの確認は〇〇を中心にざっくり確認して頂ければと思います。」のようにレビュアーに確認すべきファイルや箇所を案内する
     - **Notion Ticket**: コミットメッセージやブランチ名からチケットURLを推測。不明な場合は空欄
     - **Remarks**: レビュアーへの補足情報、注意点、影響範囲、今後の対応予定など。特になければ「特になし」

### Phase 4: ユーザー確認・更新

9. AskUserQuestion でタイトルを選ばせる
   - 3つの選択肢を提示
   - 各選択肢の `label` にはタイトル候補、`description` にはどの観点で作成したかを表示
10. 本文の内容でよいか AskUserQuestion でユーザーに確認
11. PRを更新（`gh pr edit <PR番号> --title "..." --body "..."`）
12. 更新結果をユーザーに報告
