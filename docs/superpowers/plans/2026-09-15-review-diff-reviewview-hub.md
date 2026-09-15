# review:diff の reviewview ハブ移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `review:diff` のレビュー報告をメインセッションのコンテキストから切り離し、指摘の正本を reviewview へ移します。

**Architecture:** メインセッションはバッチ構成の決定とエージェントの起動だけを担います。レビュアーはバッチ統合エージェントの配下でネスト起動され、指摘の全文はそこにとどまります。統合済みの指摘は `add_findings` で reviewview へ直接投入され、メインへは件数だけが返ります。

**Tech Stack:** Claude Code のスキルとエージェント定義（Markdown）。reviewview の MCP ツール。スクリプトは新設しません。

**Spec:** `docs/superpowers/specs/2026-09-15-review-diff-reviewview-hub-design.md`

## Global Constraints

- `cbo/agents/reviewer-for-*.md` の5ファイルは変更しない。ほかの5スキルが依存しているためである
- 呼び出し元のうち `impl:execute` / `impl:execute-codex` / `impl:create` / `fix:comments` の4スキルは変更しない
- エージェント定義の本文は英語で書く。ユーザーへ見える出力だけ日本語にする
- `SKILL.md` は500行以内に収める
- コミットは Conventional Commits 形式とする。Scope は付けない
- `.md` への Write と Edit では ja-lint のフックが走る。日本語の違反があれば書き込みが差し戻される
- MCP ツールの許可リストは4層に分ける
  - メインセッションは `start_review` / `export_review` / `request_triage` を持つ
  - バッチ統合エージェントは `add_findings` を持つ
  - 横断統合エージェントは `list_findings` / `get_finding` / `update_finding` / `delete_finding` を持つ
  - `review:fix` は `report_fix` を持つ
- 自動テストは存在しない。検証は ja-lint の通過と実機実行による

## 前提と保留事項

reviewview の issue #68 は main へマージ済みです（`fe8c509`）。`add_findings` / `list_findings` / `get_finding` / `update_finding` / `delete_finding` が使えます。

issue #69（`export_review`）は未着手です。したがって Task 7 は #69 の完了まで着手できません。

**Task 3 から Task 7 までの間、md 報告書は生成されません。** レビュー結果は reviewview の画面でのみ閲覧できます。これは意図した一時的な状態です。

実装を始める前に、常駐している MCP プロセスを再起動してください。#68 でツールの定義と description が変わっています。

---

### Task 1: バッチ統合エージェントの新設

**Files:**
- Create: `cbo/agents/review-consolidator.md`

**Interfaces:**
- Consumes: なし
- Produces: エージェント名 `review-consolidator`。呼び出し側は7項目を渡す。バッチ番号、diff ファイルの絶対パス、対象ファイルパス一覧、起動するレビュアー名の一覧、レビュアーに使わせるモデル名、reviewId、BASE と HEAD のフル SHA である。戻り値はファイル別かつ重要度別の件数のみとする

- [ ] **Step 1: frontmatter を書く**

`tools:` は YAML のブロックシーケンスで書きます。インデントは半角スペース2個、`- ` の後に1スペースです。並び順は組込みのツールをアルファベット順に並べ、その後に `mcp__` 始まりを置きます。

```markdown
---
name: review-consolidator
description: 1つのバッチについてレビュアーをネスト起動し、返ってきた指摘をファイル別に統合して reviewview へ投入するエージェント。review:diff から呼び出される。
tools:
  - Agent
  - Glob
  - Grep
  - Read
  - mcp__plugin_reviewview_reviewview__add_findings
color: green
model: opus
effort: high
---
```

`Write` は持たせません。中間ファイルを書かず、投入は MCP ツールだけで行うためです。`Edit` も持たせません。このエージェントはコードを変更しないためです。

- [ ] **Step 2: 入力の受け取りを書く**

本文の冒頭に、呼び出し側から受け取る7項目を列挙します。いずれかが欠けている場合は推測せず停止する、と明記します。

