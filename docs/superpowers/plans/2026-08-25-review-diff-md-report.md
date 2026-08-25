# review:diff の md 報告書化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `review:diff` のレビュー結果を reviewview へ直接投入せず、人間が読み書きできる md 報告書として `$MGZL_DIR/reviews/` に保存して完結させる。

**Architecture:** `review:diff` から reviewview 依存（前提チェック・投入・sidecar 生成）を全削除し、出力を正本 JSON から md 報告書へ切り替える。md テンプレートは既存の `format-review-result.md` を拡張して共用する。`review:fix` は既に md 報告書の経路を持つため無変更。

**Tech Stack:** Markdown のみ。Claude Code プラグインの Skill 定義ファイルとテンプレートファイルの編集。コード・テストの追加は無い。

**Spec:** `docs/superpowers/specs/2026-08-25-review-diff-md-report-design.md`

## Global Constraints

- 変更対象はすべて Markdown ドキュメント。実行可能なコードもテストコードも存在しないため、**TDD は適用しない**。各タスクの検証は `rg` による記述の存在確認と、変更後ファイルの通読で行う
- `cbo/skills/review__fix/SKILL.md` は**編集しない**。`cbo/agents/reviewer-for-*.md` も**編集しない**
- `cbo/skills/document-saver/references/format-review-result-json.md` の変換表本体（L62-134）は**編集しない**
- SKILL.md は 500 行以内を目標とする（`CLAUDE.md` の開発ルール）
- コミットメッセージは Conventional Commits 形式（`feat:` / `fix:` / `refactor:` / `chore:`）
- **コミットはユーザーから明示的な指示があった場合のみ実行する**。指示が無ければ変更をワーキングツリーに残して次のタスクへ進む
- `rg` の実行時はファイルパスを絶対パスで指定する（`CLAUDE.md` の Bash ルール）

---

### Task 1: md レビュー報告書テンプレートの改訂

**Files:**
- Modify: `cbo/skills/document-saver/references/format-review-result.md`（全 47 行を全面置換）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: Task 2 の `review:diff` Step 9 が参照するテンプレート。以下の構造を確定させる
  - frontmatter キー: `reporter` / `model` / `target` / `branch` / `diff_mode` / `base_commit` / `head_commit`
  - H1: `# レビュー結果`
  - H2: `## 良い点` / `## 改善提案` / `## 参考情報`
  - 指摘見出し: `### R000 [3] ブロッキング 評価： 対応：`
  - 指摘本文の欄: `**位置**` / `**問題**` / `**理由**` / `**報告者**` / `**提案**`

- [ ] **Step 1: 現行テンプレートを読んで現状を把握する**

Read: `/Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/document-saver/references/format-review-result.md`

現行 47 行。frontmatter・`# {ファイル名}レビュー結果`・`## 良い点`・`## 改善提案`・`### R000 [3] ブロッキング ... 評価：`・`## 参考情報`・末尾の評価フィールド解説コメントで構成されている。

- [ ] **Step 2: テンプレートを以下の内容で全面置換する**

Write で以下を書き込む（既存 47 行をすべて置き換える）:

````markdown
---
reporter: {レビュー実行主体（例: ClaudeCode review:diff / Codex / GitHub Copilot / @reviewer-for-logic）}
model: {使用モデル名（例: claude-sonnet-4-6）。不明なら省略せず unknown と記載}
# 以下は任意項目（スキルによっては必須指定あり。各スキルの SKILL.md を参照）
# target: feature/foo
# branch: feature/foo
# diff_mode: staged                 # commit / merge-base / staged / worktree のいずれか
# base_commit: <BASE のフル SHA>    # review:diff で diff 対象のハッシュ
# head_commit: <HEAD のフル SHA>    # レビュー実行時の HEAD ハッシュ
---

<!-- 各改善提案には R000 形式（R + 3桁ゼロパディング連番）の一意なIDを採番する。出現順に R000, R001, R002, ... と振る -->

# レビュー結果

## 良い点

## 改善提案

