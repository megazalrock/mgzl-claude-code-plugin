# レビュー正本 JSON の FindingInput 互換化 設計

## 目的

`review:diff` が保存するレビュー正本 JSON の `findings[]` を、reviewview の `FindingInput`
と同形にする。reviewview への投入を「`evaluation` を落とすだけ」の恒等変換に近づけ、
両者の規約が乖離してもエラーとして顕在化しない現状を解消する。

## 背景

reviewview 側は `packages/server/src/findingSchema.ts` の zod スキーマを単一ソースとし、
その `.describe()` が MCP の `tools/list` に載るようになった。`start_review` のツールスキーマを
読むだけで構造の規約（フィールド・必須性・制約）が取得できる。

一方 cbo 側の規約（`document-saver/references/format-review-result-json.md`）は独自構造のまま
更新が止まっており、以下の乖離が生じている。うち 2 件は実害のあるバグである。

- **`wont_fix` 判定の欠落（バグ）** — reviewview の判定は 4 値
  （`fix` / `wont_fix` / `out_of_scope` / `false_positive`）だが、cbo の変換表は 3 値のまま。
  人間が「対応しない」を選ぶと `evaluation.value` に写せる値がなく、`review:fix` が未定義の
  状態に陥る。
- **`body` の Markdown 規約が逆転（バグ）** — cbo は「フェンス禁止・プレーンテキスト」と
  規定するが、reviewview 現行はフェンスをシンタックスハイライト付きで描画する。
  指摘中のコード例が読みにくい状態が続いている。
- `ref` による指摘間リンク（`[[<ref>]]`）が未使用。
- `startLine <= endLine` の検証が cbo 側に無い（reviewview 側は 2026-08-06 に追加済み。
  逆転すると `start_review` 全体が失敗する）。

## 確定事項（調査で確認済み）

- `get_triage` の応答に `ref` と `category` は含まれない。返るのは `id` / `file` / `side` /
  `startLine` / `endLine` / `severity` / `body` / `isOrphaned` / `status` / `triage` /
  `triageReason` / `comments[]`。**sidecar 消失時の突合には body 先頭の R-ID が必要**。
- `ref` は投入時限りのキーで保存されない。本文中の `[[<ref>]]` は投入時に実 ID へ置換される。

## 新スキーマ

```jsonc
{
  "reporter": "ClaudeCode review:diff",   // 実行主体
  "model": "claude-opus-5",               // 実行モデル名。不明なら "unknown"
  "base_commit": "<フル40桁 SHA-1>",
  "head_commit": "<フル40桁 SHA-1>",
  "created_at": "2026-08-06T09:30:00+09:00",
  "target": null,                         // --target の絞り込み指定。無ければ null
  "good_points": [],                      // 良い点。無ければ []
  "findings": [
    {
      // ── 以下 8 フィールドは FindingInput と同形。そのまま start_review へ渡せる ──
      "ref": "R000",                      // R + 3桁ゼロパディング連番。出現順。唯一の識別子
      "file": "src/foo.ts",               // リポジトリルート相対パス
      "side": "new",                      // "new" | "old"
      "startLine": 42,
      "endLine": 45,                      // startLine 以上
      "severity": "error",                // "error" | "warn" | "info"
      "category": "logic",                // 担当レビュアーの短縮名
      "body": "R000: 主張を1文で。\n根拠: ...\n提案: ...",
      // ── 独自拡張。投入時に除去する ──
      "evaluation": { "value": null, "directive": null }
    }
  ],
  "unanchored": [
    // ファイルを特定できない指摘。reviewview へは投入しない
    { "ref": "R007", "severity": "warn", "category": "design", "body": "R007: ..." }
  ],
  "references": []                        // 参考情報。無ければ []
}
```

`findings[]` から `evaluation` を除いた 8 フィールドが `start_review` の `findings[]` に
そのまま渡る。

### 旧スキーマからの対応

- `id` → `ref` に統合（`id` フィールドは廃止）
- `problem` / `reason` / `proposals[]` → `body` 一本化
- `reporter`（担当サブエージェント名）→ `category` に統合（フィールドは廃止）
- `anchor: { side, line }` → `side` / `startLine` / `endLine` にフラット化
- `severity` の数値 3 / 2 / 1 → `error` / `warn` / `info`
- `file: null` の指摘 → `unanchored[]` へ分離
- `evaluation.value` の `tp` / `fp` / `oos` / `nit` → reviewview の判定値をそのまま採用
  （`fix` / `wont_fix` / `out_of_scope` / `false_positive` / `null`）。`nit` は対応する判定が
  reviewview に無く使われていないため廃止

## body の書式

````
R000: 主張を1文で。
{問題の全文。1行目の要旨で言い尽くしているなら省略}
【ファイル全体への指摘 / アンカーは便宜的】
根拠: {なぜ問題なのか、どの入力で何が壊れるか}
提案: {修正方針}
```ts
{改善後のコード例}
```
提案（案B）: {別案}
````

- 1 行目は `{ref}: ` で始め、続けて主張を 1 文で書く。reviewview の「1 行目は主張 1 文」を
  満たしつつ、sidecar が失われたときに `get_triage` の結果を正本 JSON へ突合するための
  `R\d{3}` フォールバックを兼ねる
