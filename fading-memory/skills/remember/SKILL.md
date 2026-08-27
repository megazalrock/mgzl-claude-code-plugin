---
name: remember
description: fading-memory の記憶データを手動で作成する。引数で指定された内容について、引数が無い場合は現在のセッションの内容から記憶を抽出して保存する。「記憶して」「覚えておいて」「記憶を作成して」などの依頼時に使用する。
argument-hint: [記憶する内容の指示（例: XXX.ts の使用方法について）]
---

fading-memory の記憶データを作成する。保存先の決定・frontmatter の直列化・slug 衝突の回避・目次（INDEX.md）の再生成はすべて保存スクリプトが行うため、記憶ファイルを Write や Edit で直接作成・編集せず、必ずスクリプト経由で保存する。

## 記憶の内容ルール

- セッションを跨いで再利用可能なナレッジのみを記憶にする。一時的な作業情報（今回限りのエラーや途中経過）は含めない
- slug は内容を要約した英語の kebab-case にする
- title は「どのケースで役立つ何の情報か」を1行で書く
- body は本文の Markdown のみ（frontmatter は含めない）。内容は推測で書かず、対象のコードやドキュメントを Read して現状を確認してからまとめる
- related には関連する既存記憶の slug だけを入れる
- permanent の指定は行わない

## 手順

1. 記憶する対象を決める。引数: 「$ARGUMENTS」
   - 引数が空でない場合: その指示が示す対象についての記憶を作成する
   - 引数が空の場合: 現在のセッションの会話内容から、上記ルールに該当するナレッジを抽出する（複数件になってもよい）
2. 既存の記憶一覧を取得する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts" "${CLAUDE_PROJECT_DIR}"`
   - 出力は1件1行の key=value 形式（slug / title）
   - 既存の記憶と同じ関心の内容は newMemories にせず、updatedMemories として既存 slug の内容を書き直す
   - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
3. 記憶データを JSON で組み立て、stdin から保存スクリプトに渡す:
   ```bash
   bun run "${CLAUDE_SKILL_DIR}/scripts/save-memories.ts" "${CLAUDE_PROJECT_DIR}" <<'EOF'
   {"newMemories":[{"slug":"...","title":"...","body":"...","related":[]}],"updatedMemories":[{"slug":"...","body":"...","related":[]}]}
   EOF
   ```
   - 該当が無い配列は空配列にする
   - 書き込みで EPERM (operation not permitted) が出た場合は入力の不備ではなく、保存先 `~/.claude/fading-memory/` がサンドボックスの書き込み許可外であることが原因
4. スクリプトの出力（key=value 形式）を確認し、結果をユーザーに報告する:
   - `created=` / `updated=` の slug と title を伝える
   - `skipped=` は存在しない slug への更新を意味する。newMemories に組み替えて再実行する
   - `error=` は入力 JSON の不備（kebab-case でない slug、title の改行など）。修正して再実行する