<!-- 指摘は本見出しの直下にフラットに並べる。ファイル別の中間見出しでグルーピングしない（`### R*` の階層が変わると指摘を切り出せなくなる）。ファイルの区別は各指摘の `**位置**` 欄が担う -->

### R000 [3] ブロッキング <!-- [任意] 該当がなければ省略可 --> 評価： 対応：
**位置**: {下記「位置欄の記法」を参照}
**問題**: {問題の説明}
**理由**: {なぜ問題なのか、どの原則に反するか}
**報告者**: @{担当サブエージェント名}
**提案**:
{自然言語での修正方針}
```typescript
// 改善後のコード例
```

### R001 [2] 推奨 <!-- [任意] --> 評価： 対応：
{同様の形式}

### R002 [1] 軽微 <!-- [任意] --> 評価： 対応：
{同様の形式}

## 参考情報 <!-- [任意] -->
- {関連するベストプラクティスやドキュメントへのリンク}

<!--
位置欄の記法:
- `{path}:{行番号} (new)`      : 追加・変更後の単一行への指摘
- `{path}:{start}-{end} (new)` : 追加・変更後の行範囲への指摘
- `{path}:{行番号} (old)`      : 削除行への指摘（削除行に限り old を使う）
- `{path}:ファイル全体`         : ファイル単位の指摘で行を特定できない場合
- `なし`                       : ファイルすら特定できない場合
- `{path}` はリポジトリルートからの相対パス。`./` 始まり・絶対パス・`..` は使わない。
- reviewview へ投入する場合、この欄が `file` / `side` / `startLine` / `endLine` に対応する。
  変換規則の詳細は format-review-result-json.md の「reviewview への投入」を参照。
-->

<!--
複数案を提示する場合は、案ごとに提案の行を分ける:
**提案（案A）**:
{方針}
**提案（案B）**:
{方針}
-->

<!--
評価フィールドについて:
- 各指摘の見出し行末尾に置いた `評価：` の右に、人間が以下のいずれかの値を追記する（値が空欄なら未評価を表す）。
  - `tp`  (true positive)  : 妥当な指摘。実際に問題があり、対応が必要または妥当。
  - `fp`  (false positive) : 誤検知。指摘が的外れで、対応不要。
  - `nit` (nitpick)        : 些細な指摘。好みや軽微な改善で、対応は任意。
  - `oos` (out of scope)   : スコープ外。今回の変更範囲では扱わない。
  - （空）                  : 未評価。まだ判断していない。
- 記入例: 見出し行末尾の `評価：` の直後に値を追記して `評価：tp` のようにする。
- `対応：` の右には、人間が「どう直してほしいか」の追加指示を書く（空欄可）。
- 評価は人間がレビュー報告書ファイルに直接書き込むことを唯一の入力経路とする。
-->
````

- [ ] **Step 3: 必須要素が揃っているか検証する**

Run:
```bash
rg -n '\*\*位置\*\*|対応：|diff_mode|# レビュー結果' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/document-saver/references/format-review-result.md
```

Expected: 以下がすべてヒットする
- `**位置**` — 指摘本文の欄と、位置欄の記法コメント
- `対応：` — 3 つの指摘見出し（R000 / R001 / R002）と評価フィールド解説
- `diff_mode` — frontmatter の任意項目
- `# レビュー結果` — H1（`# {ファイル名}レビュー結果` が残っていないこと）

- [ ] **Step 4: 旧記述が残っていないか検証する**

Run:
```bash
rg -n 'ファイル名\}レビュー結果' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/document-saver/references/format-review-result.md
```

Expected: マッチ 0 件（exit code 1）

- [ ] **Step 5: コミット（ユーザーから明示的な指示があった場合のみ）**

```bash
git add cbo/skills/document-saver/references/format-review-result.md
git commit -m "feat: レビュー報告書テンプレートに位置欄・対応欄・diff_mode を追加"
```

---

### Task 2: `review:diff` を md 報告書出力に変更

**Files:**
- Modify: `cbo/skills/review__diff/SKILL.md`（現行 111 行。Step 0 と Step 10-11 を削除、Step 9 と Step 12 を書き換え、3 箇所の文言調整）

