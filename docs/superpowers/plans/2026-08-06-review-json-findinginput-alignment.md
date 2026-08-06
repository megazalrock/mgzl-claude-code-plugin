# レビュー正本 JSON の FindingInput 互換化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `review:diff` が保存するレビュー正本 JSON の `findings[]` を reviewview の
`FindingInput` と同形にし、投入を「`evaluation` を落とすだけ」の恒等変換にする。

**Architecture:** 規約の正本である
`cbo/skills/document-saver/references/format-review-result-json.md` を先に全面改訂し、
それを参照する `review:diff` / `review:fix` の手順を順に追従させる。最後に旧フィールド名の
残存を検索で機械的に確認する。設計の正本は
`docs/superpowers/specs/2026-08-06-review-json-findinginput-alignment-design.md`。

**Tech Stack:** Markdown のみ。コードもスクリプトも追加しない。検証は `rg` による文字列検索。

## Global Constraints

- **コミットしない。** 各タスクの最後は変更内容の要約報告で終える。コミットはユーザーが
  明示的に指示したときだけ行う
- 記述はすべて日本語
- SKILL.md は 500 行以内を目標とする
- Markdown のテーブルは、列ごとにデータを比較する場合か 3 列以上の場合のみ使う。
  それ以外はリスト形式にする
- 新規記述に旧フィールド名を残さない: `problem` / `reason` / `proposals` / `anchor` /
  `id`（指摘の識別子としての用法）/ `tp` / `fp` / `oos` / `nit`
- severity の新表記は `error` / `warn` / `info`。数値 3 / 2 / 1 はレビュアーサブエージェントの
  報告（`[3]` / `[2]` / `[1]`）にのみ残る
- 各タスクの検証は指定の `rg` コマンドを実行し、期待どおりの結果になることを目視で確認する

---

### Task 1: 正本規約ファイルの全面改訂

**Files:**
- Modify: `cbo/skills/document-saver/references/format-review-result-json.md`（全面改訂）

**Interfaces:**
- Produces: 新スキーマの正本。Task 2 / Task 3 はこのファイルの節見出しを参照する。
  節見出しは以下で固定する — `## スキーマ`、`## body の書式`、`## 編集規則`、
  `## reviewview への投入`、`## 人間のトリアージ（reviewview）`、
  `## sidecar ファイル（reviewview セッション情報）`

- [ ] **Step 1: 設計書を読む**

`docs/superpowers/specs/2026-08-06-review-json-findinginput-alignment-design.md` を通読する。
本タスクで書く内容の大半はこの設計書に確定値として書かれている。

- [ ] **Step 2: `## スキーマ` 節を書き換える**

冒頭の説明文（1-9 行目相当）は残し、`## スキーマ` の `jsonc` ブロックを設計書
「新スキーマ」節の内容に差し替える。`findings[]` の 8 フィールドが `FindingInput` と同形で
あること、`evaluation` だけが独自拡張であることをコメントで明示する。`unanchored[]` の
説明（ファイルを特定できない指摘の置き場、reviewview へは投入しない）も含める。

- [ ] **Step 3: `## body の書式` 節を新設する**

`## スキーマ` の直後に置く。設計書「body の書式」節の内容を転記する。特に以下を落とさない:

- 1 行目は `{ref}: ` で始め、続けて主張を 1 文
- 現行の `[error] ブロッキング` 相当のラベルは書かない
- コード引用は ` ```lang ` フェンスで囲む（**現行の「フェンスで囲んではならない」は削除する**）
- インラインコード・強調・リスト・リンクが反映される。`*` / `_` / `\` を含む識別子は
  インラインコードかフェンスで囲む
- 他の指摘への言及は `[[R001]]`。表示ラベルは参照先の「ファイル名:開始行」になる
- `【ファイル全体への指摘 / アンカーは便宜的】` 行は該当時のみ
- 複数案は `提案（案A）:` / `提案（案B）:` の行で分ける
- 秘密情報を転記しない

- [ ] **Step 4: `## 編集規則` 節を更新する**

`evaluation` のみ書き戻し可という規則は維持する。`value` の値域を
`fix` / `wont_fix` / `out_of_scope` / `false_positive` / `null` に書き換える。

- [ ] **Step 5: `## reviewview への投入` 節を書き換える**

