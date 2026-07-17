---
name: review:diff
description: 指定されたコミットやブランチとの差分をレビュー
argument-hint: [branch/tag/commit] [--target <絞り込み指定>] [--simple]
model: sonnet
---

このスキルではレビューを行い、レビュー結果をまとめたり、実装計画書を作成したりすることに集中する
**このスキルの実行ではファイルの修正を行ってはならない**（教訓ファイルはレビュー対象コードではなく knowledge ストアであり、本制約の対象外）

## 引数

$ARGUMENTS を以下の3つに解析する:

- **diff 対象**（省略可）: 最初のフラグ以外の引数。branch/tag/commit を指定する
- **`--target <絞り込み指定>`**（省略可）: レビュー対象ファイルを絞り込む自然言語の指定。`--target` の直後から次のフラグまたは末尾までを値として扱う（例: 「新規ファイルのみ」「既存ファイルのみ」「認証に関係するファイルのみ」「`src/api/` 以下」）
- **`--simple`**（省略可）: 簡易レビューモードを有効化する

## コンテキスト

- 渡された引数: $ARGUMENTS

## タスク

1. 引数を解析し、diff 対象・絞り込み指定・簡易モードの有無を確定する
2. `git diff --name-status <diff対象>` を実行してレビュー対象ファイル一覧を取得する（A=新規 / M=既存変更 などのステータスは絞り込み判定に使う）
   - あわせて **BASE ハッシュ** と **HEAD ハッシュ** をフル SHA で解決し、Step 9 の JSON 報告書出力まで保持する:
     - `git rev-parse <diff対象>` の結果を `base_commit` として保持（`<diff対象>` が省略された場合は `git rev-parse HEAD` を代わりに使う）
     - `git rev-parse HEAD` の結果を `head_commit` として保持
     - どちらも短縮せずフル 40 桁の SHA-1 を使う
3. 絞り込み指定がある場合、ステータス・ファイルパス・必要に応じて差分内容から該当性を判断し、ファイル一覧を絞り込む
4. レビュー対象ファイル一覧（絞り込み後）が空の場合はその旨をユーザーに通知し終了
5. **「ファイル × レビュー観点」の組み合わせごとに1つのサブエージェント呼び出し**を TaskList に1タスクとして登録する
  - タスク登録の前に、**ファイルごと**にレビュアー用モデルを決定する（差分全体の合計で判定してはならない）:
    - `git diff --numstat <diff対象> -- <レビュー対象ファイル（絞り込み後）...>` を **1 回だけ** 実行し、各ファイルの (insertions + deletions) の合計行数を取得する
    - 各ファイルについて、合計が **50 行未満** → そのファイルに紐づくタスクのモデルは `sonnet`
    - 各ファイルについて、合計が **50 行以上** → そのファイルに紐づくタスクのモデルは `opus`
    - 同一ファイルに紐づく複数観点のタスクは同じモデルを共有する
    - 閾値の根拠: バグ埋め込みベンチマーク（`docs/model-benchmark-2026-07/`）で、50行未満では sonnet の検出力は opus と同等以上、50行以上では推論を要する微妙なバグを opus のみが検出できたため
  - 各タスクは「1つのファイルの差分を、1つの観点専門のサブエージェントでレビューする」単位
  - 観点（=サブエージェント）の選び分け:
    - 通常モード:
      - テストファイル → 以下の2つ
        - @reviewer-for-test-code
        - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
      - その他のファイル → 以下の4つ
        - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
        - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
        - @reviewer-for-security-performance（セキュリティ・パフォーマンス）
        - @reviewer-for-comments（コメントの実装一致性・参照妥当性・冗長性）
    - 簡易モード（`--simple` 指定時）:
      - テストファイル → @reviewer-for-test-code のみ
      - その他のファイル → 以下の2つ
        - @reviewer-for-logic（実装の正当性・エッジケース・例外処理）
        - @reviewer-for-design（DRY/KISS/SOLID/YAGNI・責務分離・依存関係制約）
6. 各タスクのサブエージェントへの入力は次のとおり:
  - 対象ファイルの差分を `git diff <diff対象> <filepath>` で取得し、**その差分のみ**を渡す
  - **ファイル全体は渡さない**。差分だけでは判断できない場合に限り、サブエージェント側の判断で当該ファイルを Read することを許容する
  - サブエージェントへの指示に「各指摘には差分のハンク行番号に基づく `**位置**` 欄（new 側の行番号を優先）を必ず記載すること」を含める
7. 全タスク間に依存関係を持たせず、並列実行されるようにする
8. 全てのタスクを実行
  - 各レビュアーサブエージェントの起動時、`Agent` ツールの `model` パラメータに 5. で **タスクの対象ファイルに対して** 決定したモデル（`sonnet` または `opus`）を指定する
9. 全てのレビュー結果を統合し、正本 JSON 報告書を組み立てて保存する
   - スキーマは `cbo/skills/document-saver/references/format-review-result-json.md` に従う。document-saver スキルは使わず Write ツールで直接保存する
   - `reporter` は固定で `ClaudeCode review:diff`。`model` は実行中の自身のモデル名（不明なら `unknown`）
   - `base_commit` / `head_commit` は Step 2 で解決したフル 40 桁 SHA-1（**必須**）
   - 各指摘を `findings[]` の要素にする:
     - `id` は出現順に R000, R001, ...（R + 3桁ゼロパディング連番）
     - `reporter` に担当サブエージェント名を記載する
     - レビュアー報告の `**位置**` 欄から `file` と `anchor` を組み立てる（`ファイル全体` → `anchor: null`、`なし` → `file: null` かつ `anchor: null`）
     - `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する
   - 差分中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（difit のコメント本文に載るため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
10. 知見蓄積: **簡易モード（`--simple` 指定時）はこのステップを実行せずスキップする**。通常モードでは、正本 JSON の `findings` に `severity` が 3 以上の指摘が **1 件以上** ある場合のみ、`TaskCreate` で進捗管理用タスクとして登録せず、`Agent` ツールで `@knowledge-distiller` サブエージェントを `run_in_background: true` で直接起動し、正本 JSON の内容を `source` としてそのまま渡してバックグラウンドで教訓蓄積する。`severity` 2 以下のみ・0 件ならスキップする。結果は待たず、すぐに 11. に進む。
11. 保存した報告書を difit で開く
   - `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <保存した JSON の絶対パス> --diff <head_commit> <base_commit>` を実行する
   - 出力（key=value 形式）の `url=` をユーザーに提示する
   - `unanchored=` に指摘 ID がある場合、それらは difit に表示されないため Step 12 の報告に指摘本文を含める
   - stderr に `error=` が出力された場合は difit 起動を諦め、保存先パスの提示にフォールバックする（レビュー自体は成功として扱う）
   - 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入する
   - 前提: レビュー対象は コミット済みの HEAD（作業ツリーがクリーン）。未コミット変更があると、レビュー時の行番号と difit の表示行がずれてコメントのアンカーが誤る可能性がある
12. 以下をユーザーに伝えて終了する: 正本 JSON の保存先パス、difit の URL（起動できた場合）、difit に載らなかった指摘（`unanchored=` 対象）の本文、教訓蓄積をバックグラウンドで起動した旨（スキップ時はその旨）