**Interfaces:**
- Consumes: Task 1 が確定させた `format-review-result.md` の構造（frontmatter キー・H1・指摘見出し・`**位置**` 欄）
- Produces: `$MGZL_DIR/reviews/yyyyMMdd-hhmmss-<kebab>.md` を出力するスキル。Task 3 の `document-saver/SKILL.md` と `README.md` の記述がこの挙動を説明する

- [ ] **Step 1: 現行 SKILL.md を読んで全体構成を把握する**

Read: `/Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md`

現行は Step 0〜12 の 13 ステップ。この Task で Step 0 と Step 10-11 が消え、最終的に Step 1〜10 の 10 ステップになる。

- [ ] **Step 2: Step 0（前提チェック）を削除する**

Edit で以下の 5 行（L25-29）を削除する。`old_string` に指定する現行テキスト:

```
0. **前提チェック**: 利用可能なツールに `mcp__reviewview__start_review` が存在するか確認する
   - 存在しない場合は、**後続の処理を一切行わずに即座に停止**し、以下をユーザーに報告して終了する:
     - reviewview の MCP サーバーが接続されていないため、このスキルは実行できないこと
     - 確認手順: `cbo/.mcp.json` の `reviewview` エントリのパスが正しいか、reviewview の `packages/server/dist/main.js` がビルド済みか、Claude Code を再起動して MCP サーバーが接続されたか
   - reviewview を使わずにレビューだけ実行して報告書を残すフォールバックはしない（レビュアーを起動する前にここで落とす）
1. 引数を解析し、
```

`new_string`:

```
1. 引数を解析し、
```

これにより `## タスク` の直下が `1.` から始まる。

- [ ] **Step 3: Step 2 の SHA 保持の文言を修正する**

Edit で L40 を置換する。

`old_string`:
```
   - あわせて **BASE ハッシュ** と **HEAD ハッシュ** をフル SHA で解決し、Step 9 の JSON 報告書出力まで保持する:
```

`new_string`:
```
   - あわせて **BASE ハッシュ** と **HEAD ハッシュ** をフル SHA で解決し、Step 9 の md 報告書出力まで保持する:
```

- [ ] **Step 4: Step 6 の差分取得理由とstaged モード注記を修正する**

Edit で L68 を置換する。

`old_string`:
```
    - コミット比較モード: `git diff <base_commit> <head_commit> -- <filepath>`（作業ツリーではなくコミット間の差分を使う。reviewview が表示する差分と行番号を一致させるため）
```

`new_string`:
```
    - コミット比較モード: `git diff <base_commit> <head_commit> -- <filepath>`（作業ツリーではなくコミット間の差分を使う。md 報告書の `**位置**` 欄の行番号基準を統一するため）
```

続けて Edit で L71 を削除する。

`old_string`:
```
    - staged モード: `git diff --cached -- <filepath>`
    - worktree モード: `git diff -- <filepath>`
    - staged モードのみ、reviewview が表示する差分（`git diff HEAD`）と行番号が一致しない可能性が残る（Step 10 で判定する）
```

`new_string`:
```
    - staged モード: `git diff --cached -- <filepath>`
    - worktree モード: `git diff -- <filepath>`
```

- [ ] **Step 5: Step 9 を md 報告書の組み立て・保存に書き換える**

Edit で L77-89（Step 9 の全体）を置換する。

`old_string`（現行 Step 9 の全文）:
```
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
   - 統合の過程で、複数のレビュアーが同根の問題を別々に指摘していたり、一方の指摘が他方の帰結であることに気づいた場合は、`problem` / `reason` の本文で相手の R-ID を `[[R003]]` 記法で参照する（reviewview 上で指摘間のリンクになる。書式と注意点は `cbo/skills/document-saver/references/format-review-result-json.md` の「body」）。レビュアーは並列実行されて互いの指摘を知らないため、この相互参照を張れるのはこのステップだけ
   - 差分中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（reviewview の指摘本文に載り、対象リポジトリの `.reviewview/state.db` に永続化されるため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
```

