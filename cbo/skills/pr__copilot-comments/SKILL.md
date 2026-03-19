---
name: pr:copilot-comments
description: 指定したPRのGitHub Copilotによる未解決のレビューコメントを取得する。「Copilotの指摘を確認して」「PRのCopilotコメント」「未解決のCopilotレビューを取得」「Copilotの未解決コメントを見せて」等の依頼時に使用。PR番号を引数として受け取る。
argument-hint: <PR番号>
allowed-tools: Bash(bun run:*)
---

# pr:copilot-comments

指定したPRからGitHub Copilotによる未解決のレビューコメントを取得して表示するスキル。

## コンテキスト

- PR番号: $ARGUMENTS

## タスク

1. PR番号が引数で渡されていない場合はユーザーにその旨を通知し終了
2. 以下のスクリプトを実行してCopilotの未解決コメントを取得

```bash
bun run .claude/skills/pr__copilot-comments/scripts/fetch-copilot-comments.ts $ARGUMENTS
```

3. スクリプトの出力はJSON形式。結果に応じて以下のように対応する:
   - `error` フィールドがある場合: エラー内容をユーザーに通知
   - `unresolvedCount` が 0 の場合: 未解決のCopilot指摘がない旨を通知
   - 指摘がある場合: 以下の形式でユーザーに提示

## 出力フォーマット

```
### PR #<number>: <title>
<url>

未解決のCopilot指摘: <unresolvedCount>件

---

#### 1. `<path>`:<line info>
<コメント本文（suggestion blockがあればそのまま表示）>

---
(以降繰り返し)
```

- 行情報は `startLine` がある場合は `L<startLine>-L<line>`、ない場合は `L<line>` と表示
- `line` が null の場合はファイルレベルのコメントとして行番号表示を省略