- 投入は `findings[]` の各要素から `evaluation` を除いた 8 フィールドをそのまま渡すだけである旨
- `unanchored[]` は投入しない。`request_triage` の `message` に要約を、最終報告に本文を載せ、
  sidecar の `not_submitted` に `ref` を記録する
- 投入対象が 0 件ならレビューを投入しない（`findings` は 1 件以上必須）
- 現行の「severity」「category」「anchor → file / side / startLine / endLine」「body」の
  4 つの変換表は、変換が不要になったので**削除する**。代わりに以下を残す:
  - レビュアー報告の `[3]` / `[2]` / `[1]` → `error` / `warn` / `info` のマッピング
  - 担当サブエージェント名 → `category`（`logic` / `design` / `security-performance` /
    `comments` / `test-code`）のマッピング
  - `startLine <= endLine` の検証（逆転したまま投入すると `start_review` 全体が失敗する）
  - ファイル全体への指摘のアンカー生成規則（最初のハンクヘッダー `@@ -a,b +c,d @@` から
    `side: "new"` / `startLine = endLine = c`、削除のみなら `side: "old"` / `a`、
    差分が取れなければ `1` / `1`）
  - `file` のパス表記規約（`/` 始まり・`./` 始まり・`..` を含むパスは投入できず、
    1 件でも不正なら `start_review` 全体が失敗する）

- [ ] **Step 6: `## 人間のトリアージ（reviewview）` 節を更新する**

判定は 4 値（`fix` / `wont_fix` / `out_of_scope` / `false_positive`）＋未判定 `null` である旨に
更新する。`get_triage` の `triage` を `evaluation.value` へ**そのまま**入れる（恒等）ことを書き、
現行の変換表は削除する。`wont_fix` は「指摘自体は妥当だが人間が意図的に直さない判定。
修正も反論もしない」と明記する。`evaluation.directive` の組み立て規則
（`author === "human"` のコメントを時系列順に改行連結し、`triageReason` があれば末尾に
`判定理由: {triageReason}` を足す）は現行のまま維持する。現行末尾の `nit` に関する記述は削除する。

- [ ] **Step 7: `## sidecar ファイル（reviewview セッション情報）` 節を更新する**

JSON 例と説明は現行を維持する。`finding_ids` のキーが `ref` の値であること、
`not_submitted` が `unanchored[]` の `ref` であることを明記する。

- [ ] **Step 8: 旧フィールド名の残存を確認する**

Run: `rg -n 'problem|reason|proposals|anchor|"id"|\b(tp|fp|oos|nit)\b' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/document-saver/references/format-review-result-json.md`
Expected: 指摘の構造としての用法がヒットしないこと。`reporter`（トップレベルの実行主体）や
文中の一般語としての「理由」などは残ってよい。ヒットした行を 1 件ずつ確認する。

- [ ] **Step 9: 変更内容を要約して報告する（コミットしない）**

---

### Task 2: review:diff の更新

**Files:**
- Modify: `cbo/skills/review__diff/SKILL.md`（Step 9 / Step 11 / Step 12）

**Interfaces:**
- Consumes: Task 1 の `format-review-result-json.md` の節見出し。

- [ ] **Step 1: Step 9（正本 JSON の組み立て）を書き換える**

現行 84-90 行目相当の「各指摘を `findings[]` の要素にする」ブロックを差し替える。新しい内容:

- `ref` は出現順に `R000`, `R001`, ...（R + 3 桁ゼロパディング連番）
- `category` に担当サブエージェントの短縮名を入れる（`@reviewer-for-` を除いた部分）
- レビュアー報告の `[3]` / `[2]` / `[1]` を `severity` の `error` / `warn` / `info` に写す
- レビュアー報告の `**位置**` 欄から `file` / `side` / `startLine` / `endLine` を組み立てる。
  単一行の指摘は `startLine` と `endLine` を同値にする。`startLine <= endLine` を検証し、
  逆転している場合は行番号を検算して直す
- `**位置**` が `{path}:ファイル全体` の指摘はアンカーを便宜的に生成し、body に
  `【ファイル全体への指摘 / アンカーは便宜的】` の行を入れる
- `**位置**` が `なし` の指摘は `unanchored[]` に入れる（`ref` / `severity` / `category` /
  `body` の 4 フィールドのみ）
- レビュアー報告の `**問題**` / `**理由**` / `**提案**` から `body` を組み立てる。
  書式は正本規約の `## body の書式` に従う
