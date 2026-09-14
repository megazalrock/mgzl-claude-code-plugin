# review:diff のレビュー報告を reviewview 正本へ移す設計

## 背景

`review:diff` には、対象ファイルが多いとメインセッションのコンテキストを埋め尽くすという問題があります。

実測値は次のとおりです。

- 最大の報告書は指摘91件・183KB である（重複排除と偽陽性除外を済ませた後の数字）
- 保存先は `arrangement-env/front` の `.mgzl/reviews/` である

原因は増幅構造にあります。

- レビュアーが報告書の全文を最終メッセージで返し、それがメインへ流入する
- メインがその全文を報告書として組み立て直すため、同じ内容が入力と出力で2回乗る
- メインが `git diff` の出力を受け取り、観点ごとのプロンプトへ転記する

ただし根本の原因は別にあります。レビュー報告書が2つの役割を単一のファイルで兼ねていることです。

- 片方は「指摘」である。レビュアーが書き、レビューが終われば確定して変わらない
- もう片方は「評価・対応」である。人間がトリアージで書き、何度も変わる

作業台を兼ねている以上、全指摘が一ヵ所にそろっている必要があります。だから分割できません。

## 決定事項

指摘の正本は reviewview とします。md 報告書は reviewview から生成する派生物とします。

この結果、reviewview はトリアージの道具からレビューのハブになります。レビューの作成・指摘の蓄積・統合・トリアージ・修正の記録・知見の還元まで、ライフサイクル全体を司ります。

cbo 側に残るのはレビューを生産する工程だけです。レビューを保持して提示する工程は reviewview へ移します。

## 責務の切り分け

reviewview が持つものは次のとおりです。

- 指摘の正本
- 評価・対応
- 指摘間の関係
- 修正の記録
- md 報告書の生成

cbo が持つものは次のとおりです。

- どこを diff として切るか
- どうバッチ化するか
- どの観点のレビュアーをどのモデルで回すか
- 生の指摘をどう統合してから投入するか

## 全体のフロー

`review:diff` の手順は次のようになります。

1. diff モードを決め、対象ファイルを洗い出す。バッチ化して観点とモデルを割り当てる（現行維持）
2. `start_review` を findings なしで呼び、レビューを作る。diff はこの時点で凍結される
3. バッチごとの diff を、リダイレクトでファイルへ書き出す
4. バッチ統合エージェントをバッチ数だけ並列に起動する
5. `--cross` を指定したときのみ、横断統合エージェントを1件だけ起動する
6. `export_review` で md 報告書を生成させる
7. `request_triage` で人間へ回す

diff 本文・指摘本文・報告書本文は、いずれもメインセッションを通りません。

## バッチ統合エージェント

新規に `cbo/agents/review-consolidator.md` を作ります。バッチごとに1インスタンスが起動されます。

処理の流れは次のとおりです。

1. 指定された観点のレビュアーを、指定されたモデルで並列にネスト起動する。渡すのは diff ファイルの絶対パスである
2. 返ってきた指摘をファイル別に振り分ける。バッチは複数ファイルを含むためである
3. ファイルごとに統合する
4. `add_findings` で投入する
5. 戻り値はファイル別・重要度別の件数のみとする

起動の単位はバッチ、統合と投入の単位はファイルです。ここがずれていない点が重要です。

ファイルごとの統合でやることは次のとおりです。

- 同根の指摘をマージする。重要度は最大を採り、提案は複数を並記する
- 前提が矛盾する指摘を再検証する。Read で事実を確定させ、偽陽性は除外する
- 「対応不要」に帰着する指摘を除外する
- 秘密情報を転記しない

`relations` は同一ファイル内に限って宣言します。reviewview は前方参照をエラーとするためです。

レビュアーをネスト起動する方式には、cbo に前例があります。`implementation-plan-creator.md:64` が `code-investigator` を起動しています。起動してよいエージェントをホワイトリストで縛る書き方も、同ファイルの66行目にあります。

この方式により、`reviewer-for-*.md` の5ファイルは無変更で済みます。これらは `fix:comments` や `impl:execute` など5つのスキルからも呼ばれているため、変更すると壊れます。

## 横断統合エージェント

新規に `cbo/agents/review-cross-consolidator.md` を作ります。`--cross` を指定したときのみ、1件だけ起動されます。

処理の流れは次のとおりです。

