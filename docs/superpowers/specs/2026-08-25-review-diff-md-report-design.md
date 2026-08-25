# review:diff のレビュー結果を md 報告書として保存する設計

- 日付: 2026-08-25
- 対象: `cbo/skills/review__diff`
- 種別: 設計書（brainstorming 由来）

## 背景

現行の `review:diff` は、レビュー結果を「正本 JSON」として保存したうえで、reviewview MCP へ必ず投入する。MCP サーバーが接続されていなければ Step 0 の前提チェックでレビュー自体を開始せずに停止する（`cbo/skills/review__diff/SKILL.md:25-29`）。

この「reviewview 必須」の前提を外し、レビュー結果を人間が直接読み書きできる md 報告書として保存するところまでで完結させたい。

## 目的

1. `review:diff` を reviewview に依存させない。MCP 未接続でもレビューが完走する
2. レビュー結果を人間可読な md として保存し、`評価：` / `対応：` 欄への直接記入を人間の入力経路とする
3. 後日 reviewview へ投入する可能性を殺さないよう、投入に必要な情報（ファイルパス・side・行範囲）を md 上に保持する

## スコープ

### 変更する

- `cbo/skills/review__diff/SKILL.md`
- `cbo/skills/document-saver/references/format-review-result.md`
- `cbo/skills/document-saver/references/format-review-result-json.md`（位置づけの記述のみ）
- `cbo/skills/document-saver/SKILL.md`（注記のみ）
- `cbo/README.md`

### 変更しない

- `cbo/skills/review__fix/SKILL.md` — 既に md 報告書の経路を実装済みのため（後述）
- `cbo/agents/reviewer-for-*.md` — 出力フォーマットは現行のまま流用できる
- `format-review-result-json.md` の変換表本体（L62-134）— 後日の投入時に再利用する資産

## 前提となる調査結果

### `review:fix` は既に md 報告書を扱える

`cbo/skills/review__fix/SKILL.md` には md 報告書の経路が実装済みである。

- 報告書探索の対象は `.json` と `.md` の両方（L21）
- md 報告書では人間の `評価：` / `対応：` 欄が入力経路（L188）
- md 報告書のときは `mcp__reviewview__report_fix` をスキップする分岐がある（L117）
- 知見蓄積の (A) 系統も md では空とする分岐がある（L167）
- JSON 報告書での処理は md 手順に対する「読み替え」として記述されている（L51-57）

つまり md 手順が本体で、JSON はその上に後付けされた構造である。md への回帰は巻き戻しに近い。

### reviewview が finding に要求する値

`mcp__reviewview__start_review` の `findings[]` 要素:

- 必須: `file`（リポジトリルート相対）/ `side`（`old` | `new`）/ `startLine` / `endLine` / `severity`（`info` | `warn` | `error`）/ `body`
- 任意: `category` / `ref` / `relations`

現行の旧 md テンプレート（`format-review-result.md`）は `file` / `side` / `startLine` / `endLine` の 4 必須項目を欠いている。これを `**位置**` 欄の新設で補う。

### レビュアーエージェントは既に位置情報を出力している

`cbo/agents/reviewer-for-logic.md:192-198` が `**位置**` 欄を必須出力として定義しており、書式は
`[ファイルパス:行番号 または 行範囲 (new|old) / ファイルパス:ファイル全体 / なし]`。
他の `reviewer-for-*` も同型。md 報告書へはこれをそのまま転記すればよい。

## 設計

### 1. md 報告書のフォーマット

`cbo/skills/document-saver/references/format-review-result.md` を改訂して `review:diff` の保存先テンプレートとする。

#### 全体構造

````markdown
---
reporter: ClaudeCode review:diff
model: {実行中の自身のモデル名。不明なら unknown}
target: {--target の指定内容。指定が無ければ省略}
diff_mode: {commit | merge-base | staged | worktree}
base_commit: {BASE のフル 40 桁 SHA}
head_commit: {HEAD のフル 40 桁 SHA}
---

