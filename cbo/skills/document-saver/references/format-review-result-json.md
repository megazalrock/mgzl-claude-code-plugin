# レビュー結果 正本 JSON スキーマ

review:diff が出力するレビュー報告書の正本フォーマット（削除済みの旧 review:file が出力した報告書も同形式）。
document-saver スキルは経由せず、各スキルが Write ツールで !`echo $MGZL_DIR`/reviews/ に直接保存する。

- ファイル名: `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`
- タイムスタンプ取得: `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"`

人間に指摘を提示する UI は **reviewview**。review:diff が MCP ツール経由でトリアージを往復し、review:fix がその判定を回収する。

## スキーマ

```jsonc
{
  "reporter": "ClaudeCode review:diff",  // 実行主体
  "model": "claude-sonnet-4-6",          // 実行モデル名。不明なら "unknown"
  "base_commit": "abc...def",            // diff 対象のフル 40 桁 SHA-1。旧 review:file 由来の報告書は null
  "head_commit": "abc...def",            // レビュー時 HEAD のフル 40 桁 SHA-1。旧 review:file 由来の報告書は null
  "created_at": "2026-07-17T09:30:00+09:00",
  "target": null,                        // 任意: --target の絞り込み指定など。無ければ null
  "good_points": ["..."],                // 良い点。無ければ []
  "findings": [
    {
      "id": "R000",                      // R + 3桁ゼロパディング連番。出現順に R000, R001, ...
      "severity": 3,                     // 3=ブロッキング 2=推奨 1=軽微
      "file": "src/foo.ts",              // リポジトリルートからの相対パス。ファイルを特定できない指摘は null
      "anchor": { "side": "new", "line": 42 },
      // side: "new"=追加後の行 / "old"=削除行のみに関する指摘
      // 範囲指摘は "line": { "start": 36, "end": 39 }
      // 単一行に紐づかない指摘（ファイル全体への指摘）は anchor 自体を null
      "problem": "問題の説明",
      "reason": "なぜ問題なのか、どの原則に反するか",
      "reporter": "@reviewer-for-logic", // 担当サブエージェント名
      "proposals": [
        { "label": null, "text": "自然言語での修正方針。無ければ null", "code": "改善後のコード例（コードのみ）。無ければ null" }
        // text / code の少なくとも一方は非 null。複数案があるときは label に "案A" / "案B" を設定し要素を分ける
      ],
      "evaluation": { "value": null, "directive": null }
      // value: "tp"(妥当) | "fp"(誤検知) | "nit"(些細) | "oos"(スコープ外) | null(未評価)
      // directive: 人間からの追加指示（従来の 対応： 欄）。無ければ null
    }
  ],
  "references": ["..."]                  // 任意: 参考情報。無ければ []
}
```

## 編集規則

- 正本 JSON は原則イミュータブル。例外として、エージェント（review:fix）は reviewview から取得した人間の評価を **`evaluation` フィールドにのみ** 書き戻してよい
- 人間が `evaluation` を直接編集することも有効（UI を使わない場合の副経路）

---

# reviewview 経路（review:diff）

## reviewview への投入

正本 JSON を保存したあと、`mcp__reviewview__start_review` の `findings[]` に変換して投入する。
変換規則はここが正本。
`findings` は **1 件以上必須**（0 件の投入はバリデーションエラー）。投入対象が 0 件（指摘なし、または全指摘が `file: null` で投入対象外）ならレビューを投入しない。

### severity

| 正本 JSON | reviewview | ラベル（body に書く） |
|---|---|---|
| 3 | `error` | ブロッキング |
| 2 | `warn` | 推奨 |
| 1 | `info` | 軽微 |

### category

`reporter` から `@reviewer-for-` を除いた短縮名を渡す（`logic` / `design` / `security-performance` / `comments` / `test-code`）。reviewview の UI にバッジ表示される。
`get_triage` は `category` を返さないため、突合キーには使わない。

### anchor → file / side / startLine / endLine

| 正本 JSON | reviewview |
|---|---|
| `anchor: { side, line: N }` | `side`、`startLine: N`、`endLine: N` |
| `anchor: { side, line: { start, end } }` | `side`、`startLine: start`、`endLine: end` |
| `anchor: null`（`file` あり） | 下記「ファイル全体への指摘」を参照 |
| `file: null` | **投入しない**。下記「投入しない指摘」を参照 |

`file` はリポジトリルート相対パスにする。`./` 始まりは除去し、絶対パスはリポジトリルート相対に直す。
`/` 始まり・`./` 始まり・`..` を含むパスは投入できず、**1 件でも不正なパスがあると `start_review` 全体が失敗する**。

**ファイル全体への指摘（`anchor: null`）**: 差分が取れる場合は、そのファイルの差分の最初のハンクヘッダー `@@ -a,b +c,d @@` から `side: "new"` / `startLine: endLine: c` を作る（削除のみのファイルは `side: "old"` / `a`）。差分が取れない場合は `side: "new"` / `1` / `1`。いずれの場合も body に `【ファイル全体への指摘 / アンカーは便宜的】` の行を入れる。