- 同根の指摘が複数あるときは body 中で `[[R001]]` 形式で相互参照する
- `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する

差分中の秘密情報を `body` に転記しない旨（現行 90 行目相当）は維持する。

- [ ] **Step 2: Step 11（投入）を書き換える**

現行 94 行目の「`file: null` の指摘を除いた全指摘」を「`findings[]` の全指摘
（`unanchored[]` は投入対象外）」に読み替える。現行 101 行目の「`findings` の組み立て
（body / severity / category / anchor / 投入しない指摘）は…に従う」を
「`findings[]` の各要素から `evaluation` を除いた 8 フィールドをそのまま `start_review` の
`findings[]` に渡す」に書き換える。`base` / `head` の決め方（95-100 行目相当）は変更しない。

- [ ] **Step 3: Step 12（トリアージ依頼）を書き換える**

現行 104 行目の「各 finding の `body` 先頭の `R\d{3}` を使って `R000` → reviewview の
finding id の対応表を作る」は維持する（`get_triage` は `ref` を返さないため）。
現行 111 行目の「reviewview に載せられなかった指摘（`file: null`）の要約」を
「`unanchored[]` の要約」に書き換える。

- [ ] **Step 4: Step 13（最終報告）を書き換える**

現行 113 行目の「reviewview に載せられなかった指摘（`file: null`）の本文」を
「`unanchored[]` の指摘の本文」に書き換える。

- [ ] **Step 5: 旧フィールド名の残存を確認する**

Run: `rg -n 'anchor|file: null|proposals|problem' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__diff/SKILL.md`
Expected: ヒット 0 件。

- [ ] **Step 6: 変更内容を要約して報告する（コミットしない）**

---

### Task 3: review:fix の更新と旧 JSON 形式の削除

**Files:**
- Modify: `cbo/skills/review__fix/SKILL.md`（Step 2 全体、Step 6 のプロンプト、注意事項）

**Interfaces:**
- Consumes: Task 1 の `format-review-result-json.md`、Task 2 で確定した `findings[]` / `unanchored[]` の形。

- [ ] **Step 1: 判定の取り込み（現行 44-49 行目相当）を書き換える**

`evaluation` の組み立てを「`get_triage` の `triage` をそのまま `evaluation.value` に入れる
（`fix` / `wont_fix` / `out_of_scope` / `false_positive` / `null`）」に書き換える。
`directive` の組み立て規則は変更しない。突合キーの記述（40-42 行目相当）は、sidecar の
`finding_ids` が `ref` → reviewview の finding id の対応表である旨に用語だけ合わせる。

- [ ] **Step 2: 旧 JSON 形式の読み替え表（現行 51-57 行目相当）を削除する**

「JSON 報告書では、以降の手順の読み替えを行う」のブロックを丸ごと削除する。新形式では
`findings[]` の要素をそのまま使うため読み替えが不要になる。代わりに 1 行だけ残す:
「JSON 報告書の指摘は `findings[]` の要素をそのまま使う（`ref` が指摘 ID、`body` が指摘本文）」。

- [ ] **Step 3: 候補集合の決定（現行 58-61 行目相当）を書き換える**

- 引数に `R000` 形式の ID が 1 つ以上指定されている → その集合
- 無く、reviewview 経路で判定を取り込めた → `evaluation.value` が `fix` の指摘のみ。
  0 件なら判定の内訳を報告して終了する
- 無く、判定を取り込めなかった（sidecar 無し・md 報告書） → 報告書内の全指摘

あわせて「`unanchored[]` の指摘は reviewview へ投入しておらず判定が付かないため候補集合に
含めない（引数で `ref` を明示指定された場合のみ対象にする）」を追記する。

- [ ] **Step 4: 自然言語の絞り込み（現行 62-69 行目相当）を書き換える**

判断材料を新形式のフィールドに置き換える:

- 重要度の指定（例:「2 以上」「warn 以上」）→ `severity` を `error` > `warn` > `info` の
  順序で解釈する。数値表現は `3`→`error` / `2`→`warn` / `1`→`info` に読み替える
- 対象ファイルの指定（例:「テストファイルのみ」）→ `file` フィールドで判定する
- 担当レビュアーの指定（例:「reviewer-for-logic の指摘のみ」）→ `category` で判定する
- 判定状態の指定（例:「未評価のみ」）→ `evaluation.value` が `null` かで判定する

- [ ] **Step 5: 指摘の切り出し（現行 70-72 行目相当）を書き換える**

`**問題**` / `**理由**` / `**報告者**` / `**提案**` の構造化抽出を削除し、
「`body` 全文をそのまま保持する」に置き換える。あわせて:

- 人間指示（`human_directive`）は `evaluation.directive` から取る（非 null ならその値、
  null なら `null`）
- 複数案フラグは `body` 内に `提案（案X）:` 形式の行が 2 個以上あるかで判定する

- [ ] **Step 6: 実行確認（現行 77-79 行目相当）の複数案の記述を合わせる**

`**案A**` / `**案B**` の太字ラベルという記述を `提案（案A）:` / `提案（案B）:` の行に
書き換える。

- [ ] **Step 7: サブエージェントへのプロンプト（現行 118-137 行目相当）を書き換える**

`{切り出した指摘セクション全文}` を `{body 全文}` に書き換える。プロンプト内の
「`**提案**` のコード例と食い違う場合は」を「`提案:` のコード例と食い違う場合は」に、
「従来通り `**提案**` をそのまま実装させる」を「従来通り `提案:` をそのまま実装させる」に
書き換える。「報告書ファイル自体は編集しない」の注意は維持する。

- [ ] **Step 8: 注意事項（現行 179-183 行目相当）を書き換える**

- 「reviewview で `out_of_scope`（スコープ外）/ `false_positive`（偽陽性）と判定された指摘には
  反論せず、修正もしない」に **`wont_fix`（対応しない）を追加**する
- 人間の評価・指示の入力経路の説明で、JSON 報告書の欄名を新形式に合わせる

- [ ] **Step 9: 旧フィールド名の残存を確認する**

Run: `rg -n '\*\*問題\*\*|\*\*理由\*\*|\*\*報告者\*\*|\*\*提案\*\*|proposals|anchor|\b(tp|fp|oos)\b' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__fix/SKILL.md`
Expected: md 報告書（旧 `review:plan` 由来）経路の記述だけがヒットすること。md 報告書の経路は
非スコープなので残してよい。JSON 報告書の文脈でヒットした行は直す。

- [ ] **Step 10: `wont_fix` が入ったことを確認する**

Run: `rg -n 'wont_fix' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/review__fix/SKILL.md`
Expected: 1 件以上ヒットする（Step 1 の判定値と Step 8 の注意事項）。

- [ ] **Step 11: 変更内容を要約して報告する（コミットしない）**

---

### Task 4: 周辺記述の追従と全体整合の確認

**Files:**
- Modify: `cbo/skills/document-saver/SKILL.md:42`（必要なら）
- Modify: `cbo/README.md`（必要なら）

**Interfaces:**
- Consumes: Task 1〜3 の全成果。

- [ ] **Step 1: `document-saver/SKILL.md:42` を確認する**

Read: `cbo/skills/document-saver/SKILL.md` の 42 行目。正本 JSON への参照リンクのみで
スキーマの記述を含まないなら**変更不要**。スキーマに触れている記述があれば新形式に直す。

- [ ] **Step 2: `cbo/README.md` を確認する**

Run: `rg -n 'severity|evaluation|anchor|判定|トリアージ' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/README.md`
Expected: 70-78 行目の reviewview 設定節がヒットする。判定値やスキーマの具体的な記述が
あれば新形式に直す。無ければ変更不要。

- [ ] **Step 3: プラグイン全体で旧構造の記述が残っていないか確認する**

Run: `rg -n --no-ignore '"anchor"|proposals\[|evaluation.value.*tp|重要度 \[N\]' /Users/otto/workspace/mgzl-claude-code-plugin/cbo`
Expected: ヒット 0 件（`docs/superpowers/` 配下の過去の設計書・計画書はヒットしてよいので
検索対象から外している）。

- [ ] **Step 4: 設計書との突き合わせを行う**

`docs/superpowers/specs/2026-08-06-review-json-findinginput-alignment-design.md` の
「影響ファイル」節に挙がった 5 ファイルすべてに変更（または変更不要の確認）が済んでいることを
確かめる。「非スコープ」節の 4 項目に手を入れていないことも確かめる。

- [ ] **Step 5: 全体の変更内容を要約して報告する（コミットしない）**

`git status` と `git diff --stat` で変更ファイルの一覧を示し、ユーザーにコミットの要否を尋ねる。
