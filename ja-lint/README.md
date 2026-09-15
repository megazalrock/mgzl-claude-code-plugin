# ja-lint

Claude Code が書く日本語を textlint で検査するプラグインである。

## 検査対象

- Edit / Write で書かれたソースコード内のコメント（Edit は追加行のみ）
- Write / Edit で書かれた Markdown ファイル（`.md`、Edit は編集後のファイル全文を検査して書き換えた行の指摘だけを報告する）
- `git commit` のコミットメッセージ（`-m` / `--message` / `-F` / `--file` / heredoc）
- `gh pr create` / `gh pr edit` のタイトルと本文（`--title` / `--body` / `--body-file`）

Claude の応答文そのもの、人間が直接書いた文章は対象外である。

## 対象拡張子

- `//` と `/* */`: ts, tsx, js, jsx, mjs, cjs, vue, php, css, scss, go, rs, java, kt, swift
- `#`: yml, yaml, sh, bash, zsh, py, rb, toml, php
- `<!-- -->`: vue, html
- `--`: sql

## 文脈別のルール構成

- `comment`（コード内コメント）: ja-technical-writing 一式（`ja-no-mixed-period` を除く） + ai-writing の `no-ai-hype-expressions` + prh
- `commit`（コミットメッセージ、PR タイトル）: `comment` と同じ
- `pr`（PR 本文）: ja-technical-writing 一式（`ja-no-mixed-period` を含む） + ai-writing 5 ルール全部 + prh。`ai-tech-writing-guideline` だけは info 扱い
- `markdown`（Markdown ファイル本文）: `pr` と同じ

文末の句点「。」を必須にするのは `pr` 文脈と `markdown` 文脈だけである。`pr` / `markdown` は Markdown として解析するため、箇条書き・見出し・コードブロックは `ja-no-mixed-period` の対象外になる。

## 挙動

- `git commit` / `gh pr` は PreToolUse で検査し、error があれば `permissionDecision: "deny"` でコマンド実行を拒否する。info だけなら `additionalContext` で参考情報として返す
- Edit / Write は PostToolUse で検査し、error があれば上位の `decision: "block"` と `reason` で指摘を返す。info だけなら `additionalContext` で返す。PostToolUse はツール実行後に走るため編集自体は取り消されないが、reason は修正指示として Claude に届く
- 日本語（ひらがな・カタカナ・漢字）を 1 文字も含まない場合は textlint を読み込まずに終了する
- Markdown の Edit は編集後のファイル全文を lint する。frontmatter の区切りやコードフェンスを保ったまま解析するためで、報告は書き換えた行に載る指摘だけに絞る。全文を読めない場合は差分の行だけを見る経路へ落ちる
- 日本語を 1 文字も含まないノード（段落・箇条書きの項目・見出し・`Str`）の指摘は捨てる。日本語向けのルールが英語の地の文へ効いてしまうのを防ぐためで、日本語の段落に混ざる英単語は従来どおり指摘される
- hook 自身が失敗した場合は stderr に 1 行残して何も返さない（ツール実行は止めない）

既知の限界:

- 文字列リテラル内の `//` や `#` をコメントと誤認することがある（日本語を含む場合のみ影響）
- 1 回の Edit で離れた場所に追加した複数のコメント行は 1 段落として連結され、行をまたぐルールが誤検知することがある
- コメントの Edit で段落の一部だけを差し替えると追加行が文の途中で切れ、句点の誤検知につながることもある
- 日本語を含まないノードの除外はノード単位で判定するため、英文のノードに日本語の語が 1 つでも混ざると英文全体が検査対象に戻る

出力例:

```
ja-lint: 日本語の文章に修正が必要です（error 2 件）
- 「ユーザの情報の取得を行う」 [prh] ユーザの => ユーザーの
- 「ユーザの情報の取得を行う」 [ja-technical-writing/ja-no-redundant-expression] 【dict5】 "取得を行う"は冗長な表現です。"取得する"など簡潔な表現にすると文章が明瞭になります。
```

## 調整方法

- 表記ゆれ辞書: `rules/prh.yml`。prh パッケージ（MIT）同梱の `prh-rules/media/WEB+DB_PRESS.yml` を `imports` で読み込んでいる。独自項目は同ファイルの `rules:` に追記する
- ルールの有効・無効、固有名詞などの例外（各ルールの `allows`）: `hooks/lib/textlint-config.ts` の `jaOverrides` / `aiOverrides`
- 依存は `package.json` と `bun.lock` に基づき、プラグインのキャッシュ作成時に `bun install --frozen-lockfile --ignore-scripts` で自動インストールされる

## テスト

Run: `bun test --cwd ja-lint hooks/lib`