- 現行の `[error] ブロッキング` 相当のラベルは書かない（reviewview が `severity` を色で表示する）
- コード引用は ` ```lang ` フェンスで囲む。言語識別子は shiki の言語 id / alias
- インラインコード・強調・リスト・リンク（`http:` / `https:` のみ）が表示に反映される。
  `*` / `_` / `\` を含む識別子・正規表現はインラインコードかフェンスで囲む
- 他の指摘への言及は `[[R001]]`。表示ラベルは参照先の「ファイル名:開始行」になるため、
  括弧ごと 1 つの名詞として読める文にする
- `【ファイル全体への指摘 / アンカーは便宜的】` 行は該当時のみ
- 複数案があるときは `提案（案A）:` / `提案（案B）:` の行で分ける。`review:fix` はこの行の
  出現数で複数案を検出する
- 秘密情報（トークン・鍵など）は転記しない。body は対象リポジトリの `.reviewview/state.db` に
  永続化される

## 変換規則

### severity

レビュアーサブエージェントの報告は `[3]` / `[2]` / `[1]` のまま据え置き、`review:diff` の
統合時にマッピングする。

- `[3]` ブロッキング → `error`
- `[2]` 推奨 → `warn`
- `[1]` 軽微 → `info`

### category

担当サブエージェント名から `@reviewer-for-` を除いた短縮名を入れる。

- `logic` / `design` / `security-performance` / `comments` / `test-code`

### アンカー

- レビュアー報告の `**位置**` 欄から `file` / `side` / `startLine` / `endLine` を組み立てる
- 単一行の指摘は `startLine` と `endLine` を同値にする
- `startLine <= endLine` を検証する。逆転している場合は行番号を検算して修正する
  （逆転したまま投入すると `start_review` 全体が失敗する）
- **ファイル全体への指摘**（`**位置**` が `{path}:ファイル全体`）: そのファイルの差分の
  最初のハンクヘッダー `@@ -a,b +c,d @@` から `side: "new"` / `startLine = endLine = c` を作る
  （削除のみのファイルは `side: "old"` / `a`）。差分が取れない場合は `side: "new"` / `1` / `1`。
  いずれの場合も body に `【ファイル全体への指摘 / アンカーは便宜的】` の行を入れる
- **ファイルを特定できない指摘**（`**位置**` が `なし`）: `unanchored[]` に入れる。
  `ref` / `severity` / `category` / `body` の 4 フィールドのみを持つ

### 人間の判定 → evaluation

`get_triage` の `triage` をそのまま `evaluation.value` に入れる（恒等）。

- `fix` / `wont_fix` / `out_of_scope` / `false_positive` / `null`

`evaluation.directive` は、`comments[]` のうち `author === "human"` の `body` を時系列順に
改行連結し、`triageReason` が非 null ならその末尾に `判定理由: {triageReason}` を足す。
どちらも無ければ `null`。

## reviewview への投入

- `findings[]` の各要素から `evaluation` を除いた 8 フィールドを `start_review` に渡す
- `unanchored[]` は投入しない。`request_triage` の `message` に要約を、スキルの最終報告に
  本文を載せ、sidecar の `not_submitted` に `ref` を記録する
- 投入対象が 0 件ならレビューを投入しない（`findings` は 1 件以上必須）

## sidecar ファイル

形式は現行を維持する。`finding_ids` のキーは `ref` の値。

```json
{
  "review_id": "r-1a2b3c4d",
  "url": "http://localhost:53421/review/r-1a2b3c4d",
  "created_at": "2026-08-06T10:00:00+09:00",
  "base": "3f2a...",
  "head": "9c1d...",
  "finding_ids": { "R000": "f-1a2b3c4d", "R001": "f-5e6f7a8b" },
  "orphaned": ["R003"],
  "not_submitted": ["R007"]
}
```

## review:fix の変更

- **候補集合**: `findings[]` のうち `evaluation.value === "fix"` の指摘のみ。`wont_fix` /
  `out_of_scope` / `false_positive` は修正も反論もしない。`unanchored[]` は reviewview へ
  投入しておらず判定が付かないため、候補集合に含めない（ID を明示指定された場合のみ対象にする）
- **突合キー**: sidecar の `finding_ids`（`ref` → reviewview の finding id）を第一キーとし、
  無ければ body 先頭の `R\d{3}`、それでも決まらなければ (`file`, `side`, `startLine`, `endLine`)
- **指摘の切り出し**: `findings[]` の要素をそのまま使う。`**問題**` / `**理由**` / `**提案**`
  への読み替えは不要になり、実装エージェントには `body` 全文を渡す
- **複数案の検出**: body 内の `提案（案X）:` 行が 2 個以上あるかで判定する
- **自然言語の絞り込み**: 「2 以上」のような数値表現は `error` > `warn` > `info` の順序に
  読み替えて解釈する。「reviewer-for-logic の指摘のみ」は `category` で判定する
- **旧 JSON 形式の非対応**: `id` / 数値 `severity` / `problem` / `anchor` を持つ旧形式報告書の
  記述を削除する。既存の報告書は `review:fix` の対象外になる

## 影響ファイル

- `cbo/skills/document-saver/references/format-review-result-json.md` — 全面改訂
- `cbo/skills/review__diff/SKILL.md` — Step 9（正本 JSON の組み立て）/ Step 11（投入）/
  Step 12（sidecar・orphan 検算）
- `cbo/skills/review__fix/SKILL.md` — Step 2（読み替え・判定変換・候補集合）、旧 JSON 形式の削除
- `cbo/skills/document-saver/SKILL.md` — 参照記述
- `cbo/README.md` — 記述

レビュアーサブエージェント 5 体（`reviewer-for-logic` ほか）は変更しない。

## 非スコープ

- `get_learnings` を `review:diff` のレビュー作成前提に組み込むこと（reviewview 公式スキルは
  必須手順としているが、今回は扱わない）
- レビュアーサブエージェントの severity 表記の変更
- 旧形式 JSON 報告書の後方互換
- md 報告書（旧 `review:plan` 由来）の経路
