---
name: maintain
description: fading-memory の記憶データを再構成する。各記憶の内容をコードベースの現状と突き合わせて検証し、誤った記憶の削除・部分更新と、長すぎる slug の短縮を行う。既定では現在 index.md に載っている記憶だけを、`--all` 指定時は退色した記憶も含めた全件を対象にする。「記憶をメンテして」「記憶を再構成して」「fading-memory をメンテナンス」などの依頼時に使用する。
argument-hint: "[--all]"
---

fading-memory の記憶データを再構成する。重要度の高い記憶（= 有効期限が遠い記憶）から順に、内容が今も正しいかを検証し、結果に応じて処置する。

既定では index.md に載っている（有効期限内の）記憶だけを対象にする。退色して index.md から外れた記憶はセッションから参照されないため、既定では検証しない。

## 制約

- この処理による読み取り・更新で frontmatter の `score` と `lastReferenced` を変更してはならない
- 記憶データの削除は必ず `trash-memory.ts` 経由で行う（直接ファイルを消さない）
- 内容の検証は `memory-verifier` サブエージェントが行う。メインセッションは検証目的で記憶ファイルを Read しない
- 記憶データへの処置（削除・修正・slug の短縮）はメインセッションが行う。サブエージェントには行わせない
- slug の付け直しは必ず `rename-memory.ts` 経由で行う（ファイルを直接リネームしない）

## 手順

1. 記憶の一覧を検証優先順で取得する。次のどちらかに当てはまる場合だけ全件モードとし、それ以外は既定モードで実行する:
   - `$ARGUMENTS` に `--all` という文字列が含まれている
   - ユーザーが依頼文で、退色した記憶・期限切れの記憶・全件を含めるよう明示的に求めている

   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts" "${CLAUDE_PROJECT_DIR}"`
   - 全件モードでは末尾に `--all` を付けて実行する。既定モードの出力は index.md に載っている記憶だけ
   - `$ARGUMENTS` のうち `--all` 以外の文字列はスクリプトに渡さない
   - 出力は1件1行の key=value 形式（slug / permanent / expires / slugTooLong / file / title）
   - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
2. 検証を `memory-verifier` サブエージェントに委任する:
   - 出力順（有効期限の降順）に5件ずつのバッチへ分け、1バッチにつき1インスタンスを割り当てる
   - 複数バッチは1メッセージ内でまとめてディスパッチし、並列に実行する
   - 各インスタンスに渡す情報: `project_dir`（`${CLAUDE_PROJECT_DIR}`）と、そのバッチの `file=` の絶対パス一覧
3. 返ってきた判定に従って、記憶ごとに処置する:
   - 正と判定された記憶には何もしない
   - 偽と判定された記憶は次のコマンドで削除する。
     ただし `permanent=true` の記憶は削除せず、偽である根拠をユーザーに報告する
     `bun run "${CLAUDE_SKILL_DIR}/scripts/trash-memory.ts" "${CLAUDE_PROJECT_DIR}" <slug>`
   - 部分的に正と判定された記憶は、対象ファイルを Read し、本文を修正案の内容に Edit で差し替え、frontmatter の `updated` を現在日時（ISO 8601）に更新する
   - 検証不能と判定された記憶には何もしない（手順6で報告する）
4. 長すぎる slug を短縮する。手順1の出力で `slugTooLong=true` の記憶のうち、手順3で削除しなかったものが対象:
   - `slugTooLong=true` は 45 文字超（`config.slug.rename`）。新規生成の目標（英単語2〜4語・30文字以内）より緩い検出用の閾値で、明らかに長すぎるものだけが対象になる
   - 検証と処置が済んだ後なので、新しい slug を決めるために対象ファイルを Read してよい
   - 新しい slug は title と本文の内容を要約した英語の kebab-case（小文字英数字とハイフンのみ）とし、英単語2〜4語・30文字以内に収める（この生成目標は検出閾値とは別）
   - 次のコマンドで付け直す。ユーザーへの確認は不要
     `bun run "${CLAUDE_SKILL_DIR}/scripts/rename-memory.ts" "${CLAUDE_PROJECT_DIR}" <旧slug> <新slug>`
   - 他の記憶の related に残る旧 slug はスクリプトが書き換える。title・score・有効期限は変わらない
   - `error=exists` は新 slug が使用済み、`error=invalid-slug` は書式か語数・文字数の違反。別の slug を決めて再実行する
5. すべて処理したら目次と state を更新する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/finalize.ts" "${CLAUDE_PROJECT_DIR}"`
6. ユーザーに結果を報告する。報告に含める項目:
   - 対象モード（既定モードなら「index.md に載っている記憶」、全件モードなら「退色した記憶を含む全件」）
   - 検証件数
   - 削除した slug とその理由
   - 更新した slug とその変更点
   - 短縮した slug（「旧 → 新」の形で列挙）
   - permanent で偽と判定したもの
   - 検証不能の判定を受けた slug とその理由