# レビュー結果

## 良い点

## 改善提案

### R000 [3] ブロッキング 評価： 対応：
**位置**: src/foo/bar.ts:42-45 (new)
**問題**: {問題の説明}
**理由**: {なぜ問題なのか、どの原則に反するか}
**報告者**: @reviewer-for-logic
**提案**:
{自然言語での修正方針}
```typescript
// 改善後のコード例
```

## 参考情報
````

#### 現行テンプレートからの差分（4 点）

**① `**位置**` 欄を新設（必須）**

レビュアーエージェントの出力をそのまま転記する。記法は以下のいずれか。

- `{path}:{行番号} (new)` — 単一行
- `{path}:{start}-{end} (new)` — 行範囲
- `{path}:{行番号} (old)` — 削除行への指摘のみ
- `{path}:ファイル全体` — 行を特定できない
- `なし` — ファイルすら特定できない

`{path}` はリポジトリルート相対パス。

**② `対応：` 欄を見出し行に追加**

`review:fix` は `対応：` を `evaluation.directive` として読む仕様（`cbo/skills/review__fix/SKILL.md:56`）だが、現行テンプレートには欄自体が存在しなかった。見出し行末尾に `評価：` と並べて配置する。

**③ 見出しを `# レビュー結果` に変更**

現行の `# {ファイル名}レビュー結果` は単一ファイル前提。`review:diff` は複数ファイルを横断する。

ファイル別の中間見出しでグルーピングすると `### R*` が `####` にずれ、`review:fix` が指摘を切り出せなくなる。したがって**指摘は `## 改善提案` 直下にフラットに並べ、ファイルの区別は `**位置**` 欄が担う**。

**④ `diff_mode` の追加、`base_commit` / `head_commit` は `review:diff` 側で必須化**

- `diff_mode` を新設。staged モードの報告書を後日 reviewview へ投入する際、`git diff --cached` を reviewview 側で再現できず行番号がズレるため、投入時の判断材料として記録する。なお Step 1 は merge-base モードを解決したあと「以降はコミット比較モードとして扱う」と定めているため、Step 9 側で「merge-base を解決した場合は `merge-base` と記載する」と明示しないと `commit` と誤記される。
- `base_commit` / `head_commit` はテンプレート側ではコメントアウトされた任意項目のまま据え置く。テンプレートは `review:diff` 以外の実行主体（Codex / GitHub Copilot など）とも共用するため、テンプレート自体に必須制約を持たせない。代わりに `review:diff` の Step 9 側で「**必須**」と指示し、`review:diff` が出力する報告書に限り必ず値が入るようにする

#### 複数案がある場合

```markdown
**提案**:
**案A**: {方針}
**案B**: {方針}
```

`review:fix` の複数案フラグ判定に対応する md 表現。`cbo/skills/review__fix/SKILL.md:72` は「`**提案**` 本文が `**案A**` / `**案B**` の太字ラベルで 2 個以上に分割されているか」で複数案を検出するため、`**提案（案A）**` のようにラベル自体を分けてはならない（`**提案**` という文字列が消えて検出されなくなる）。

#### 維持する既存記述

- `評価：` の値定義（`tp` / `fp` / `nit` / `oos` / 空）と末尾のコメントブロック（現行 L37-47）
- 「評価は人間がレビュー報告書ファイルに直接書き込むことを唯一の入力経路とする」（現行 L46）

#### reviewview への変換注記（2 行）

テンプレート末尾に以下を追記する。

- `**位置**` 欄は reviewview の `file` / `side` / `startLine` / `endLine` に対応する
- 投入時の詳細な変換規則は `format-review-result-json.md` の「reviewview への投入」を参照する

### 2. `review:diff` のワークフロー変更

現行は Step 0〜12 の 13 ステップ。このうち Step 1〜8（diff モード決定〜レビュアー並列実行）は変更しない。Step 0 の削除により最終的に Step 1〜10 の 10 ステップになる。

