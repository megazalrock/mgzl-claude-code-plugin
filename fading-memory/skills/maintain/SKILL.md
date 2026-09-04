---
name: maintain
description: fading-memory の記憶データを再構成する。各記憶の内容をコードベースの現状と突き合わせて検証し、誤った記憶の削除・部分更新を行う。「記憶をメンテして」「記憶を再構成して」「fading-memory をメンテナンス」などの依頼時に使用する。
---

fading-memory の記憶データを再構成する。有効期限の遠いもの（= 重要度の高いもの）から順に、内容が今も正しいかを検証し、結果に応じて処置する。

## 制約

- この処理による読み取り・更新で frontmatter の `score` と `lastReferenced` を変更してはならない
- 記憶データの削除は必ず `trash-memory.ts` 経由で行う（直接ファイルを消さない）
- 内容の検証は `memory-verifier` サブエージェントが行う。メインセッションは検証目的で記憶ファイルを Read しない
- 記憶データへの処置（削除・修正）はメインセッションが行う。サブエージェントには行わせない

## 手順

1. 記憶の一覧を検証優先順で取得する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts"`
   - 出力は1件1行の key=value 形式（slug / permanent / expires / file / title）
   - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
2. 検証を `memory-verifier` サブエージェントに委任する:
   - 出力順（有効期限の降順）に5件ずつのバッチへ分け、1バッチにつき1インスタンスを割り当てる
   - 複数バッチは1メッセージ内でまとめてディスパッチし、並列に実行する
   - 各インスタンスに渡す情報: `project_dir`（`${CLAUDE_PROJECT_DIR}`）と、そのバッチの `file=` の絶対パス一覧
3. 返ってきた判定に従って、記憶ごとに処置する:
   - **正**: 何もしない
   - **偽**: `bun run "${CLAUDE_SKILL_DIR}/scripts/trash-memory.ts" <slug>` で削除する。
     ただし `permanent=true` の記憶は削除せず、偽である根拠をユーザーに報告する
   - **部分的に正**: 対象ファイルを Read し、本文を修正案の内容に Edit で差し替え、frontmatter の `updated` を現在日時（ISO 8601）に更新する
   - **検証不能**: 何もしない（手順5で報告する）
4. すべて処理したら目次と state を更新する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/finalize.ts"`
5. ユーザーに結果を報告する: 検証件数、削除した slug と理由、更新した slug と変更点、permanent で偽と判定したもの、検証不能と判定した slug と理由
