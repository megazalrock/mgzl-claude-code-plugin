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

- **diff 対象**（省略可）: 最初のフラグ以外の引数。branch/tag/commit を指定する。省略時はタスク 1. の「diff モードの決定」に従って自動決定する
- **`--target <絞り込み指定>`**（省略可）: レビュー対象ファイルを絞り込む自然言語の指定。`--target` の直後から次のフラグまたは末尾までを値として扱う（例: 「新規ファイルのみ」「既存ファイルのみ」「認証に関係するファイルのみ」「`src/api/` 以下」）
- **`--simple`**（省略可）: 簡易レビューモードを有効化する

## コンテキスト

- 渡された引数: $ARGUMENTS

## タスク

0. **前提チェック**: 利用可能なツールに `mcp__reviewview__start_review` が存在するか確認する
   - 存在しない場合は、**後続の処理を一切行わずに即座に停止**し、以下をユーザーに報告して終了する:
     - reviewview の MCP サーバーが接続されていないため、このスキルは実行できないこと
     - 確認手順: `cbo/.mcp.json` の `reviewview` エントリのパスが正しいか、reviewview の `packages/server/dist/main.js` がビルド済みか、Claude Code を再起動して MCP サーバーが接続されたか
   - reviewview を使わずにレビューだけ実行して報告書を残すフォールバックはしない（レビュアーを起動する前にここで落とす）
1. 引数を解析し、diff 対象・絞り込み指定・簡易モードの有無を確定し、**diff モード** を決定する
   - diff 対象が指定されている場合 → **コミット比較モード**（指定された branch/tag/commit を diff 対象とする）
   - diff 対象が未指定の場合、以下を上から順に判定して最初に該当したモードを使う:
     1. `git diff --cached --name-status` の出力が空でない → **staged モード**（stage された内容のみをレビューする）
     2. `git diff --name-status` の出力が空でない → **worktree モード**（未コミットの変更を全てレビューする。stage が空なので作業ツリーの差分が未コミット変更の全てと一致する）
     3. どちらも空 → **merge-base モード**: デフォルトブランチ（`git symbolic-ref --short refs/remotes/origin/HEAD` で解決し、失敗時は `main`、それも実在しなければ `master`）と現在のブランチのマージベースを `git merge-base HEAD <デフォルトブランチ>` で求め、その SHA を diff 対象とする（以降はコミット比較モードとして扱う）
   - 未追跡（untracked）ファイルはどのモードでも判定・レビュー対象に含めない
2. レビュー対象ファイル一覧を取得する（A=新規 / M=既存変更 などのステータスは絞り込み判定に使う）
   - コミット比較モード: `git diff --name-status <diff対象>` を実行する
   - staged / worktree モード: Step 1 の判定で実行した `git diff --cached --name-status` / `git diff --name-status` の出力をそのまま使う
   - あわせて **BASE ハッシュ** と **HEAD ハッシュ** をフル SHA で解決し、Step 9 の JSON 報告書出力まで保持する:
     - コミット比較モード: `git rev-parse <diff対象>` の結果を `base_commit`、`git rev-parse HEAD` の結果を `head_commit` として保持
     - staged / worktree モード: `git rev-parse HEAD` の結果を `base_commit` と `head_commit` の両方として保持
     - どちらも短縮せずフル 40 桁の SHA-1 を使う