#### 削除するステップ

**Step 0（前提チェック、L25-29）を全削除**

`mcp__reviewview__start_review` の存在確認と即停止、`.mcp.json` の確認案内、「フォールバックはしない」の宣言をすべて削除する。MCP 未接続でもレビューは完走する。

**Step 10（投入、L90-99）・Step 11（対応表とトリアージ依頼、L100-109）を全削除**

以下が併せて消える。

- `base` / `head` の diff モード別決定ロジック（L92-97）
- staged モードの行ズレ警告（L96-97）
- `orphanedFindingIds` の検算と Step 10 へのやり直し（L104-106）
- sidecar の生成（L107）
- `get_triage` の 1 回呼び出しと `request_triage`（L101-103, L108-109）

正味 24 行の削減。

#### 書き換えるステップ

**Step 9 — md 報告書の組み立て・保存**

現行の JSON 組み立て規則（L81-88）を md 向けに置き換える。

- `--target` の指定があれば frontmatter の `target` にその指定内容をそのまま記載する（指定が無ければ `target` の行ごと省略する）
- R-ID は出現順に `R000`, `R001`, …（変更なし）
- レビュアー報告の `**位置**` 欄をそのまま転記する（`file` と `anchor` への分解工程は不要になる）
- `**問題**` / `**理由**` / `**提案**` をそのまま転記する（フェンス内外を `text` / `code` へ分離する工程は不要になる）
- `**報告者**` に担当サブエージェント名を記載する
- `評価：` / `対応：` は空欄で初期化する
- 他の指摘へ言及するときは `R003` と平文で書く（`[[R003]]` は reviewview のリンク記法なので md では使わない）
- 秘密情報（トークン・鍵など）は転記しない
- 各レビュアーが報告した「良い点」を `## 良い点` に、「参考情報」を `## 参考情報` に統合する（いずれも該当が無ければ見出しごと省略する）
- 指摘が 0 件でも報告書は保存する（`## 改善提案` の見出しは残し、その下を空にする）
- ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.md`
- タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得する
- 保存先は `$MGZL_DIR/reviews/`、`document-saver` スキルは経由せず Write ツールで直接保存する

**Step 12 → 新 Step 10（最終報告）**

報告内容を以下に差し替える。

- md 報告書の保存先パス
- severity ごとの件数内訳
- `**位置**: なし` の指摘があればその本文
- `review:fix` で修正に進めること（既定では報告書内の全指摘が対象になる。`評価：` 欄に記入したうえで review:fix に「tp のみ」などの絞り込みを自然言語で指定すると対象を絞れる）

#### 文言の調整（1 箇所）

Step 6（L67）「コミット比較モードは `git diff <base_commit> <head_commit> -- <filepath>` を渡す（reviewview の行番号と一致させるため）」の理由づけが reviewview 依存になっている。

「md 報告書の `**位置**` 欄の行番号基準を統一するため」に書き換える。差分の取り方自体は変更しない。

### 3. 周辺ファイルの更新

#### `format-review-result-json.md`（削除しない）

`review:fix` が 3 箇所（L14 / L44 / L114）で参照し続けるため削除できない。位置づけの記述のみ修正する。

- L3「review:diff が出力するレビュー報告書の正本フォーマット」→「過去に `review:diff` が出力した JSON 報告書のフォーマット。現在の `review:diff` は md 報告書を出力する」
- L54 の H1「`# reviewview 経路（review:diff）`」→「`# reviewview 経路（review:fix / 手動投入）`」
- L58「正本 JSON を保存したあと、`start_review` の `findings[]` に変換して投入する」→「JSON 報告書を reviewview に投入する場合の変換規則」

変換表本体（L62-134）には手を加えない。

#### `document-saver/SKILL.md:44`

現行の注記は「review:diff が出力するレビュー結果は本スキルを経由せず、正本 JSON として各スキルが直接保存する。本スキルの『レビュー結果』テンプレート（md）は review:plan 用に残っている」。