- [ ] **Step 3: レビュアーのネスト起動を書く**

指定されたレビュアーを `Agent` ツールで並列に起動する手順を書きます。各レビュアーへは diff ファイルの絶対パスを渡し、`Read` で読ませます。レビュアーは `Bash` を持たないため、自力では差分を取得できません。

ホワイトリストの制限を明記します。既存の `cbo/agents/implementation-plan-reviewer.md:130` の書き方を踏襲します。

```
Agent ツールで起動してよいのは呼び出し側から指定されたレビュアーのみ。それ以外のサブエージェントを起動してはならない。
```

`cbo/skills/review__diff/SKILL.md:82-83` にある指示を、レビュアーへのプロンプトへ移植します。移植する内容は次の2点です。

- 渡された差分が複数ファイルを含むこと
- 各指摘へハンク行番号から算出した位置欄を必ず記載すること

- [ ] **Step 4: ファイル別の統合規則を書く**

`cbo/skills/review__diff/SKILL.md:99-112` の統合規則を移植します。R-ID への言及は reviewview の識別子へ読み替えます。移植する規則は次のとおりです。

- 同根の指摘を1件に統合する。重要度は最も高いものを採る
- 問題と理由は最も充実した報告を土台にし、ほかのレビュアーにしかない情報を落とさない
- 提案は実質同じなら1件にまとめ、方向性が異なるなら複数を並記する
- 統合文はレビュアー報告の組み合わせと言い換えだけで構成する。誰も主張していない内容を発明してはならない
- 前提が矛盾する指摘は、統合者自身が Read で事実を確定させる。偽陽性は投入しない
- 「対応不要」に帰着する指摘は投入しない
- 差分中の秘密情報を投入しない

統合の単位はファイルであると明記します。バッチは複数ファイルを含むため、まずファイル別に振り分けてから統合します。

- [ ] **Step 5: FindingInput への変換規則を書く**

重要度の対応を書きます。`[3]` ブロッキングは `error`、`[2]` 推奨は `warn`、`[1]` 軽微は `info` です。

`category` にはレビューの観点名を入れます。値は `logic` / `design` / `security-performance` / `test-code` の4種です。

anchor の4項目を書きます。`file` はリポジトリルート相対パスです。`side` は基本 `new` で、削除行への指摘のみ `old` です。`startLine` と `endLine` は diff の行番号から取り、推測しません。diff ファイルを Read して検証できると明記します。

`relations` は同一ファイル内に限って宣言します。reviewview は前方参照をエラーとするためです。

- [ ] **Step 6: 投入と戻り値を書く**

`add_findings` に reviewId と findings の配列を渡します。ファイル単位でまとめて投入します。

戻り値の制約を明記します。この項目が本改修の核心です。

```
最終メッセージでは、ファイル別かつ重要度別の件数だけを返す。
指摘の本文・コード例・diff の抜粋を返してはならない。
```

- [ ] **Step 7: ja-lint の通過を確認する**

ファイルを Write した時点で PostToolUse のフックが走ります。書き込みが成功すれば ja-lint は通過しています。差し戻された場合は指摘に従って修正します。

本文は英語ですので、日本語の部分は description と出力指示だけです。ただし英文であっても textlint の prh 辞書に引っかかることがあります。差し戻されたら文言を調整してください。

- [ ] **Step 8: frontmatter を目視で確認する**

Run: `grep -n mcp__plugin_reviewview cbo/agents/review-consolidator.md`

Expected: `add_findings` の1行だけがヒットすること。

- [ ] **Step 9: コミット**

```bash
git add cbo/agents/review-consolidator.md
git commit -m "feat: バッチ単位でレビューを統合しreviewviewへ投入する\`review-consolidator\`を追加"
```

---

### Task 2: 横断統合エージェントの新設

**Files:**
- Create: `cbo/agents/review-cross-consolidator.md`

