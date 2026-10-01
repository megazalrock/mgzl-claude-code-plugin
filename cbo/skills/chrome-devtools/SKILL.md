---
name: chrome-devtools
description: chrome-devtools / chrome-devtools-headless MCP サーバーのツール（navigate_page, new_page, evaluate_script, click, fill_form, take_snapshot, handle_dialog, list_pages など）を初めて呼ぶ前に必ず読み込む知見集。ユーザーの明示的な依頼がなく、実装計画のステップや検証作業の流れでブラウザ確認を始める場合も対象。読まずに操作すると beforeunload / confirm の dialog で evaluate_script などが応答せずタイムアウトする。headed と headless の使い分け（ログイン状態、`The browser is already running` への対処）、dialog の handle_dialog での処理、HMR の full reload で出る beforeunload への対処、snapshot の uid の扱い、console・network の調査手順を状況別にまとめている。「ブラウザで動作確認して」「画面を開いて確認して」「chrome-devtoolsで再現して」「ダイアログで止まった」などの依頼時にも使用する。
---

# chrome-devtools

chrome-devtools-mcp でブラウザを操作するときの「こういう時はこうする」集。手順書ではないので、該当する状況の項目だけ参照すればよい。項目は「状況 / 原因 / 対処」の形で追記していく。

## 原則

- レスポンスに `# Open dialog` が含まれていたら、他の操作より先に `handle_dialog` を呼ぶ
- uid は直近の `take_snapshot`（または `includeSnapshot: true` で得た snapshot）のものだけを使う。古い snapshot の uid は使い回さない
- 画面の確認は `take_screenshot` より `take_snapshot` を優先する。見た目（レイアウト崩れ・色）を確認したいときだけ screenshot を使う

## headed / headless の使い分け

cbo プラグインは同じ chrome-devtools-mcp を 2 つの MCP サーバーとして登録している。ツールは同名なので、どちらのサーバーのツールを呼ぶかで使い分ける。

- `chrome-devtools`（headed）: ウィンドウが表示される
- `chrome-devtools-headless`（`--headless`）: ウィンドウを出さずに裏で動く

### どちらを使うか

- headed を使う
  - ログインが必要で、まだログイン済みの状態がない。headless には画面がないので、ユーザーが手動でログインできない
  - ユーザーに画面を見せながら確認したい、ユーザーに手で操作してもらう必要がある
- headless を使う
  - ログイン済みの状態があり、ユーザーの作業画面を邪魔せずに動作確認だけしたい
  - 見た目の確認が必要なら headless でも `take_screenshot` は使える

### ログイン状態を headless に引き継ぐ

- 両サーバーとも `--isolated` や `--user-data-dir` を付けていない。そのため同じ既定プロファイル（`~/.cache/chrome-devtools-mcp/chrome-profile`）を使い、Cookie やログイン状態は共有される
- 手順: headed でユーザーにログインしてもらう → headed のブラウザを閉じる → headless のツールを呼ぶ
- ログイン済みの状態がない、またはセッションが切れていたら、headless で fill_form などでログインを試みず、headed に切り替えてユーザーにログインしてもらう

### `The browser is already running for ... Use --isolated to run multiple browser instances.` で起動しない

- 原因: 同じプロファイルを使うブラウザが既に起動している。headed と headless を同時に起動できない。別セッションで同じサーバーのブラウザが動いている場合も同じエラーになる
- 対処: 起動中のブラウザを閉じてもらうようユーザーに依頼する。headed ならウィンドウを閉じてもらえばよい
  - `--isolated` で回避しない。一時プロファイルになりログイン状態が失われる

## JavaScript dialog

### ソースを編集した直後、突然 `A dialog is open (beforeunload: ...)` で失敗する

- 原因: 未保存の入力がある編集画面でソースを編集すると、Vite の HMR が full reload（`location.reload()`）を行う。その際にアプリの beforeunload ハンドラが離脱確認 dialog を出す
  - reload は `navigate_page` 経由ではないので `handleBeforeUnload` は効かない
  - dialog はツール呼び出しの結果ではなく、ファイル編集のタイミングで出ている
  - chrome-devtools-mcp はページ初期化時から `page.on('dialog')` を常時登録している。そのためツール外で出た dialog も検知され、以降の click や take_snapshot がこのエラーで止まる
- 対処: 原則 `handle_dialog` で `accept` する。目的は新しいコードを読み込むことなので、フォーム入力が消えるのは想定どおり。必要なら入力し直す
  - `dismiss` すると reload が中止され、古いコードのまま画面が動き続ける。その状態で得た検証結果は信用できない
- 予防: ブラウザを開いたままソースを編集した後は、dialog があっても動く `list_pages` などで先に `# Open dialog` の有無を確認してもよい

### beforeunload そのものが検証の邪魔になる

- 前提: 検証したいのが離脱確認そのものではない場合に限る。離脱確認の挙動を確認したいときは無効化しない
- 対処: `navigate_page` の `initScript` で beforeunload ハンドラを無効化してから開く

```js
(() => {
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'beforeunload') return;
    return orig.call(this, type, ...rest);
  };
  Object.defineProperty(window, 'onbeforeunload', { configurable: true, get: () => null, set: () => {} });
})();
```

