---
name: markdown-to-html
description: 指定された Markdown ファイル群を見やすい単一の HTML に整形して一時ディレクトリへ保存し、保存先のクリッカブル URL を表示する。「MarkdownをHTMLに」「mdをhtmlに変換」「markdown to html」などの依頼時に使用する。
argument-hint: <markdown-file>...
allowed-tools: Bash(test:*), Bash(date:*), Bash(basename:*), Bash(wc:*), Read, Write
disable-model-invocation: true
---

## コンテキスト

- 引数: `$ARGUMENTS`
- タイムスタンプ: !`date +%Y%m%d-%H%M%S`

## タスク

引数として渡された 1 つ以上の Markdown ファイルを読み込み、Claude 自身が内容を解釈して **見やすい単一の HTML** に整形・保存し、最後に保存先パスをクリッカブルな `file://` URL で提示する。外部 CSS や JavaScript には一切依存させない（すべてインラインで完結させる）。

## ワークフロー

### Step 1: 引数の解析と検証

1. `$ARGUMENTS` を空白区切りで分割し、Markdown ファイルパスのリストを得る。シェルクォートを尊重する
2. リストが空であれば、以下を表示して**即時終了**する:
   > 使用法: `/markdown-to-html <markdown-file>...`
   > 少なくとも 1 つの Markdown ファイルパスを指定してください。
3. 各パスについて `test -f <path>` で存在を確認する。存在しないものがあれば一覧で報告し、ユーザーに続行可否をテキストで簡潔に確認する
4. 拡張子が `.md` / `.markdown` 以外のファイルが含まれていれば警告のみ表示し、処理は続行する

### Step 2: 保存先ディレクトリの決定

**重要**: ディレクトリの実在を理由に保存先を決めてはいけない。必ずプロジェクトの明文化された指示を根拠にする。

1. プロジェクトの指示を確認する
   - `${CLAUDE_PROJECT_DIR}/CLAUDE.md` が存在すれば Read で読み、「一時ファイル」「temp」「tmp」「temporary」「キャッシュ」などの語が含まれており、**明示的に一時ファイル保存先のディレクトリが指定されているか**を判定する
   - 必要に応じて `${CLAUDE_PROJECT_DIR}/README.md` も同様に確認する
2. 上記の明示的指示が見つかった場合、そのディレクトリ（絶対パスへ正規化）を保存先とする。指定先が存在しない場合はユーザーに作成可否を確認する
3. 明示的指示が見つからない場合は **`${TMPDIR:-/tmp}`** を保存先とする
4. いずれの場合も、なぜその場所を選んだか（指示の引用、または「指示が無いため `$TMPDIR` を使用」）を Step 7 の報告に含める

### Step 3: 出力ファイル名の決定

- 最初の Markdown ファイルの basename（拡張子を除いたもの）を `<base>` とする
- 複数指定時も `<base>` のみを使用する（接尾辞は付けない）
- 「コンテキスト」セクションで取得済みのタイムスタンプ (`YYYYMMDD-HHMMSS`) を使用し、最終ファイル名を **`<timestamp>-<base>.html`** とする
- フルパス: `<保存先>/<timestamp>-<base>.html`（必ず絶対パスで扱う）

### Step 4: Markdown の読み込み

各ファイルを `Read` で全文取得する。ファイルサイズが極端に大きい場合（例: 数千行）でも省略せず読み込む。

### Step 5: HTML の組み立て

外部依存なしで完結する単一の HTML ドキュメントを構築する。以下の要件を満たすこと。

#### 5-1. 基本構造

```
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><base> - Markdown Preview</title>
  <style>/* インラインCSS（後述） */</style>
</head>
<body>
  <header><h1><base></h1><p class="meta">Generated: <timestamp></p></header>
  <nav id="toc"><!-- 目次 --></nav>
  <main>
    <!-- 各 Markdown を <article> として連結 -->
  </main>
</body>
</html>
```

#### 5-2. 視認性のための CSS 要件（インライン `<style>` で実装）

- フォント: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans JP", sans-serif`
- 本文の最大幅: 約 820px、中央寄せ、左右に十分なパディング
- 配色: 白背景・濃いグレー文字（`#24292f` 系）。リンクは GitHub 風の青（`#0969da` 系）
- 見出し階層は h1〜h6 で明確に視覚差を付ける。h1/h2 は下線（薄いボーダー）を引く
- `code` インライン: 薄い背景色 + 等幅フォント + わずかな padding
- `pre > code` ブロック: 薄いグレー背景、角丸、横スクロール可、等幅フォント
- `blockquote`: 左に太い縦線、薄い文字色
- `table`: ボーダー付き、ヘッダー行に背景色、行のホバーで微妙に背景色変更
- `hr`: 細く薄い線
- 画像: `max-width: 100%`
- 目次 (`#toc`): 上部に配置。各リンクは該当見出しへのアンカー
- ダークモード対応: `@media (prefers-color-scheme: dark)` で背景・文字色を反転（コードブロック・テーブルも追従）