`review:plan` スキルは `cbo/skills/` に実在しないため、この記述は誤りである。

「`review:diff` が出力するレビュー結果は本スキルを経由せず、`references/format-review-result.md` をテンプレートとして Write ツールで直接保存する」に改める。L33 のテンプレート表は変更しない。

#### `cbo/README.md`

- L31 の `reviews/` 説明 →「レビュー結果（md 報告書。過去の正本 JSON・reviewview セッション sidecar も含む）」
- L66-74 の reviewview セクション → `review:fix` 専用の説明に書き換える。特に L74「MCP サーバーが接続されていない場合、`review:diff` は**レビューを開始せずに冒頭で停止**する」は削除する

## 既知の非対応事項

### `review__fix/SKILL.md:14` の記述が実態と食い違う

同行は md 報告書を「旧形式・review:plan 由来」と説明している。本変更後、md 報告書は `review:diff` の標準出力になるためこの説明は古くなる。

「`review:fix` は触らない」という方針のため今回は修正しない。動作に影響はなく、記述の古さが残るのみ。

### reviewview への投入は機能として実装しない

`review:diff` に投入フラグを設けず、投入専用スキルも新設せず、実行後の対話確認も行わない。投入が必要な場合は、その都度ユーザーが自然言語で指示する。

md 報告書は投入に必要な情報（`**位置**` 欄・`diff_mode`・`base_commit` / `head_commit`）を保持しているため、指示があれば `format-review-result-json.md` の変換規則を参照して投入できる。

### `relations` は表現しない

reviewview の `relations`（`duplicate_of` / `superseded_by` / `depends_on`）は現行の正本 JSON でも未対応であり、md でも表現しない。指摘間の関連は本文中に `R003` と平文で書く。

### `diff_mode` の使い道が文書に残らない

旧 Step 10 にあった diff モード別の `base` / `head` 決定ロジックと staged モードの行ズレ警告は、`review:diff` から削除しただけで `format-review-result-json.md` へ移設していない。そのため `diff_mode` という値は報告書に残るが、その値を投入時にどう使うかの知識はリポジトリ上に残っていない。

投入は機能として実装しない方針であり、必要になった時点で git 履歴から旧 Step 10 のロジックを復元できるため、移設は行わない。

### `review:fix` に古くなった記述が 2 箇所残る

- `cbo/skills/review__fix/SKILL.md:64` の「指摘セクションに専用のファイルパス欄は無いため本文記述から判断する」は、`**位置**` 欄の新設により事実に反する
- 同 `:102` の「修正対象がテストコード」の判定を `**問題**` / `**提案**` 本文からの推測で行う記述も、`**位置**` 欄を見れば確実に判定できるため最適ではない

どちらも動作は壊れないが、`**位置**` 欄を新設した価値が下流で活かされず、`@test-implementer` / `@code-implementer` の振り分け精度が上がらない。`review:fix` を触らない方針のため今回は修正しない。

### md 既定化により知見蓄積の (A) 系統が恒久的に空になる

`cbo/skills/review__fix/SKILL.md:167` は「sidecar が無い場合・md 報告書の場合は (A) は空とする（『人間が指摘を妥当と認めた』ことを保証できないため）」と定めている。本変更以降 `review:diff` の出力は常に md になるため、`@knowledge-distiller` に渡るのは (B)（修正後レビューの指摘）だけになり、元レビューの `tp` かつ severity 2 以上という最も質の高い教訓源が枯れる。

md 報告書でも人間が `評価：tp` を手書きすれば「人間が妥当と認めた」保証は実際には得られるため、本来は L167 を「md 報告書でも `評価：tp` が記入されている指摘は (A) の対象とする」に直すのが正しい。`review:fix` を触らない方針のため今回は修正しない。

なお `cbo/README.md:30` は `implementation-lessons.md` の出典に `review:diff/file` を挙げたままであり、この点でも記述と実態が乖離する。