`new_string`:
```
9. 全てのレビュー結果を統合し、md レビュー報告書を組み立てて保存する
   - テンプレートは `cbo/skills/document-saver/references/format-review-result.md` に従う。document-saver スキルは使わず Write ツールで直接保存する
   - frontmatter の `reporter` は固定で `ClaudeCode review:diff`。`model` は実行中の自身のモデル名（不明なら `unknown`）
   - frontmatter の `diff_mode` に Step 1 で決定した diff モード（`commit` / `merge-base` / `staged` / `worktree`）を記載する
   - frontmatter の `base_commit` / `head_commit` は Step 2 で解決したフル 40 桁 SHA-1（**必須**）
   - 各指摘を `## 改善提案` の直下にフラットな `### R*` 見出しとして並べる（ファイル別の中間見出しでグルーピングしない。`### R*` の階層が変わると review:fix が指摘を切り出せなくなる）:
     - R-ID は出現順に R000, R001, ...（R + 3桁ゼロパディング連番）
     - 見出しは `### R000 [3] ブロッキング 評価： 対応：` の形式。`評価：` と `対応：` は空欄で初期化する
     - `**位置**` にはレビュアー報告の `**位置**` 欄をそのまま転記する
     - `**問題**` / `**理由**` / `**提案**` はレビュアー報告をそのまま転記する（提案のフェンス内外を分離しない）
     - `**報告者**` に担当サブエージェント名を記載する
   - 統合の過程で、複数のレビュアーが同根の問題を別々に指摘していたり、一方の指摘が他方の帰結であることに気づいた場合は、`**問題**` / `**理由**` の本文で相手の R-ID を `R003` と平文で参照する。レビュアーは並列実行されて互いの指摘を知らないため、この相互参照を張れるのはこのステップだけ
   - 差分中の秘密情報（トークン・鍵など）を `**問題**` / `**理由**` / `**提案**` に転記しない（報告書ファイルに永続化されるため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.md`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
```

- [ ] **Step 6: Step 10・Step 11 を削除し、Step 12 を新 Step 10 に書き換える**

Edit で L90-110（Step 10 の冒頭から Step 12 の末尾まで）を置換する。

> `old_string` が 21 行と長いため完全一致に失敗する可能性がある。失敗した場合は 3 回に分けて実行する: ①`10. 保存した報告書を reviewview に投入する` から Step 10 の末尾までを削除 → ②`11. 投入結果を確認し、人間にトリアージを依頼する` から Step 11 の末尾までを削除 → ③`12.` の行を下記 `new_string` で置換。