**Interfaces:**
- Consumes: Task 1 が投入した指摘。reviewview 上に存在する
- Produces: エージェント名 `review-cross-consolidator`。呼び出し側は reviewId のみを渡す。戻り値は処理件数のみとする

- [ ] **Step 1: frontmatter を書く**

```markdown
---
name: review-cross-consolidator
description: reviewview に投入済みの指摘を一覧で読み、ファイルをまたぐ同根の指摘を統合するエージェント。review:diff から --cross 指定時のみ呼び出される。
tools:
  - Glob
  - Grep
  - Read
  - mcp__plugin_reviewview_reviewview__delete_finding
  - mcp__plugin_reviewview_reviewview__get_finding
  - mcp__plugin_reviewview_reviewview__list_findings
  - mcp__plugin_reviewview_reviewview__update_finding
color: green
model: opus
effort: high
---
```

`Agent` は持たせません。このエージェントはレビュアーを起動しないためです。`add_findings` も持たせません。新規の指摘を作らないためです。

- [ ] **Step 2: 処理の流れを書く**

4段階で書きます。

1. `list_findings` でインデックスを読む。本文を含まないため軽量である
2. ファイルをまたぐ同根の候補を絞る。判断材料は summary・anchor・category である
3. 判断に迷う候補だけ `get_finding` で本文を読む
4. `update_finding` で従側に relations を送る。または `delete_finding` で落とす

- [ ] **Step 3: 本文を読む範囲の制約を書く**

ここが本改修の核心ですので、明示的に書きます。

```
list_findings の結果だけでは同根と断定できない候補に限り、get_finding で本文を読む。
迷わない候補について get_finding を呼んではならない。
全件の本文を読むことは、このエージェントの存在意義を無効にする。
```

`get_finding` は本文を生テキストで返し、`[[ref]]` の解決をかけません。そのまま読んでかまいません。

- [ ] **Step 4: relations の型の使い分けを書く**

- `duplicate_of` は同根の重複である。target が代表となる
- `superseded_by` は target を直せばこの指摘が不要になる関係である
- `depends_on` は target の修正で前提が変わる関係である

方向は「この指摘が従、target が主」です。

- [ ] **Step 5: エラーの扱いを書く**

人間の判定が付いた指摘への `update_finding` と `delete_finding` は isError で返ります。409 相当です。この工程は `request_triage` より前に走るため通常は起きませんが、起きた場合は当該指摘を飛ばして続行し、最後に報告します。

- [ ] **Step 6: 戻り値を書く**

```
最終メッセージでは、宣言した relations の件数と削除した件数だけを返す。
指摘の本文を返してはならない。
```

- [ ] **Step 7: ja-lint の通過を確認する**

Write が成功すれば通過しています。差し戻された場合は指摘に従って修正します。

- [ ] **Step 8: コミット**

```bash
git add cbo/agents/review-cross-consolidator.md
git commit -m "feat: ファイルをまたぐ同根の指摘を統合する\`review-cross-consolidator\`を追加"
```

---

### Task 3: review:diff の改修

**Files:**
- Modify: `cbo/skills/review__diff/SKILL.md`

**Interfaces:**
- Consumes: Task 1 の `review-consolidator`。Task 2 の `review-cross-consolidator`
- Produces: `review:diff` の実行後、reviewview にレビューが1件作られ、指摘が投入された状態になる。ユーザーへはレビューの URL と件数が伝わる

- [ ] **Step 1: 引数に --cross を追加する**

17行目の `--simple` の記述の後に、`--cross` の説明を1行足します。frontmatter の `argument-hint`（4行目）にも `[--cross]` を追加します。

`--cross` はファイルをまたぐ同根の統合を有効にするフラグです。デフォルトでは実行しません。

- [ ] **Step 2: Step 1 から Step 5 を維持する**

25行目から75行目までは変更しません。diff モードの決定、対象ファイルの取得、絞り込み、バッチ化、観点割り当て、モデル決定はそのままです。

