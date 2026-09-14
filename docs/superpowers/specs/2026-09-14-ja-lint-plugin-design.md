# ja-lint プラグイン設計書

作成日: 2026-09-14

## 目的

Claude Code が書く日本語（ソースコード内コメント、コミットメッセージ、PR のタイトルと本文）を textlint で機械的に検査し、違反を Claude に返して自己修正させる。

対象外: Claude の応答文そのもの、Markdown ファイルの本文、人間が直接書いた文章。

## 前提と決定事項

- 新規プラグイン `ja-lint/` として切り出す。mgzl / cbo には手を入れない
- 依存は `ja-lint/package.json` と `ja-lint/bun.lock` を置き、Claude Code のプラグインキャッシュ複製時の自動インストール（`bun install --frozen-lockfile --ignore-scripts`）に任せる。SessionStart でのインストールや `${CLAUDE_PLUGIN_DATA}` は使わない
- hook の挙動は severity `error` を block、`info` を advisory（additionalContext）とする
- 文末の句点「。」は PR 本文のみ必須。コメント・コミットメッセージ・PR タイトルでは要求しない
- Edit / Write の対象はコード内コメントのみ。Markdown ファイルは対象外
- prh の辞書は `prh` npm パッケージ（MIT）に同梱されている技術書向け辞書 `prh-rules/media/WEB+DB_PRESS.yml` を `rules/prh.yml` の `imports` から参照する。prh/rules リポジトリにはライセンス表記が無いため、リポジトリからの直接コピーはしない
- プロジェクト側から設定を上書きする仕組みは持たない

## ディレクトリ構成

```
ja-lint/
  .claude-plugin/plugin.json      name, description のみ（version は持たない）
  package.json                    textlint, preset-ja-technical-writing, preset-ai-writing, prh
  bun.lock                        自動インストールの発火条件
  hooks/hooks.json                PreToolUse(Bash), PostToolUse(Edit|Write)
  hooks/pre-bash.ts               git commit / gh pr のコマンドから本文を取り出して lint
  hooks/post-edit.ts              Edit の new_string / Write の content からコメントを抽出して lint
  hooks/lib/textlint-config.ts    文脈別（comment / commit / pr）の descriptor
  hooks/lib/lint.ts               lintText の薄いラッパー。error / info に分けて返す
  hooks/lib/comments.ts           拡張子別のコメント抽出と追加行の判定
  hooks/lib/commands.ts           -m / -F / --title / --body / --body-file / heredoc の解析
  hooks/lib/hook-io.ts            stdin の JSON 読み込みと block / advisory の出力整形
  rules/prh.yml                   表記ゆれ辞書
  README.md
```

`.claude-plugin/marketplace.json` の `plugins` 配列に ja-lint を 1 件追記する。

`.textlintrc` は置かない。文脈ごとにルール構成が異なるため、`textlint-config.ts` で `TextlintKernelDescriptor` を 3 つ組み立てる。

hooks.json のコマンドは既存の fading-memory と同じ形式にする。

```json
"command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/post-edit.ts\"",
"timeout": 30
```

## データフロー

### PostToolUse（Edit / Write）

1. stdin の JSON から `tool_name` と `tool_input` を読む
2. `tool_input.file_path` の拡張子が対象外なら何も出力せず exit 0
3. 検査対象の行を決める
   - Edit: `old_string` と `new_string` を行に分割し、`new_string` にあって `old_string` に無い行（多重集合の差）を「追加行」とする
   - Write: `content` の全行
4. 追加行から日本語を含むコメント行を抽出する（後述）。0 件なら exit 0
5. comment 文脈で lint する
6. error が 1 件以上あれば `{"decision": "block", "reason": <理由文>}` を stdout に出す。error が無く info だけなら `hookSpecificOutput.additionalContext` に理由文を入れる。どちらも無ければ何も出さない

### PreToolUse（Bash）

1. stdin の JSON から `tool_input.command` を読む
2. コマンドを分類する。`git commit` でも `gh pr create` / `gh pr edit` でもなければ exit 0
3. 検査対象の文字列を取り出す
   - `git commit`: すべての `-m` / `--message` の値を空行で連結したもの。`-F` / `--file` があればそのファイルを読む。`-m` の値が `"$(cat <<'EOF' ... EOF)"` 形式なら heredoc の本文を取る。どちらも無ければ exit 0
   - `gh pr create` / `gh pr edit`: `--title` / `-t` の値と、`--body` / `-b` の値または `--body-file` / `-F` のファイル内容
4. コミットメッセージと PR タイトルは commit 文脈、PR 本文は pr 文脈で lint する
5. error が 1 件以上あれば `hookSpecificOutput` に `permissionDecision: "deny"` と `permissionDecisionReason` を入れて返す。info だけなら `additionalContext`。どちらも無ければ何も出さない

### 共通の早期終了

