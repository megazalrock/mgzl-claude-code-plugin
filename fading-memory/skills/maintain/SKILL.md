---
name: maintain
description: fading-memory の記憶データを再構成する。各記憶の内容をコードベースの現状と突き合わせて検証し、誤った記憶の削除・部分更新を行う。「記憶をメンテして」「記憶を再構成して」「fading-memory をメンテナンス」などの依頼時に使用する。
---

fading-memory の記憶データを再構成する。有効期限の遠いもの（= 重要度の高いもの）から順に、内容が今も正しいかを検証し、結果に応じて処置する。

## 制約

- この処理による読み取り・更新で frontmatter の `score` と `lastReferenced` を変更してはならない
- 記憶データの削除は必ず `trash-memory.ts` 経由で行う（直接ファイルを消さない）

## 手順

1. 記憶の一覧を検証優先順で取得する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts"`
   - 出力は1件1行の key=value 形式（slug / permanent / expires / file / title）
   - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
2. 各記憶データについて、出力順（有効期限の降順）に:
   - `file=` のパスを Read し、本文の内容をコードベースや設定の現状と突き合わせて検証する
   - **内容が正**: 何もしない
   - **内容が偽**: `bun run "${CLAUDE_SKILL_DIR}/scripts/trash-memory.ts" <slug>` で削除する。
     ただし `permanent=true` の記憶は削除せず、偽である根拠をユーザーに報告する
   - **部分的に正**: Edit で本文を修正し、frontmatter の `updated` を現在日時（ISO 8601）に更新する
3. すべて処理したら目次と state を更新する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/finalize.ts"`
4. ユーザーに結果を報告する: 検証件数、削除した slug と理由、更新した slug と変更点、permanent で偽と判定したもの