`old_string`（現行 Step 10・11・12 の全文）:
```
10. 保存した報告書を reviewview に投入する
   - 投入対象の findings（`file: null` の指摘を除いた全指摘）が **0 件** の場合は reviewview へ投入しない（reviewview の `findings` は 1 件以上必須。0 件の投入はバリデーションエラーになる）。Step 11 をスキップし、Step 12 で正本 JSON の保存先パスと、指摘が無かった旨（`file: null` で載せられなかった指摘があればその本文）を報告して終了する
   - `base` / `head` を diff モードに応じて決める（reviewview は `git diff <base> [<head>]` を表示する。pathspec は渡せないため差分全体が表示される）:
     - コミット比較モード / merge-base モード: `base` = `base_commit`、`head` = `head_commit`（Step 6 で各サブエージェントに渡した差分と完全に一致する）
     - worktree モード: `base` = `head_commit`、`head` は **渡さない**（`git diff HEAD` = ステージ + 未ステージ。worktree モードはステージが空なのでレビューした差分と一致する）
     - staged モード: `git diff --name-only`（未ステージの変更）を確認する
       - 出力が空 → ステージ内容と作業ツリーが一致するので worktree モードと同じ渡し方をする
       - 出力が空でない → reviewview には `git diff --cached` を再現する手段が無い。`base` = `head_commit` / `head` なしで投入したうえで、**「reviewview に表示される差分はステージ + 未ステージであり、レビュー対象（ステージのみ）と行番号がずれる場合がある」旨を `request_triage` の `message` と Step 12 の報告に必ず明記する**（ずれた指摘は Step 11 の orphan として現れる）
   - `findings` の組み立て（body / severity / category / anchor / 投入しない指摘）は `cbo/skills/document-saver/references/format-review-result-json.md` の「reviewview への投入」に従う
   - `mcp__reviewview__start_review` が**実行時エラー**を返した場合（差分が空・ref を解決できない・`file` パスが不正）は、レビュー結果は既に保存済みなのでエラー内容をそのまま報告し、保存先パスを提示して終了する（Step 11 はスキップ）
11. 投入結果を確認し、人間にトリアージを依頼する
   - `mcp__reviewview__get_triage({ reviewId })` を **1 回だけ** 呼び、各 finding の `body` 先頭の `R\d{3}` を使って `R000` → reviewview の finding id の対応表を作る（`start_review` は finding id を返さないため）
     - 応答に「未還元の learnings が N 件あります」が付いていても、このスキルでは何もしない
     - ここでポーリングはしない。判定の取り込みは review:fix の責務
   - `start_review` の `orphanedFindingIds` を対応表で R-ID に変換する。空でない場合、それらの指摘は差分の行に紐付いておらず、reviewview 上では差分の文脈もディープリンクも無しで受信箱にだけ表示される
     - `side` の取り違え・base/head の取り違え・staged モードの行ズレが典型。行番号を検算し、明らかな誤りがあれば正本 JSON を直したうえで Step 10 からやり直す（再投入は新しいレビューになるので、先に検算を済ませる）
     - 誤りが無ければそのまま続行し、R-ID を Step 12 の報告に列挙する
   - sidecar `<保存した JSON のパス（.json を除く）>.reviewview-session.json` を Write ツールで保存する（内容は format-review-result-json.md の「sidecar ファイル（reviewview セッション情報）」に従う）
   - `mcp__reviewview__request_triage({ reviewId, message })` を呼ぶ。`message` には severity ごとの件数内訳、特に見てほしい点、reviewview に載せられなかった指摘（`file: null`）の要約、staged モードの行ズレ注意を書く
   - 返った `url` をユーザーに提示する。**`get_triage` をポーリングしてはならない**
12. 以下をユーザーに伝えて終了する: 正本 JSON の保存先パス、reviewview の URL、reviewview に載せられなかった指摘（`file: null`）の本文、差分行に紐付かなかった指摘（orphan）の R-ID 一覧、staged モードで行番号がずれる可能性がある場合はその旨、**reviewview で判定を送信したあと review:fix を実行すれば判定を取り込んで修正できること**
```

`new_string`:
```
10. 以下をユーザーに伝えて終了する: md 報告書の保存先パス、重要度（`[3]` / `[2]` / `[1]`）ごとの指摘件数の内訳、`**位置**: なし` の指摘があればその本文、**報告書の `評価：` 欄に記入してから review:fix を実行すると対象を絞って修正できること**
```

- [ ] **Step 7: reviewview への参照が完全に消えたか検証する**

Run:
```bash
rg -n 'reviewview|mcp__reviewview' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md
```

Expected: マッチ 0 件（exit code 1）

- [ ] **Step 8: JSON 報告書への参照が消えたか検証する**

Run:
```bash
rg -n '正本 JSON|format-review-result-json|findings\[\]|sidecar' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md
```

Expected: マッチ 0 件（exit code 1）

- [ ] **Step 9: ステップ番号が 1〜10 で連続しているか確認する**

Run:
```bash
rg -n '^[0-9]+\. ' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md
```

Expected: `1.` から `10.` までが 1 つずつ、この順で出力される（`0.` が無いこと、`11.` `12.` が無いこと）

- [ ] **Step 10: md 報告書への参照が入ったか検証する**

Run:
```bash
rg -n 'md 報告書|format-review-result\.md|diff_mode' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md
```

Expected: Step 2 の SHA 保持（`md 報告書出力まで保持`）、Step 9 のテンプレート参照・`diff_mode` 記載、Step 10 の報告内容がヒットする

