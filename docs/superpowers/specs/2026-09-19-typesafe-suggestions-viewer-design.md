# typesafe 提案ログビューワー 設計

作成日: 2026-09-19

## 目的

typesafe プラグインが `${CLAUDE_PLUGIN_DATA}/suggestions-v3.jsonl` に追記する提案ログを、ブラウザで眺めるためのビューワーを作る。主役は各レコードの `prompt` と、Jev が返したスキルの確率ランキングである。ログは運用中に追記され続けるので、開いたまま新着が流れ込む。

対象外: ログの集計・評価（`eval/run.ts` の領分）、ログの編集、旧版 `suggestions.jsonl` / `suggestions-v2.jsonl` の表示。

## 前提と制約

- 実装は TypeScript + bun。npm 依存も build 工程も追加しない。ブラウザ側は素の JS 1 ファイル
- ログは 1 行 1 JSON の追記専用でローテーションは無い。複数の hook プロセスが同時に追記するため、末尾行が書きかけの瞬間がある
- 1 行は平均 20KB。`calls[0].request.questions.which.criteria` に全スキルの description が毎回埋め込まれているためで、表示には不要
- レコードの型は `typesafe/hooks/lib/log.ts` の `LogRecord`。ビューワーは `LOG_FILE_NAME` だけを import し、レコードは `LogRecord` 型に頼らず `unknown` を型ガードで掘る。旧版のフックが書いた形の違う行が混ざっても落とさず捨てるため
- Claude Code の Bash サンドボックス内で `Bun.serve` を bind するには、`.claude/settings.local.json` の `sandbox.network` に `allowLocalBinding: true` と `allowedDomains` の localhost 系が必要（2026-09-19 に設定・実測済み）

## 構成

```
typesafe/viewer/
  server.ts          起動口。引数解釈、Bun.serve、SSE 配信
  index.html         画面。素の JS を同梱
  lib/records.ts     LogRecord → ViewRecord の変換（純関数）
  lib/records.test.ts
  lib/tail.ts        ファイル末尾の差分読み取り
  lib/tail.test.ts
  server.test.ts     Bun.serve を実際に立てた結合テスト
```

起動:

```
bun run typesafe/viewer/server.ts [--file <path>] [--port <n>]
```

- `--file` 既定: `~/.claude/plugins/data/typesafe-mgzl-marketplace/<LOG_FILE_NAME>`。`LOG_FILE_NAME` は `hooks/lib/log.ts` から import する
- `--port` 既定: 47391。bind するホストは `127.0.0.1`
- 起動時に `url=http://127.0.0.1:<port>/` を stdout に 1 行出す。ブラウザは自動で開かない

## ViewRecord

サーバーがブラウザへ渡す軽量化した形。`lib/records.ts` の `toViewRecord(line: string): ViewRecord | null` が 1 行から作る。JSON として読めない行、`ts` が文字列でない行は `null` を返す。

| フィールド | 元 | 備考 |
|---|---|---|
| `ts` | `ts` | そのまま |
| `session_id` / `cwd` | 同名 | そのまま |
| `event` | `event` + `tool_name` | 表示用に `UserPromptSubmit` / `PreToolUse:Bash` / `PreToolUse:Agent` の 3 値へ寄せる。想定外の `tool_name` は `PreToolUse:<tool_name>` |
| `agent_type` | `agent_type` | 無ければ省略 |
| `prompt` | `prompt` | 全文 |
| `outcome` / `winner` / `noneProbability` / `elapsedMs` / `rosterSize` | 同名 | そのまま |
| `error` | `error` | 無ければ省略 |
| `ranking` | `calls[0].response.body.answers.which.probabilities` | 確率が 0 より大きい候補だけを `{ name, probability }[]` で確率降順に並べる。`none` も同列に含める。同率は名前順。この経路が無い（`calls` が空、`response` が `null`、`body` が文字列、`answers.which.probabilities` が無い）ときは空配列 |
| `confidence` | `calls[0].response.body.answers.which.confidence` | 無ければ省略 |
| `model` | `calls[0].response.body.model` | 無ければ省略 |
| `usage` | `calls[0].response.body.usage` | `{ input_tokens, output_tokens }`。無ければ省略 |

`shortlist` と `criteria` は渡さない。`shortlist` は `ranking` の先頭 3 件（`none` を除く）と同じ情報なので不要。

## サーバー

### 初回読み込み

起動時にファイル全体を読み、改行で区切って `toViewRecord` に通し、メモリ上の `records: ViewRecord[]`（ファイル順）と `warnings: { droppedLines: number }` を作る。`null` になった行は `droppedLines` に数える。ファイルが無い場合は空のまま起動し、後述の polling で生成を待つ。

### 差分読み取り（`lib/tail.ts`）

`createTail(path)` が `{ read(): { lines: string[]; reset: boolean } }` を返す。`read()` は前回読み終えた byte offset から末尾までを読み、改行で完結した行だけを `lines` に返す。改行で終わっていない末尾の断片は内部に持ち越し、次回の読み取り結果の先頭に連結する。ファイルが無い、または size が offset より小さい（想定外の切り詰め）ときは offset と断片を 0 に戻して `reset: true` を返し、その呼び出しで先頭から読み直した結果を `lines` に入れる。起動時の全件読み込みも同じ `read()` で行う（offset 0 からの読み取りに等しい）。読み取りは `Bun.file(path).slice(offset)` ではなく `node:fs` の `openSync` / `readSync` で offset 指定して行う。