**投入しない指摘**: `file` が `null` の指摘は reviewview に登録できない（`file` は必須・1 文字以上）。正本 JSON には残したまま reviewview からは除外し、`request_triage` の `message` に要約を、スキルの最終報告に本文を載せる。sidecar の `not_submitted` にも R-ID を記録する。

### body

reviewview の UI は body を **Markdown の基本セット**として解釈して描画する。
使えるのは **コードフェンス・インラインコード・強調（`**` / `*`）・リスト（`-` / `1.`）・リンク（`http:` / `https:` のみ）** の 5 つ。
見出し・引用・テーブル・生 HTML は解釈されず原文のまま表示されるので使わない。

````
{id} [{severity}] {ラベル} — {problem の要旨を1文で}
{problem の全文（要旨で言い尽くしているなら行ごと省略）}
【ファイル全体への指摘 / アンカーは便宜的】
根拠: {reason}
提案: {proposals[0].text}

```{lang}
{proposals[0].code}
```

提案（案B）: {proposals[1].text}

```{lang}
{proposals[1].code}
```
````

- 1 行目は R-ID と重要度で始め、続けて主張を 1 文で書く。R-ID を先頭に置くのは、sidecar が失われたときに `get_triage` の結果を正本 JSON へ突合するためのフォールバックになるから
- 段落内の単一改行はそのまま改行として表示される。`根拠:` / `提案:` の行構造は Markdown 解釈後も保たれる
- **コードは必ずフェンスで囲む**。フェンスの無いコードは段落として扱われ **行頭のインデントが落ちる**（4 スペースインデントによるコードブロックは reviewview 側で無効化されている）
  - `{lang}` はシンタックスハイライト用の言語識別子。`file` の拡張子から決める（`.ts` → `ts` / `.vue` → `vue` / `.php` → `php` / `.json` → `json`。shiki の言語 id / alias）。判らなければ省略する
  - コード自体がバッククォート 3 連を含む場合は、フェンス側のバッククォートを 4 つ以上にする
- 識別子・型名・パス・式・正規表現は**インラインコードで囲む**。特に `*` / `_` / `\` を含むものは必須（囲まないと Markdown 解釈でエスケープが復号され、文字が消えたり強調に化ける）
- `proposals[].label` が非 null のときだけ `（案A）` のようにラベルを付ける。`text` / `code` が null の行（`code` に対応するフェンスを含む）は出さない
- `報告者:` 行は入れない（`category` として渡すため）
- 秘密情報（トークン・鍵など）は転記しない。body は対象リポジトリの `.reviewview/state.db` に永続化される

## 人間のトリアージ（reviewview）

各指摘は reviewview の受信箱に 1 カードとして表示される。人間は次の 3 つを入力する:

- **判定ボタン**（`修正する` / `スコープ外` / `偽陽性`）→ `triage`
- **理由**の入力欄 → `triageReason`
- **コメント**欄（「AIへ渡ります」）→ `comments[]`（`author: "human"`）

入力し終えたら画面上部の送信ボタンを押す。送信すると `status` が `submitted` になり判定が確定する（**一方向。取り消せない**）。コメントは送信後も追記できる。

`get_triage` の応答 → 正本 JSON の `evaluation` への変換:

| reviewview の `triage` | `evaluation.value` |
|---|---|
| `fix` | `tp` |
| `false_positive` | `fp` |
| `out_of_scope` | `oos` |
| `null` | `null`（未判定） |

`evaluation.directive` は、`comments[]` のうち `author === "human"` の `body` を時系列順に改行連結し、`triageReason` が非 null ならその末尾に `判定理由: {triageReason}` を足す。どちらも無ければ `null`。

`nit`（些細）に相当する判定は reviewview には無い。md 報告書・`evaluation` の直接編集でのみ現れる値として残す。

## sidecar ファイル（reviewview セッション情報）

reviewview へ投入したとき、正本 JSON の隣に `<報告書名（.json を除く）>.reviewview-session.json` を Write ツールで作成する:

```json
{
  "review_id": "r-1a2b3c4d",
  "url": "http://localhost:53421/review/r-1a2b3c4d",
  "created_at": "2026-08-02T10:00:00+09:00",
  "base": "3f2a...",
  "head": "9c1d...",
  "finding_ids": { "R000": "f-1a2b3c4d", "R001": "f-5e6f7a8b" },
  "orphaned": ["R003"],
  "not_submitted": ["R007"]
}
```

- `review_id` は永続。レビューのデータは対象リポジトリの `.reviewview/state.db` に残るので、別セッションからでも `get_triage` で判定を取得できる
- **`url` は投入したセッション限定**。MCP モードの HTTP サーバーは空きポートで起動し、Claude Code が切断すると終了する
- `finding_ids` は `start_review` 直後に `get_triage` を 1 回だけ呼んで作った R-ID → reviewview の finding id の対応表。`start_review` は finding id を返さないため、この 1 回で確定させる
- `head` は作業ツリーを対象にした場合 `null`
- `orphaned` は差分の行に紐付かなかった R-ID、`not_submitted` は `file: null` などで投入しなかった R-ID
- セッション状態であり報告書の一部ではない。報告書一覧を出す処理では除外する