- [ ] **Step 11: 変更後の SKILL.md を通読して整合性を確認する**

Read: `/Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md`

確認項目:
- Step 1〜8 の内容が変更前と同一であること（Step 2 の L40 と Step 6 の 2 箇所を除く）
- 削除したステップへの参照（「Step 10 で判定する」「Step 11 をスキップ」「Step 12 の報告」）が本文に残っていないこと
- 行数が 500 行以内であること（削除のみなので大幅に下回る）

- [ ] **Step 12: コミット（ユーザーから明示的な指示があった場合のみ）**

```bash
git add cbo/skills/review__diff/SKILL.md
git commit -m "feat: review:diff のレビュー結果を md 報告書として保存し reviewview 投入を廃止"
```

---

### Task 3: 周辺ドキュメントの記述を実態に合わせる

**Files:**
- Modify: `cbo/skills/document-saver/references/format-review-result-json.md`（L3・L9・L54・L58 の 4 箇所）
- Modify: `cbo/skills/document-saver/SKILL.md`（L44 の注記 1 箇所）
- Modify: `cbo/README.md`（L31 と L66-74 の 2 箇所）

**Interfaces:**
- Consumes: Task 1 の `format-review-result.md`（参照先として言及する）、Task 2 の `review:diff` の新しい挙動（説明対象）
- Produces: なし（最終タスク）

- [ ] **Step 1: `format-review-result-json.md` の冒頭 2 行を修正する**

Edit で L3-L4 を置換する。

`old_string`:
```
review:diff が出力するレビュー報告書の正本フォーマット（削除済みの旧 review:file が出力した報告書も同形式）。
document-saver スキルは経由せず、各スキルが Write ツールで !`echo $MGZL_DIR`/reviews/ に直接保存する。
```

`new_string`:
```
過去に review:diff が出力した JSON 報告書のフォーマット（削除済みの旧 review:file が出力した報告書も同形式）。
現在の review:diff は md 報告書（[format-review-result.md](format-review-result.md)）を出力するため、本スキーマの報告書が新規に作られることはない。review:fix が過去の報告書を扱うために残している。
```

- [ ] **Step 2: `format-review-result-json.md` の L9 を修正する**

Edit で置換する。

`old_string`:
```
人間に指摘を提示する UI は **reviewview**。review:diff が MCP ツール経由でトリアージを往復し、review:fix がその判定を回収する。
```

`new_string`:
```
人間に指摘を提示する UI は **reviewview**。sidecar 付きの JSON 報告書を review:fix が扱うとき、MCP ツール経由でトリアージ判定を回収する。
```

- [ ] **Step 3: `format-review-result-json.md` の H1（L54）を修正する**

Edit で置換する。

`old_string`:
```
# reviewview 経路（review:diff）
```

`new_string`:
```
# reviewview 経路（review:fix / 手動投入）
```

- [ ] **Step 4: `format-review-result-json.md` の L58 を修正する**

Edit で置換する。

`old_string`:
```
正本 JSON を保存したあと、`mcp__reviewview__start_review` の `findings[]` に変換して投入する。
```

`new_string`:
```
JSON 報告書を reviewview に投入する場合、`mcp__reviewview__start_review` の `findings[]` に変換して投入する。
```

- [ ] **Step 5: `format-review-result-json.md` の変換表本体が無傷か検証する**

Run:
```bash
rg -n '^### (severity|category|ref|anchor|body)' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/document-saver/references/format-review-result-json.md
```

Expected: `### severity` / `### category` / `### ref` / `### anchor → file / side / startLine / endLine` / `### body` の 5 つがすべてヒットする（変換表本体を誤って壊していないことの確認）

- [ ] **Step 6: `document-saver/SKILL.md` の注記を書き換える**

Edit で L44 を置換する。

`old_string`:
```
> **注**: review:diff が出力するレビュー結果は本スキルを経由せず、正本 JSON（[format-review-result-json.md](references/format-review-result-json.md)）として各スキルが直接保存する。本スキルの「レビュー結果」テンプレート（md）は review:plan 用に残っている。
```