- 制約: `initScript` は `evaluateOnNewDocument` で登録される。そして `navigate_page` の完了後に `removeScriptToEvaluateOnNewDocument` で解除される
  - 効くのはその 1 回の navigation で作られる document だけで、後から起きる HMR の full reload や別の navigation には引き継がれない
  - reload が起きるたびに、`navigate_page`（`type: "reload"` など）に同じ `initScript` を付けて掛け直す必要がある
  - HMR の reload が頻発する作業では効果が薄い。その場合は前項のとおり dialog を accept する運用のほうが確実

### 削除・破棄ボタンや Vue Router の離脱ガードで confirm が出る

- 原因: アプリ内の遷移や破壊的操作の確認で、click の想定どおりの結果
- 挙動: v1.10.0 以降は click が成功扱いで `The element was clicked and it opened a dialog.` と返り、`# Open dialog` が付く
- 対処: 検証したい分岐に合わせて `accept` / `dismiss` を選ぶ。実データに対する破壊的操作で判断に迷うなら `dismiss` してユーザーに確認する

### evaluate_script でボタンを押したら確認なしで実行されてしまった

- 原因: `evaluate_script` は `dialogAction` の既定値が `accept` で、実行中に出た dialog を自動で accept する
- 対処: dialog が出うる操作には `evaluate_script` を使わず `click` を使う。どうしても使うなら `dialogAction` に `"dismiss"`、または prompt への入力文字列を明示する

### navigate_page でページを離れる

- `handleBeforeUnload`（`accept` | `dismiss`、既定 `accept`）でその navigation 中の beforeunload を自動処理する
- 処理した場合はレスポンスに `Accepted a beforeunload dialog.`（または `Dismissed ...`）と出る

### handle_dialog が `No open dialog found` を返す

- 原因: MCP 側で既に処理済み（`handle_dialog` / `navigate_page` / `evaluate_script` が処理してクリア済み）
- 対処: `take_snapshot` して現在の状態を確認し、そのまま続ける
- 補足: ユーザーがブラウザ上から手動で閉じた場合は内部状態が残り、`# Open dialog` が表示され続けることがある。そのときは `handle_dialog` を呼べば成功扱いとなりクリアされる

### fill_form が途中で止まる

- 症状: `Filling out the element with uid X opened a dialog. The remaining elements were not filled out.`
- 対処: `handle_dialog` で処理してから、残りの要素だけ `fill_form` し直す

### dialog が開いている間に使えるツール / 使えないツール

- 使える
  - dialog 処理: `handle_dialog`
  - ページ操作: `list_pages`, `select_page`, `new_page`, `close_page`, `navigate_page`
  - 調査: `list_console_messages`, `get_console_message`, `list_network_requests`
- 使えない（`A dialog is open` で失敗）
  - 入力: `click`, `fill`, `fill_form`, `hover`, `press_key`, `type_text`
  - 取得: `take_snapshot`, `take_screenshot`, `evaluate_script`, `wait_for`, `get_network_request` など

### click が handle_dialog に言及する分かりにくいエラーでタイムアウトする

- 原因（推定）: chrome-devtools-mcp が v1.10.0 未満。dialog を開く click がタイムアウト扱いになる不具合があり、PR #2794 で修正された
- 対処: ユーザーに chrome-devtools-mcp の更新を提案する。その場では `handle_dialog` で処理して続行する

## 要素の操作

### uid が見つからない / 操作対象が違う要素になる

- 原因: navigation や再描画で snapshot が古くなっている
- 対処: `take_snapshot` を取り直し、新しい uid を使う

### フォームに入力する

- 複数項目は `fill` / `click` を並べず `fill_form` で一度に入力する
- checkbox / toggle の値は `"true"` / `"false"`、radio は `"true"`

### 往復を減らしたい

- `click` / `fill` / `fill_form` などに `includeSnapshot: true` を付けると、操作後の snapshot がレスポンスに含まれる
- `take_snapshot` を別に呼ばずに済む

### 画面遷移や非同期表示を待ちたい

- `wait_for` に期待するテキストを配列で渡す。いずれか 1 つが出た時点で完了し、snapshot が返る
- 入力系ツールは操作後の navigation / network / DOM の安定を自動で待つので、通常は追加の待機は不要

### take_screenshot がエラーになる

- `uid`（要素単位）と `fullPage: true` は同時に指定できない。どちらか一方にする

## 不具合の調査

### console のエラーを確認したい

- `list_console_messages` で一覧を取り、`types` で `error` などに絞る。詳細は `get_console_message` で見る
- 一覧は直近の navigation 以降が対象。HMR の reload 前のログを見たいときは `includePreservedMessages: true`（直近 3 回の navigation 分）を付ける

### API のリクエスト・レスポンスを確認したい

- `list_network_requests` で一覧を取り、`resourceTypes`（`fetch` / `xhr` など）で絞る。reload をまたぐなら `includePreservedRequests: true`
- body やヘッダは `get_network_request` で見る（dialog が開いている間は使えない）

### 画面の状態を読み取りたい

- 値の読み取りだけなら `evaluate_script` に `waitForStableDom: false` を付けて、DOM 安定待ちを省く
- 状態を変更する操作や dialog が出うる操作には使わない（前述の `dialogAction` 既定 accept のため）

## ページ・タブ

### 意図しないページを操作している

- `list_pages` で一覧を確認し、`select_page` で対象を選び直す

### ページを閉じられない

- 最後の 1 ページは `close_page` で閉じられない。別のページを開いてから閉じるか、`navigate_page` で遷移させる
