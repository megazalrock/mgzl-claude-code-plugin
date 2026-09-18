---
name: remember
description: fading-memory の記憶データを作成する。引数で指定された内容について、引数が無い場合は現在のセッションの内容から記憶を抽出して保存する。ユーザーからの訂正や作業方針の指示、調査で判明した非自明な原因・設計判断・仕様、サンドボックスや環境固有の制約など、セッションを跨いで再利用できるナレッジが得られた時点で、ユーザーの依頼が無くても自発的に使用する。「記憶して」「覚えておいて」「記憶を作成して」などの依頼時に使用する。
argument-hint: "[記憶する内容の指示（例: XXX.ts の使用方法について）]"
---

fading-memory の記憶データを作成する。保存先の決定・frontmatter の直列化・slug 衝突の回避・目次（INDEX.md）の再生成はすべて保存スクリプトが行うため、記憶ファイルを Write や Edit で直接作成・編集せず、必ずスクリプト経由で保存する。

## 記憶の内容ルール

- セッションを跨いで再利用可能なナレッジのみを記憶にする。一時的な作業情報（今回限りのエラーや途中経過）は含めない
- slug は内容を要約した英語の kebab-case にする
- title は「どのケースで役立つ何の情報か」を1行で書く
- body は本文の Markdown のみ（frontmatter は含めない）。内容は推測で書かず、対象のコードやドキュメントを Read して現状を確認してからまとめる
- related には関連する既存記憶の slug だけを入れる
- permanent の指定は行わない

## 自動呼び出し時の振る舞い

- ユーザーの明示的な依頼ではなく自発的に呼び出した場合、保存前に AskUserQuestion 等で確認を取らず、そのまま保存する（SessionEnd の自動抽出と同じ扱い）
- 進行中の作業を中断しないよう、報告は `created=` / `updated=` の slug と title を1〜2行で伝えるだけにし、その後すぐ元の作業へ戻る
- 記憶にする基準は「記憶の内容ルール」と同じ。今回限りのエラーや途中経過は保存しない
- 同じセッション内で同じ関心の記憶を既に保存している場合は、新規作成ではなく updatedMemories でその slug を書き直す

## 手順

1. 記憶する対象を決める。引数: 「$ARGUMENTS」
   - 引数が空でない場合: その指示が示す対象についての記憶を作成する
   - 引数が空の場合: 現在のセッションの会話内容から、上記ルールに該当するナレッジを抽出する（複数件になってもよい）
2. 既存の記憶と重複していないかを判定する:
   1. 既存の記憶一覧を取得する:
      `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts" "${CLAUDE_PROJECT_DIR}"`
      - 出力は1件1行の key=value 形式（slug / title）
      - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
   2. 保存しようとする記憶ごとに title を決め、重複判定スクリプトへ stdin で渡す:
      ```bash
      bun run "${CLAUDE_SKILL_DIR}/scripts/check-duplicates.ts" "${CLAUDE_PROJECT_DIR}" <<'EOF'
      {"candidates":["<1件目の title>","<2件目の title>"]}
      EOF
      ```
   3. 出力を解釈する。`candidate=` の番号は渡した candidates の順番に対応する
      - `typesafe=unavailable`: 判定は使えない。1 で取得した一覧を見て自分で判断する（理由を報告に含めなくてよい）
      - `verdict=duplicate`: `top=` の先頭 slug の記憶を Read し、同じ関心であることを確かめてから updatedMemories でその slug を書き直す。読んで違うと分かれば newMemories にしてよい
      - `verdict=ambiguous`: `top=` の各 slug を Read して比較し、同じ関心があれば updatedMemories、なければ newMemories
      - `verdict=new`: newMemories にする。ただし一覧を見て明らかに同じ関心の記憶があると分かる場合は updatedMemories にしてよい
3. 記憶データを JSON で組み立て、stdin から保存スクリプトに渡す:
   ```bash
   bun run "${CLAUDE_SKILL_DIR}/scripts/save-memories.ts" "${CLAUDE_PROJECT_DIR}" <<'EOF'
   {"newMemories":[{"slug":"...","title":"...","body":"...","related":[]}],"updatedMemories":[{"slug":"...","body":"...","related":[]}]}
   EOF
   ```
   - 該当が無い配列は空配列にする
   - 書き込みで EPERM (operation not permitted) が出た場合は入力の不備ではなく、記憶データの保存先（既定は `~/.claude/fading-memory/`、`FADING_MEMORY_DIR` で変更可）がサンドボックスの書き込み許可外であることが原因
4. スクリプトの出力（key=value 形式）を確認し、結果をユーザーに報告する:
   - `created=` / `updated=` の slug と title を伝える
   - `skipped=` は存在しない slug への更新を意味する。newMemories に組み替えて再実行する
   - `error=` は入力 JSON の不備（kebab-case でない slug、title の改行など）。修正して再実行する