ただし36行目の「Step 9 の md 報告書出力まで保持する」という記述は、参照先が変わるため文言を調整します。

- [ ] **Step 3: タスク数の見積もり式を更新する**

72行目を書き換えます。

変更前の行です。

```
    - 見積もりタスク数 = 非テストバッチ数 × 観点数 + テストバッチ数
```

変更後の行です。

```
    - 見積もりタスク数 = 非テストバッチ数 × 観点数 + テストバッチ数 + 総バッチ数
```

末尾には統合エージェントの件数を加算しています。レビュアーはネスト起動されてメインから直接見えなくなりますが、コスト警告を失わないよう見積もりには含め続けます。この理由を1行で添えます。

- [ ] **Step 4: 旧 Step 6 から Step 9 を差し替える**

76行目から114行目までを削除し、新しい手順に置き換えます。新しい手順は次の4項です。

6. reviewview にレビューを作る。`start_review` を findings なしで呼び、reviewId を受け取る。diff はこの時点で凍結される
7. バッチごとの diff をファイルへ書き出す。`$TMPDIR/review-diff-<timestamp>/diff-<NN>.diff` へリダイレクトする。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得する
8. `@review-consolidator` をバッチ数だけ並列に起動する。各インスタンスへ Task 1 の Interfaces に列挙した7項目を渡す
9. `--cross` が指定されている場合のみ、`@review-cross-consolidator` を1件だけ起動する。reviewId を渡す

差分取得のコマンドは78行目から80行目のものをそのまま使い、末尾にリダイレクトを足します。コミット比較モードの例です。

```
git diff <base_commit> <head_commit> -- <filepath1> <filepath2> ... > "$TMPDIR/review-diff-<timestamp>/diff-<NN>.diff"
```

リダイレクトする理由を明記します。標準出力で受けると差分の本文がメインのコンテキストへ乗るためです。

バッチ番号は全バッチを通して 01 から振ります。非テストバッチ群、テストバッチ群の順です。番号が衝突するとファイルが上書きされて静かに壊れるためです。

- [ ] **Step 5: ユーザーへの通知を書き換える**

115行目を書き換えます。伝える内容は次のとおりです。

- `request_triage` が返したレビューの URL
- 重要度ごとの投入件数の内訳。各統合エージェントが返した件数を合算する
- トリアージを終えたら `reviewview-collect` で取り込めること

`review:fix` への言及は削除します。修正への入口が `reviewview-collect` へ変わるためです。

`request_triage` の呼び出しを、通知の前に追加します。

- [ ] **Step 6: コンテキストの制約を明記する**

ファイル末尾に新しい節を足します。

```markdown
## メインセッションのコンテキストに関する制約

このスキルのフローは、差分本文・指摘本文・報告書本文のいずれもメインセッションのコンテキストを通さない前提で設計されている。次を守ること。

- 差分ファイル（`diff-<NN>.diff`）をメインセッションで Read してはならない
- 差分を取得するコマンドは必ずファイルへリダイレクトする。標準出力で受け取ってはならない
- ユーザーへの通知は、統合エージェントが返した件数と `request_triage` の戻り値だけで組み立てる
```

- [ ] **Step 7: 行数を確認する**

Run: `wc -l cbo/skills/review__diff/SKILL.md`

Expected: 500行以下であること。

- [ ] **Step 8: 旧テンプレートへの参照が消えたことを確認する**

Run: `grep -n format-review-result cbo/skills/review__diff/SKILL.md`

Expected: ヒットが0件であること。

- [ ] **Step 9: コミット**

```bash
git add cbo/skills/review__diff/SKILL.md
git commit -m "feat: \`review:diff\`のレビュー結果をreviewviewへ投入する方式に変更"
```

---

### Task 4: 実機での通し確認

**Files:**
- 変更なし。確認のみである

**Interfaces:**
- Consumes: Task 1 から Task 3 の成果物
- Produces: なし。確認結果を報告する