サーバーは 1 秒間隔で `statSync` により size を見て、前回と変わっていれば `read()` を呼ぶ。`fs.watch` は使わない。size の比較だけで十分に軽く、ファイル未生成の場合の扱いも単純になる。

### HTTP

- `GET /` : `index.html` を返す（`import.meta.dir` 基準で読む）
- `GET /api/records` : `{ records: ViewRecord[], warnings }` を返す。`records` はファイル順（古い順）。並べ替えはブラウザ側
- `GET /events` : SSE。新着 1 件ごとに `event: record`、`data: <ViewRecord の JSON>` を送る。切り詰めで先頭から読み直したときは `event: reset` を送り、ブラウザは `/api/records` を取り直す。接続維持のため 15 秒ごとにコメント行 `: ping` を送る
- それ以外は 404

SSE の接続は `Set<ReadableStreamDefaultController>` で保持し、切断時に外す。ブラウザが再接続したときは `EventSource` 標準の再接続に任せ、`onopen` で `/api/records` を取り直して取りこぼしを埋める。`Last-Event-ID` や `since` は持たない。

## 画面（`index.html`）

- 上部: 絞り込み chip 2 群。`event`（UserPromptSubmit / PreToolUse:Bash / PreToolUse:Agent）と `outcome`（suggested / no_fit / skipped / error）。各群は複数選択で、群内は OR、群間は AND。初期状態は全選択。右端に「最新に追従」toggle（初期 on）と件数表示（表示中 / 全体 / 捨てた行数）
- 左: 一覧。`ts` 降順。1 行に時刻（ローカル時刻、秒まで）、event の badge、outcome の badge、`winner`（無ければ `-`）、`prompt` の先頭行を 1 行に切り詰めたもの
- 右: 選択中レコードの詳細。上から `ts` / `event` / `outcome` / `winner` / `noneProbability` / `confidence` / `session_id` / `cwd` / `agent_type` / `elapsedMs` / `rosterSize` / `model` / `usage` / `error` の一覧（値が無い項目は省く）、`prompt` の全文（`pre` で折り返し）、`ranking` の表。表の各行は名前・確率（小数 2 桁）・確率の絶対値に比例した幅の bar（1.0 で全幅）。`winner` と一致する行を強調し、`none` の行は別色にする。`ranking` が空なら「API を呼んでいない」と表示
- 新着: SSE で届いたレコードを配列に加えて一覧を再描画する。「最新に追従」が on なら新着を選択して詳細も切り替える。off なら選択を保持し、一覧の先頭に差し込むだけ
- ログが空: 一覧に「まだ記録がありません」と出す。新着が届けば自然に消える
- 外部 library も CSS framework も使わない。bar は `div` の幅で描く

## エラー処理

- 壊れた行は捨てて `droppedLines` に数えるだけ。サーバーは止めない
- `--port` が bind できなければ `error=` 1 行を stderr に出して exit 1
- `--file` に指定されたパスが無くても起動し、生成を待つ
- 接続状態は header 右端の固定サイズの丸いインジケーターで示す（緑=接続中、黄=再接続中、赤=`/api/records` の取得失敗）。文言は `title` 属性にだけ入れ、画面上に文字を出さない。要素の大きさが変わらないので layout shift は起きない。SSE の再接続に伴う再取得が成功したら緑に戻す
- `Bun.serve` の `idleTimeout` は ping 間隔の 2 倍（30 秒）にする。既定の 10 秒は ping 間隔より短く、SSE が毎回アイドル判定で切断される。0（無効）にはせず、ping すら書けない死んだ接続を回収する安全網として残す

## テスト

`bun test --cwd typesafe` に載る。

- `lib/records.test.ts`: 実ログ形式の `suggested` / `no_fit` / `skipped` / `error` の 4 行と、JSON 不正行、`response` が `null` の行で `toViewRecord` を検証する。`ranking` が確率降順・0 を除外・`none` を含むこと、`event` が 3 値に寄ること、不正行が `null` になることを見る
- `lib/tail.test.ts`: 一時ディレクトリのファイルに追記しながら `read()` を繰り返し、完結行だけが返ること、半端行が次回に連結されること、ファイル未生成から生成への遷移、切り詰め後に先頭から読み直すことを検証する
- `server.test.ts`: `port: 0` で実際に起動し、`/api/records` の形、`/events` に追記が `record` として届くこと、`/` が HTML を返すことを検証する。サンドボックス内でも前提の設定により通る

## ドキュメント

- `typesafe/README.md` に「ビューワー」節を追加し、起動コマンド・引数・画面の要点を書く
- 同 README の「テスト」節にある「サンドボックス内ではポートを bind できない」の記述を、`sandbox.network.allowLocalBinding` と `allowedDomains` の設定で通る旨に改める

## 決めたこと

- 全候補の確率（非ゼロのみ）を主役にする。`shortlist` は渡さない
- 絞り込みは event と outcome の 2 軸。session_id と文字列検索は初期版に含めない
- 新着検知は 1 秒の size polling のみ。`fs.watch` は併用しない
- 再接続時の取りこぼしは全件取り直しで埋める。差分同期は持たない
- ブラウザは自動で開かない
