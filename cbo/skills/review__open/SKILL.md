---
name: review:open
description: 保存済みのレビュー報告書（JSON または旧 md 形式）を difit（diff ビューア）で開き、各指摘を該当行のコメントとして表示する。「レビュー報告書を difit で開いて」「difit で開いて」「レビューを difit で見せて」「review open」などの依頼時に使用する。
argument-hint: [report file path] [--save]
model: sonnet
---

## コンテキスト

- 引数: $ARGUMENTS
  - `.json` / `.md` で終わるトークン → レビュー報告書のパス
  - `--save` フラグ → md 報告書から推測・変換した内容を正本 JSON として保存する
- 正本 JSON のスキーマ: `cbo/skills/document-saver/references/format-review-result-json.md`

## タスク

1. 報告書を特定する
  - 引数にパスがあればそれを使う
  - 無ければ !`echo $MGZL_DIR`/reviews/ 配下の報告書（`.json` と `.md`。`.difit-session.json` は除外）の最新 5 件から AskUserQuestion で選択させる
2. 報告書の形式で分岐する

### JSON 報告書の場合

3. 報告書を読み、`base_commit` / `head_commit` を確認する
  - 両方に SHA がある場合: `git cat-file -e <sha>^{commit}` で双方の存在を確認する。存在しない SHA がある場合（rebase / GC 後）はその旨を報告して中止する
    - 存在すれば `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <報告書の絶対パス> --diff <head_commit> <base_commit>`
  - 両方 `null` の場合（review:file 由来）: `findings[].file` の代表値（通常は全指摘で共通）を対象に
    `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <報告書の絶対パス> --file <対象ファイルの相対パス>`
    を実行する。報告書作成後にファイルが変更されていると行がズレる可能性がある旨をユーザーに伝える
4. `--save` が指定されていた場合、JSON 報告書には不要である旨を伝える（既に正本のため。処理は継続する）

### md 報告書の場合（旧形式。推測ベースのベストエフォート）

3. 報告書をパースして正本 JSON と同じ構造を組み立てる
  - フロントマターの `reporter` / `model` / `base_commit` / `head_commit` を引き継ぐ（無い項目は `unknown` または `null`）
  - `### R*` 見出しごとに `id` / `severity`（`[N]`）/ `problem`（`**問題**`）/ `reason`（`**理由**`）/ `reporter`（`**報告者**`）/ `proposals`（`**提案**`。フェンス内のコードを `code`、フェンス外の平文を `text` に分離し、一方しか無ければ他方は `null`。`**案A**`/`**案B**` があれば分割）を抽出する
  - 見出し行末尾の `評価：` / `対応：` の記入があれば `evaluation` に引き継ぐ
  - `file` / `anchor` は `**問題**`・`**提案**` 本文中のファイルパス・行番号の記述から**推測**する。推測できなければ `file: null`
  - `### R*` 見出しが 1 件もパースできない場合は、レビュー報告書として解釈できない旨を報告して中止する
4. 推測結果の要約（各 ID → `file:line`）をユーザーに提示し、誤アンカーの可能性がある旨を明示する
5. 組み立てた JSON を保存する
  - `--save` 指定時: `yyyyMMdd-hhmmss-<元のファイル名の英語部分>-converted.json` として !`echo $MGZL_DIR`/reviews/ に保存する（タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得。元の md は移動・削除しない）
  - `--save` なし: !`echo $MGZL_DIR`/tmp/ に一時ファイルとして保存する
6. diff 対象を決めて起動する
  - `base_commit` / `head_commit` が引き継げて双方実在する（`git cat-file -e <sha>^{commit}` で確認） → `launch <JSON パス> --diff <head_commit> <base_commit>`
  - 引き継げない → 対象ファイル（findings の `file` の代表値）で `launch <JSON パス> --file <相対パス>`。現在のワークツリーに対して開くため行ズレの可能性がある旨を明示する
  - 対象ファイルすら特定できない場合はその旨を報告して中止する

### 共通の仕上げ

- 出力の `url=` をユーザーに提示する。`unanchored=` に指摘 ID があればその本文をターミナルに表示する
- 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入し、修正は review:fix を呼び出す
- stderr に `error=` が出力された場合は difit 起動を諦め、報告書パスの提示にフォールバックする

## 注意事項

- このスキルはレビュー対象コードを修正しない。正本 JSON の新規保存（`--save` / 一時ファイル）以外の既存ファイル編集も行わない
- 秘密情報（トークン・鍵など）が報告書に含まれる場合、コメント本文へ転記しない