このタスクは人間が実行します。自動テストが存在しないため、実機で動かす以外に検証手段がありません。

- [ ] **Step 1: 小さな差分を用意する**

対象リポジトリは `/Users/otto/workspace/craftbank/arrangement-env/front` を想定します。`.mgzl` の設定がすでにあるためです。

2ファイルから3ファイル程度、合計100行未満の差分を用意します。バッチが1個か2個で収まる規模とします。

- [ ] **Step 2: review:diff を実行する**

Run: `/cbo:review:diff <対象>`

- [ ] **Step 3: reviewview 側を確認する**

確認する項目は次のとおりです。

- レビューが1件作られていること
- 指摘が投入されていること
- 各指摘の anchor がソースの正しい行を指していること
- `category` が観点名になっていること
- 重要度が error / warn / info に振られていること

- [ ] **Step 4: メインセッションのコンテキストを確認する**

最も重要な確認です。次を目視します。

- 差分の本文がメインの会話に現れていないこと
- 指摘の本文がメインの会話に現れていないこと
- 統合エージェントの戻り値が件数だけであること

現れていた場合は、どのステップで漏れたかを特定して該当ファイルを修正します。

- [ ] **Step 5: --cross を付けて再実行する**

Run: `/cbo:review:diff <対象> --cross`

横断統合エージェントが起動し、`list_findings` を呼んでいることを確認します。`get_finding` が全件に対して呼ばれていないことも確認します。

- [ ] **Step 6: 結果を報告する**

確認できたことと、できなかったことを分けて報告します。

---

### Task 5: review:fix の改修

**Files:**
- Modify: `cbo/skills/review__fix/SKILL.md`

**Interfaces:**
- Consumes: reviewview の finding id（`f-xxxxxxxx` 形式）
- Produces: 指定された指摘を修正し、1件ごとに `report_fix` を呼んだ状態

- [ ] **Step 1: frontmatter を書き換える**

現行の2行目から4行目を書き換えます。

変更前の description です。

```
description: レビュー報告書の指摘を並列修正。対象は ID（R000 形式）または自然言語（「3以上」「テストファイルのみ」等）で指定可能
```

変更後の内容です。

```
description: reviewview の finding id で指定された指摘を修正する。対象の選定は行わず、渡された id のみを修正して report_fix で報告する
argument-hint: [f-xxxxxxxx ...] [-y で確認をスキップ]
```

- [ ] **Step 2: 引数の解釈ルールを書き換える**

9行目から13行目を書き換えます。`R` + 数字のトークンは finding id へ変わります。`.md` で終わるトークンによる報告書パスの指定は削除します。

- [ ] **Step 3: 報告書への参照を削除する**

14行目の `format-review-result.md` への参照を削除します。

18行目から38行目の「レビュー報告書のファイルを特定する」と「修正対象の指摘 ID リストを特定する」を削除します。報告書を読んで指摘を切り出す処理は不要になります。

代わりに、呼び出し側から finding id を受け取る記述を置きます。id が渡されていない場合はユーザーに確認して停止します。対象の選定はこのスキルの責務ではありません。

- [ ] **Step 4: 指摘の内容の取得方法を書く**

`get_finding` で1件ずつ取得します。取得する内容は summary・rationale・suggestions・anchor です。

`triageReason` が付いている場合は、人間が書いた対応方針の指示として扱います。技術的に従えない場合は修正せず `report_fix` に `blocked` で報告します。

- [ ] **Step 5: report_fix の呼び出しを書く**

修正1件ごとに `report_fix` を呼びます。結果を知っているのは修正した側であるためです。

- [ ] **Step 6: 再レビューのループを維持する**

80行目から100行目のループはそのまま残します。修正後の自己検証として従来どおり機能させます。

ただし1点を明記します。このループで出た指摘は実装時のレビューですので、reviewview には投入しません。`impl:execute` と同じ扱いです。

- [ ] **Step 7: 注意事項を書き換える**

