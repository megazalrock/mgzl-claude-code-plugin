---
name: list
description: fading-memory の記憶データを score（セッションで実際に役立ったと判定された累積回数）の降順で一覧表示する。各記憶の有効期限までの残り日数と最終参照日を添えて、どれが定着しどれが忘却されかけているかを示す。「記憶の一覧を見せて」「記憶をスコア順に」「どんな記憶がある？」「fading-memory の一覧」などの依頼時に使用する。
---

fading-memory の記憶データを score の降順で一覧表示する。score は「セッションで実際に役立った」と判定された累積回数であり、高いほど定着している記憶を意味する。

## 手順

1. 記憶の一覧を取得する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts" "${CLAUDE_PROJECT_DIR}"`
   - 1行目は `total=<件数>`。以降は1件1行の key=value 形式（score / slug / remaining / lastReferenced / permanent / title）で score の降順に並ぶ
   - `remaining` は有効期限までの残り日数。`infinite` は permanent（期限なし）、負値は既に期限切れで次回のセッション開始時に trash へ移る記憶を意味する
   - `lastReferenced=null` は一度も「役立った」と判定されていない記憶を意味する
   - `malformed=` の行があれば件数とファイル名だけを報告する（修復・削除はしない）
2. ユーザーに報告する。スクリプトの出力はそのまま貼らず、次の構成にまとめる:
   - 冒頭1行に、総件数と score の分布（最高 score と score>0 の件数）
   - 続けて score の降順に1件1行のリスト。各行には score・残り日数・title を必ず含め、slug は title の後に括弧書きで添える
   - リストの後に1行、忘却の見通しを添える。`remaining` が 7 以下の記憶があればその slug を挙げて「まもなく忘却される」と伝え、1件も無ければ該当が無い旨を伝える
   - 記憶が0件なら、その旨だけを伝える
   - Markdown のテーブルは使わずリストで書く