1. `list_findings` でインデックスを読む。本文を含まないため、91件でも数KBに収まる
2. ファイルをまたぐ同根の候補を絞る
3. 判断に迷う数件だけ `get_finding` で本文を読む
4. `update_finding` で従側に `relations` を送る。または `delete_finding` で落とす
5. 戻り値は処理件数のみとする

デフォルトでは実行しません。重複は同一ファイル内で起きるのが主であり、バッチ統合が投入前に片付けるためです。ファイルをまたぐ同根はまれですので、毎回エージェントを余分に走らせるほどではありません。

## 変換規則

レビュアーの出力を `FindingInput` へ変換するのは、バッチ統合エージェントです。レビュアー定義は変更しません。

重要度の対応は次のとおりです。

- `[3]` ブロッキングは `error` とする
- `[2]` 推奨は `warn` とする
- `[1]` 軽微は `info` とする

`category` にはレビューの観点名を入れます。`logic` / `design` / `security-performance` / `test-code` の4種です。

`anchor` の4項目（`file` / `side` / `startLine` / `endLine`）は、レビュアーの位置欄から変換します。reviewview は行番号を diff から取ることを要求し、推測を禁じています。統合エージェントは diff ファイルを Read できるため、検証が可能です。

## reviewview 側の依存

この設計は reviewview の3つの issue に依存します。

- issue #68。`start_review` の findings を0件可にする。`add_findings` / `list_findings` / `get_finding` / `update_finding` / `delete_finding` を新設する。仕様は `2026-09-14-incremental-finding-api-design.md` にある
- issue #69。`export_review` を新設する。ファイルごとの詳細 md と `index.md` を出力し、戻り値はパスと件数のみとする
- issue #70。Finding に報告者情報（`reporter`: `agent` / `model` / `effort`、任意項目）を足す
- issue #71。`reviewview-collect` の役割を整理する。修正と検証の段階を別の実行役へ委譲できると明記する

着手の順序は #68 が先です。#69・#70・#71 はその後になります。

MCP ツールの許可リストは工程ごとに分けます。

- メインセッションは `start_review` / `export_review` / `request_triage` を呼ぶ
- バッチ統合エージェントは `add_findings` のみを持つ
- 横断統合エージェントは `list_findings` / `get_finding` / `update_finding` / `delete_finding` を持つ
- `review:fix` の修正役は `report_fix` を持つ

投入側が既存の指摘を消す事故を、構造的に防ぐためです。

## ファイル構成の変更

新規に作るものは次の2件です。

- `cbo/agents/review-consolidator.md`
- `cbo/agents/review-cross-consolidator.md`

変更するものは次の2件です。

- `cbo/skills/review__diff/SKILL.md`。報告書の組み立てが消え、reviewview を駆動する手続きになる
- `cbo/skills/review__fix/SKILL.md`。対象の選定をやめ、指定された finding id を修正する入口になる。修正1件ごとに `report_fix` を呼ぶ

削除するものは次の1件です。

- `cbo/skills/document-saver/references/format-review-result.md`。md の書式は issue #69 で reviewview 側が持つ。`document-saver/SKILL.md:36` の索引行も合わせて消す

## 影響範囲

変更しないものは次のとおりです。

- `cbo/agents/reviewer-for-*.md` の5ファイル
- `impl:execute` / `impl:execute-codex` / `impl:create` / `fix:comments` の4スキル

`review:fix` は修正後の再レビューのループを従来どおり持ちます。ただしそれは実装時のレビューですので、reviewview には投入しません。`impl:execute` と同じ扱いです。

reviewview に投入されるのは `review:diff` のレビューだけです。これが境界です。

`reviewview-collect` の改修は reviewview 側の issue #71 として起票されました。取り込みと提示の段階は維持し、修正と検証の段階は別の実行役へ委譲できると明記されます。

委譲した場合も `report_fix` は修正した側が呼ぶ契約です。結果を知っているのは修正した側であるためです。したがって `review:fix` は修正1件ごとに `report_fix` を呼びます。

## やらないこと

- レビュアーの出力形式の変更。他スキルが依存しているため触らない
- `R000` 形式の通し番号の維持。reviewview の id（`f-xxxxxxxx`）へそろえて廃止する
- 中間ファイルの削除処理。diff ファイルは `$TMPDIR` 配下に置き、OS の掃除に任せる

## 未確定事項

- `export_review` の引数と戻り値の詳細。issue #69 の spec 起草時に相談する
- `reporter` の表示と取得 API への載せ方。issue #70 の spec 起草時に相談する