#### 5-3. Markdown → HTML 変換ルール

外部ライブラリは使わず、Claude が以下を解釈して相応の HTML タグへ変換する。

| Markdown 記法 | 出力 HTML |
|---|---|
| `# 〜 ######` | `<h1>` 〜 `<h6>`（`id` 属性を slug 化して付与し、目次からリンク可能にする） |
| 段落 | `<p>` |
| `**強調**` / `*斜体*` | `<strong>` / `<em>` |
| `` `code` `` | `<code>` |
| ```` ```lang ... ``` ```` | `<pre><code class="language-lang">`（**HTML エスケープ必須**） |
| `> quote` | `<blockquote>` |
| `- item` / `1. item` | `<ul><li>` / `<ol><li>` |
| `- [ ]` / `- [x]` | チェックボックス付き `<li>`（input は `disabled`） |
| `[text](url)` | `<a href="url" rel="noopener noreferrer">text</a>`（外部 URL の場合は `target="_blank"`） |
| `![alt](src)` | `<img alt="alt" src="src">` |
| `---` / `***` | `<hr>` |
| GFM テーブル | `<table><thead>...</thead><tbody>...</tbody></table>` |
| 取り消し線 `~~text~~` | `<del>` |
| 脚注 `[^1]` | アンカー付きの `<sup>` 参照と末尾の脚注リスト |

**重要**:
- コードブロック・インラインコード内では `<`, `>`, `&` を必ずエスケープする（`&lt;`, `&gt;`, `&amp;`）
- それ以外のテキスト本文中の `<`, `>`, `&` も同様にエスケープする
- 既に `<script>` などの生 HTML が Markdown に含まれていても**実行可能な形では出力しない**（テキストとしてエスケープ表示する）

#### 5-4. 複数ファイルの連結

複数の Markdown が指定された場合、入力順に以下を行う:

1. 各 MD を `<article class="doc" id="doc-<n>">` でラップする（`<n>` は 1 始まりの連番）
2. 各 `<article>` の先頭に `<header class="doc-header"><h1 class="doc-title">📄 <相対パスまたはbasename></h1></header>` を入れる
3. `<article>` 間は `<hr class="doc-separator" />` で区切る
4. 目次 `#toc` には、各ドキュメントのタイトルと、その配下の h2 までの見出しをネストして含める

> 注: ドキュメント間で見出し id が衝突しないよう、id は `doc<n>--<slug>` のように prefix を付ける。

### Step 6: ファイル保存

組み立てた HTML を `Write` ツールで **絶対パス** に書き込む。

### Step 7: 結果報告

以下の形式で表示する。最後の URL 行は端末がリンクとして認識できるよう **`file://` 形式の絶対パス単独** の行にする。

```
✅ HTML を生成しました

- 入力: <ファイル数>件
- 保存先決定理由: <プロジェクト指示の引用 または「プロジェクト指示が無いため $TMPDIR を使用」>
- 出力: <絶対パス>
- サイズ: <bytes> bytes

開く: file://<絶対パス>
```

サイズは `wc -c <path>` などで取得する。取得できない場合は省略してよい。

## 補足事項

### 一時ディレクトリの判定方針

- プロジェクトの CLAUDE.md / README.md などで**明文化された一時ファイル保存先の指定がある場合に限り**、その場所を使用する
- ディレクトリが実在することだけを根拠に `tmp/` `.tmp/` などを採用してはいけない（別用途で使われている可能性があるため）
- 明示的指示が無ければ `${TMPDIR:-/tmp}` を使用する（macOS では `/var/folders/...` 配下の安全なユーザー一時領域）

### クリッカブル URL について

多くの端末エミュレータは `file:///absolute/path` 形式を Cmd+クリック / Ctrl+クリックで開けるリンクとして認識する。`file:` の後ろは必ず 3 つのスラッシュ + 絶対パスとなることに注意（`file://` ＋絶対パス先頭の `/` の合計）。

### 外部依存禁止

- `<link rel="stylesheet">` や `<script src="...">` を**一切含めない**
- すべての CSS は `<head>` 内の `<style>` に書く
- 数式や図解の高度なレンダリング（KaTeX / Mermaid 等）は本スキルの対象外。素のテキスト・コードブロックとして表示する