`new_string`:
```
> **注**: review:diff が出力するレビュー結果は本スキルを経由せず、上表の「レビュー結果」テンプレートに従って Write ツールで直接 !`echo $MGZL_DIR`/reviews/ に保存する。過去に review:diff が出力した JSON 報告書のフォーマットは [format-review-result-json.md](references/format-review-result-json.md) を参照。
```

- [ ] **Step 7: `README.md` のディレクトリ説明を修正する**

Edit で L31 を置換する。

`old_string`:
```
├── reviews/                  # レビュー結果（正本 JSON・reviewview セッション sidecar・旧 md 報告書）
```

`new_string`:
```
├── reviews/                  # レビュー結果（md 報告書。過去の正本 JSON・reviewview セッション sidecar も含む）
```

- [ ] **Step 8: `README.md` の reviewview セクションを書き換える**

Edit で L68 を置換する。

`old_string`:
```
`review:diff` は、AI の指摘を人間にトリアージさせるために reviewview の MCP サーバーを使う。`review:fix` は reviewview から判定を取り込み、修正結果を `report_fix` で報告する。
```

`new_string`:
```
`review:fix` は、過去に `review:diff` が出力した sidecar 付き JSON 報告書を扱うときに reviewview の MCP サーバーを使い、人間のトリアージ判定を取り込んで修正結果を `report_fix` で報告する。現在の `review:diff` は md 報告書を出力するだけで reviewview を使わないため、md 報告書だけを扱うなら以下の設定は不要。
```

続けて Edit で L74 を置換する。

`old_string`:
```
MCP サーバーが接続されていない場合、`review:diff` は**レビューを開始せずに冒頭で停止**する（レビューだけ実行して報告書を残すフォールバックはしない）。`review:fix` は reviewview の sidecar がある報告書を扱うときのみ同様に停止する。
```

`new_string`:
```
MCP サーバーが接続されていない場合、`review:fix` は reviewview の sidecar がある報告書を扱うときに冒頭で停止する。
```

- [ ] **Step 9: cbo 全体から `review:diff` と reviewview を結びつける記述が消えたか検証する**

Run:
```bash
rg -n 'review:diff' /Users/otto/workspace/mgzl-claude-code-plugin/cbo --glob '!**/node_modules/**'
```

Expected: ヒットした各行を目視で確認し、`review:diff` が reviewview を使う／JSON 報告書を出力すると読める記述が残っていないこと。以下は残ってよい:
- `cbo/README.md:30` の教訓ファイル説明（`implementation-lessons.md` の出典として `review:diff/file` を挙げている）
- `cbo/skills/review__fix/SKILL.md:31` の「必要なら review:diff を再実行してレビューを作り直すよう案内する」
- `cbo/skills/review__fix/SKILL.md:14` の「md 報告書（旧形式・review:plan 由来）」— **既知の非対応事項**（設計書に記載済み。`review:fix` は本計画のスコープ外のため修正しない）

- [ ] **Step 10: コミット（ユーザーから明示的な指示があった場合のみ）**

```bash
git add cbo/skills/document-saver/references/format-review-result-json.md cbo/skills/document-saver/SKILL.md cbo/README.md
git commit -m "docs: review:diff の md 報告書化に伴い周辺ドキュメントの記述を更新"
```

---

## 完了条件

- `review:diff` を実行すると `$MGZL_DIR/reviews/yyyyMMdd-hhmmss-<kebab>.md` が生成され、reviewview MCP が未接続でもレビューが完走する
- 生成された md の各指摘に `**位置**` 欄があり、`{path}:{行範囲} (new|old)` / `{path}:ファイル全体` / `なし` のいずれかの記法になっている
- 生成された md の frontmatter に `diff_mode` / `base_commit` / `head_commit` が入っている
- `review:fix` にその md を渡すと、`### R*` 見出しから指摘を切り出せる
- `cbo/skills/review__diff/SKILL.md` に `reviewview` の文字列が 1 件も無い