検査対象の文字列にひらがな・カタカナ・漢字（`\p{sc=Hiragana}` / `\p{sc=Katakana}` / `\p{sc=Han}`）が 1 文字も無ければ、textlint を import する前に exit 0 する。kuromoji の辞書読み込みが 1〜2 秒かかるため、日本語を含まない編集で待たせないためである。

## ルール構成

### 共通（3 文脈すべて）

- `textlint-rule-preset-ja-technical-writing`（スコープ無し）: 既定値。ただし `ja-no-mixed-period` は pr 文脈のみ有効
- `textlint-rule-prh`: `rules/prh.yml` を全文脈で有効
- severity はいずれも error

### comment 文脈

- 共通 + `@textlint-ja/textlint-rule-preset-ai-writing` の `no-ai-hype-expressions` のみ error で有効
- Markdown 構造を見る残り 4 ルール（list-formatting / emphasis-patterns / colon-continuation / tech-writing-guideline）は入れない

### commit 文脈（コミットメッセージ全体、PR タイトル）

- comment 文脈と同じ構成
- Conventional Commits の接頭辞（`feat:` 等）は英語のため日本語ルールに当たらない

### pr 文脈（PR 本文）

- 共通（`ja-no-mixed-period` 有効）+ preset-ai-writing の 5 ルール全部
- `ai-tech-writing-guideline` のみ info 扱いにする。このルールは textlint の `severity` オプションが効かない（プレーンオブジェクトで報告するため kernel が error に固定する）ことが実測で判明しているので、lint.ts 側で ruleId を見て info に分類する

### 例外の扱い

- 固有名詞などの例外は `textlint-config.ts` 内の各ルールの `allows` 配列に書く
- prh の項目調整は `rules/prh.yml` を直接編集する

## コメント抽出（comments.ts）

行ベースの正規表現で抽出する。AST は使わない。

拡張子とコメント記法の対応:

- `//` と `/* */`: ts, tsx, js, jsx, mjs, cjs, vue, php, css, scss, go, rs, java, kt, swift
- `#`: yml, yaml, sh, bash, zsh, py, rb, toml, php
- `<!-- -->`: vue, html
- `--`: sql
- 上記以外の拡張子は対象外

処理:

- ブロックコメント内の各行は先頭の `*` を除去する
- JSDoc / PHPDoc の `@param` 等のタグ行は、タグと識別子を除いた説明部分だけを対象にする
- コメント記号を取り除いた上で、連続するコメント行は 1 段落（改行区切りではなく連結）にまとめる。行をまたぐ `no-doubled-joshi` 等が正しく判定されるため
- 日本語を含まない行は除外する

既知の限界:

- 文字列リテラル内の `//` や `#`（URL 等）をコメントと誤認しうる。日本語を含まなければ無視されるため、実害は「日本語を含む文字列リテラル内に `//` がある」場合に限られる。堂々巡りになった場合は `allows` に逃がす

## 出力形式（hook-io.ts）

block / advisory いずれも同じ理由文を使う。

```
ja-lint: 日本語の文章に修正が必要です（error 2 件）
- 「ユーザーの情報を取得を行う」 [ja-technical-writing/no-doubled-joshi] 一文に同じ助詞「を」が2回使われています
- 「サーバから」 [prh] サーバ => サーバー

参考（info 1 件）
- 「〜」 [ai-writing/ai-tech-writing-guideline] 〜
```

- 引用は指摘位置を含む文（句点または行末まで）とし、長い場合は前後を省略記号で切り詰める
- 行番号は出さない。Edit の `new_string` からはファイル上の行番号が分からないため、引用で位置を示す

## エラー処理

原則: hook 自身の不調でツール実行を止めない。

- textlint や辞書の読み込み失敗、stdin の JSON 不正、想定外の例外はすべて捕捉し、stderr に 1 行残して exit 0（何も返さない）
- `node_modules` が無い（プラグインの自動インストールが走らなかった）場合も同様に通し、stderr に「依存が未インストール」と出す
- hooks.json の timeout は 30 秒

## テスト

bun test で `hooks/lib/` を単体テストする。

- comments.ts: 拡張子ごとの抽出、ブロックコメントの `*` 除去、JSDoc タグの扱い、連続行の結合、Edit の追加行判定、日本語を含まない行の除外
- commands.ts: `-m` 複数指定、heredoc、`-F`、`--title`、`--body` / `--body-file`、対象外コマンドの判定
- textlint-config.ts + lint.ts: 各文脈でサンプル文が期待通りに鳴る / 鳴らない。句点なしの文が comment / commit 文脈で通り pr 文脈で止まる、guideline が pr 文脈で info になる、prh が全文脈で効く
- hook 本体（pre-bash.ts / post-edit.ts）は stdin に JSON を流す手動の疎通確認とし、自動テストは lib 側に寄せる

## 将来の拡張（今回は実装しない）

- Markdown ファイル本文の lint（拡張子を追加し pr 文脈で全文を検査）
- 対象プロジェクトに `.textlintrc` があればそちらを優先する上書き機構
- `preset-ja-spacing` の追加