112行目から116行目を書き換えます。`評価：` と `対応：` 欄への言及を削除します。人間の判定は reviewview 側にあるためです。

- [ ] **Step 8: 旧テンプレートへの参照が消えたことを確認する**

Run: `grep -n format-review-result cbo/skills/review__fix/SKILL.md`

Expected: ヒットが0件であること。

- [ ] **Step 9: コミット**

```bash
git add cbo/skills/review__fix/SKILL.md
git commit -m "feat: \`review:fix\`をreviewviewのfinding id駆動に変更"
```

---

### Task 6: 旧テンプレートの削除

**Files:**
- Delete: `cbo/skills/document-saver/references/format-review-result.md`
- Modify: `cbo/skills/document-saver/SKILL.md:36`
- Modify: `cbo/skills/document-saver/SKILL.md:44`

**Interfaces:**
- Consumes: Task 3 と Task 5 が参照を削除済みであること
- Produces: なし

- [ ] **Step 1: 参照が残っていないことを確認する**

Run: `grep -rn format-review-result cbo`

Expected: `document-saver/SKILL.md:36` のみがヒットすること。

ほかにヒットがある場合は削除を中止し、その参照元を先に処理します。

- [ ] **Step 2: テンプレートを削除する**

```bash
rm cbo/skills/document-saver/references/format-review-result.md
```

- [ ] **Step 3: 索引の行を削除する**

`cbo/skills/document-saver/SKILL.md` の36行目を削除します。削除する行です。

```
| レビュー結果 | [format-review-result.md](references/format-review-result.md) |
```

- [ ] **Step 4: 注記を削除する**

同ファイルの44行目にある注記を削除します。review:diff が md 報告書を書かなくなるため、内容が事実と合わなくなります。削除する行です。

```
> **注**: review:diff が出力するレビュー結果は本スキルを経由せず、上表の「レビュー結果」テンプレートに従って Write ツールで直接 !`echo $MGZL_DIR`/reviews/ に保存する。
```

- [ ] **Step 5: 参照が消えたことを確認する**

Run: `grep -rn format-review-result cbo`

Expected: ヒットが0件であること。

- [ ] **Step 6: コミット**

```bash
git add -A cbo/skills/document-saver
git commit -m "chore: 使われなくなったレビュー報告書テンプレートを削除"
```

---

### Task 7: md エクスポートの組み込み

**このタスクは reviewview の issue #69 が完了するまで着手できません。**

**Files:**
- Modify: `cbo/skills/review__diff/SKILL.md`

**Interfaces:**
- Consumes: reviewview の `export_review`
- Produces: `review:diff` の実行後、md 報告書が生成された状態

- [ ] **Step 1: #69 の spec を確認する**

`export_review` の引数と戻り値を確認します。reviewview 側の spec と突き合わせます。

- [ ] **Step 2: 手順を追加する**

Task 3 の Step 4 で作った手順の9項の後に、`export_review` の呼び出しを追加します。`request_triage` より前に置きます。

出力先は `!`echo $MGZL_DIR`/reviews/` 配下とします。

- [ ] **Step 3: 通知に保存先を追加する**

ユーザーへの通知に、md 報告書の保存先パスを追加します。`export_review` の戻り値から取ります。報告書の中身は読みません。

- [ ] **Step 4: コンテキストの制約に追記する**

Task 3 の Step 6 で作った節に、次の2行を足します。

```
- 生成された md 報告書をメインセッションで Read してはならない
- 保存先パスは `export_review` の戻り値から取る
```

- [ ] **Step 5: 実機で確認する**

小さな差分で `review:diff` を実行し、md 報告書が生成されることを確認します。ファイルごとの分割と `index.md` の生成も確認します。

- [ ] **Step 6: コミット**

```bash
git add cbo/skills/review__diff/SKILL.md
git commit -m "feat: \`review:diff\`にreviewviewからのmdエクスポートを組み込み"
```