3. 絞り込み指定がある場合、ステータス・ファイルパス・必要に応じて差分内容から該当性を判断し、ファイル一覧を絞り込む
4. レビュー対象ファイル一覧（絞り込み後）が空の場合はその旨をユーザーに通知し終了
5. **「ファイル × レビュー観点」の組み合わせごとに1つのサブエージェント呼び出し**を TaskList に1タスクとして登録する
  - タスク登録の前に、**ファイルごと**にレビュアー用モデルを決定する（差分全体の合計で判定してはならない）:
    - `git diff --numstat <diff対象> -- <レビュー対象ファイル（絞り込み後）...>`（staged モードでは `git diff --cached --numstat -- <...>`、worktree モードでは `git diff --numstat -- <...>`）を **1 回だけ** 実行し、各ファイルの (insertions + deletions) の合計行数を取得する
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
  - 対象ファイルの差分を取得し、**その差分のみ**を渡す:
    - コミット比較モード: `git diff <base_commit> <head_commit> -- <filepath>`（作業ツリーではなくコミット間の差分を使う。reviewview が表示する差分と行番号を一致させるため）
    - staged モード: `git diff --cached -- <filepath>`
    - worktree モード: `git diff -- <filepath>`
    - staged モードのみ、reviewview が表示する差分（`git diff HEAD`）と行番号が一致しない可能性が残る（Step 11 で判定する）
  - **ファイル全体は渡さない**。差分だけでは判断できない場合に限り、サブエージェント側の判断で当該ファイルを Read することを許容する
  - サブエージェントへの指示に「各指摘には差分のハンク行番号に基づく `**位置**` 欄（new 側の行番号を優先）を必ず記載すること。行番号はハンクヘッダー `@@ -a,b +c,d @@` を起点に、new 側なら `+` 行と文脈行のみを数えて算出すること」を含める
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
     - レビュアー報告の `**提案**` から、フェンス外の平文を `proposals[].text`、フェンス内のコードを `proposals[].code` に分離する（一方しか無ければ他方は `null`）
     - `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する
   - 差分中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（reviewview の指摘本文に載り、対象リポジトリの `.reviewview/state.db` に永続化されるため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
10. 知見蓄積: **簡易モード（`--simple` 指定時）はこのステップを実行せずスキップする**。通常モードでは、正本 JSON の `findings` に `severity` が 3 以上の指摘が **1 件以上** ある場合のみ、`TaskCreate` で進捗管理用タスクとして登録せず、`Agent` ツールで `@knowledge-distiller` サブエージェントを `run_in_background: true` で直接起動し、正本 JSON の内容を `source` としてそのまま渡してバックグラウンドで教訓蓄積する。`severity` 2 以下のみ・0 件ならスキップする。結果は待たず、すぐに 11. に進む。
11. 保存した報告書を reviewview に投入する
   - `base` / `head` を diff モードに応じて決める（reviewview は `git diff <base> [<head>]` を表示する。pathspec は渡せないため差分全体が表示される）:
     - コミット比較モード / merge-base モード: `base` = `base_commit`、`head` = `head_commit`（Step 6 で各サブエージェントに渡した差分と完全に一致する）
     - worktree モード: `base` = `head_commit`、`head` は **渡さない**（`git diff HEAD` = ステージ + 未ステージ。worktree モードはステージが空なのでレビューした差分と一致する）
     - staged モード: `git diff --name-only`（未ステージの変更）を確認する
       - 出力が空 → ステージ内容と作業ツリーが一致するので worktree モードと同じ渡し方をする
       - 出力が空でない → reviewview には `git diff --cached` を再現する手段が無い。`base` = `head_commit` / `head` なしで投入したうえで、**「reviewview に表示される差分はステージ + 未ステージであり、レビュー対象（ステージのみ）と行番号がずれる場合がある」旨を `request_triage` の `message` と Step 13 の報告に必ず明記する**（ずれた指摘は Step 12 の orphan として現れる）
   - `findings` の組み立て（body / severity / category / anchor / 投入しない指摘 / autoCloseReason）は `cbo/skills/document-saver/references/format-review-result-json.md` の「reviewview への投入」に従う
   - `autoCloseReason` は必ず渡す
   - `mcp__reviewview__start_review` が**実行時エラー**を返した場合（差分が空・ref を解決できない・`file` パスが不正）は、レビュー結果は既に保存済みなのでエラー内容をそのまま報告し、保存先パスを提示して終了する（Step 12 はスキップ）
12. 投入結果を確認し、人間にトリアージを依頼する
   - `mcp__reviewview__get_triage({ reviewId })` を **1 回だけ** 呼び、各 finding の `body` 先頭の `R\d{3}` を使って `R000` → reviewview の finding id の対応表を作る（`start_review` は finding id を返さないため）
     - 応答に「未還元の learnings が N 件あります」が付いていても、このスキルでは何もしない
     - ここでポーリングはしない。判定の取り込みは review:fix の責務
   - `start_review` の `orphanedFindingIds` を対応表で R-ID に変換する。空でない場合、それらの指摘は差分の行に紐付いておらず、reviewview 上では差分の文脈もディープリンクも無しで受信箱にだけ表示される
     - `side` の取り違え・base/head の取り違え・staged モードの行ズレが典型。行番号を検算し、明らかな誤りがあれば正本 JSON を直したうえで Step 11 からやり直す（再投入は新しいレビューになるので、先に検算を済ませる）
     - 誤りが無ければそのまま続行し、R-ID を Step 13 の報告に列挙する
   - sidecar `<保存した JSON のパス（.json を除く）>.reviewview-session.json` を Write ツールで保存する（内容は format-review-result-json.md の「sidecar ファイル（reviewview セッション情報）」に従う）
   - `mcp__reviewview__request_triage({ reviewId, message })` を呼ぶ。`message` には severity ごとの件数内訳、特に見てほしい点、reviewview に載せられなかった指摘（`file: null`）の要約、staged モードの行ズレ注意を書く
   - 返った `url` をユーザーに提示する。**`get_triage` をポーリングしてはならない**
13. 以下をユーザーに伝えて終了する: 正本 JSON の保存先パス、reviewview の URL、reviewview に載せられなかった指摘（`file: null`）の本文、差分行に紐付かなかった指摘（orphan）の R-ID 一覧、staged モードで行番号がずれる可能性がある場合はその旨、教訓蓄積をバックグラウンドで起動した旨（スキップ時はその旨）、**reviewview で判定を送信したあと review:fix を実行すれば判定を取り込んで修正できること**
