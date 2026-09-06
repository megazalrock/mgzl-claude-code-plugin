---
name: report-plugin-issue
description: mgzl / cbo / fading-memory プラグイン自体の問題点を GitHub リポジトリ megazalrock/mgzl-claude-code-plugin の issue に起票する。引数があればその内容を、引数が無ければセッションの会話内容から問題点を抽出する。`-y` で確認をスキップ。「プラグインの問題をissueにして」「issueに起票して」「issueを立てて」などの依頼時に使用する。
argument-hint: [-y] [問題点の説明]
---

## コンテキスト

- 引数: $ARGUMENTS
- 起票先リポジトリ: `megazalrock/mgzl-claude-code-plugin`（固定）
- プラグインの実体: `common/` = mgzl プラグイン / `cbo/` = cbo プラグイン / `fading-memory/` = fading-memory プラグイン

## 引数解析

`$ARGUMENTS` から `-y` を取り除き、残りを問題点の説明として扱う。

- `-y`: 確認スキップフラグ（位置不問・任意）
  - `-y` が明示的に指定されていない場合は、絶対に確認なしで起票してはならない
- `-y` を除いた残りが空文字列 → **セッション由来モード**
- `-y` を除いた残りが非空 → **引数モード**

## gh コマンドの実行方法

以下は実測済みの制約である。`gh` を呼ぶ箇所すべてで従うこと。

1. **サンドボックス内では `gh` が失敗することがある。** macOS Keychain へのアクセスが遮断されると `tls: failed to verify certificate: x509: OSStatus -26276` や `The token in keyring is invalid.` を返す。この失敗を実際に受け取った場合に限り、同じコマンドを `dangerouslyDisableSandbox: true` で再実行してよい。
   - 失敗を観測する前に先回りして `dangerouslyDisableSandbox` を付けてはならない
   - 再実行してよいのは失敗した `gh` コマンドそのものだけで、他のコマンドに広げてはならない
   - この再実行が毎回煩わしい場合は、ユーザーが `/sandbox` で恒久的に設定できる旨を報告に添える
2. **本文は `--body-file` で渡す。** 先に本文をファイルへ書き出し、`gh issue create --body-file <パス>` を使う。本文にはバッククォートやパス記法が入るため、`--body "..."` に直接埋め込むとシェルのコマンド置換で壊れる。
3. **HEREDOC（`cat <<'EOF'`）と `$()` コマンド置換を使わない。** 本文ファイルの作成は Write ツールで行う。
4. 本文ファイルはセッションのスクラッチパッドディレクトリに置く。1 issue につき 1 ファイルとする。

## タスク

### Phase 1: 問題点の抽出

#### 引数モードの場合

1. 引数の記述を問題点の第一の情報源とする。引数に書かれた事象を、コードを読んで得た推測で置き換えてはならない
2. 引数に複数の問題点が含まれる場合は、独立して対処できる単位に分割する（1 問題点 = 1 issue）

#### セッション由来モードの場合

1. これまでの会話内容を振り返り、mgzl / cbo / fading-memory プラグイン自体の不具合・改善要望を抽出する
2. 次のものは抽出対象に含めない:
   - 作業対象プロダクトのコードの問題（プラグインの問題ではないため）
   - このセッション内で既に修正が完了したもの
   - 一度きりの環境依存トラブル（ネットワーク断など）
3. 候補が 0 件の場合は「起票対象となるプラグインの問題点は見つかりませんでした」と報告して終了する

#### 両モード共通: 記録する内容

- 記録するのは「起きた現象」と「それが起きた実行環境」である。原因の予測・仕組みの推測・修正案は行わない
- 実行環境として、会話から分かる範囲で次を拾う（分からない項目は書かない）:
  - 実行したスキル / エージェント / コマンドとその引数
  - 実行時のモード（サンドボックスの有無、auto mode の有無、サブエージェント経由か等）
  - 実際に表示されたエラーメッセージ・出力（原文のまま）
  - カレントディレクトリや対象プロジェクト、使用モデル

### Phase 2: 起票前チェック

抽出した問題点それぞれについて、以下を順に確認する。

4. **対象プラグインの判定**: 問題の所在が `common/` 配下なら mgzl、`cbo/` 配下なら cbo、`fading-memory/` 配下なら fading-memory。複数にまたがる場合はプラグインごとに issue を分割する
5. **該当箇所の特定**: 対象の SKILL.md・エージェント定義・スクリプトのリポジトリ相対パスを特定する。行番号まで分かれば併記する
6. **重複チェック**: `gh issue list --repo megazalrock/mgzl-claude-code-plugin --state all --search "<キーワード>"` で既存 issue と重複していないか確認する
   - 重複していた場合はその候補を外し、既存 issue の番号を添えてユーザーに報告する

### Phase 3: issue 案の作成

7. Phase 2 を通過した問題点ごとに、後述の形式でタイトル・ラベル・本文を作成する

### Phase 4: 確認と起票

#### `-y` が指定されていない場合

8. 作成した issue 案を全件、タイトル・ラベル・本文全文がわかる形でユーザーに提示する
9. AskUserQuestion（`multiSelect: true`）でどの issue を起票するか選ばせる
   - 各選択肢の `label` は issue タイトル、`description` は対象プラグインと種別ラベル
10. 選ばれたものだけを Phase 5 に進める

#### `-y` が指定されている場合

8. Phase 3 で作成した issue 案を全件そのまま Phase 5 に進める
9. 起票前に、これから起票するタイトルとラベルの一覧をユーザーに表示する

### Phase 5: 起票の実行

11. 対象プラグインに応じてラベルを冪等に用意する（`--force` により既存でも失敗しない）
    - `gh label create "plugin:mgzl" --repo megazalrock/mgzl-claude-code-plugin --color 1D76DB --description "mgzl プラグイン (common/) に関する issue" --force`
    - `gh label create "plugin:cbo" --repo megazalrock/mgzl-claude-code-plugin --color 5319E7 --description "cbo プラグイン (cbo/) に関する issue" --force`
    - `gh label create "plugin:fading-memory" --repo megazalrock/mgzl-claude-code-plugin --color 0E8A16 --description "fading-memory プラグイン (fading-memory/) に関する issue" --force`
12. Write ツールで本文ファイルをスクラッチパッド配下に作成する
13. `gh issue create --repo megazalrock/mgzl-claude-code-plugin --title "<タイトル>" --label "<種別ラベル>" --label "<プラグインラベル>" --body-file "<本文ファイルのパス>"` を実行する
14. 起票した issue の URL を全件ユーザーに報告する

## issue の形式

### タイトル

`[mgzl] <問題の要約>` / `[cbo] <問題の要約>` / `[fading-memory] <問題の要約>`

- 接頭辞 `[mgzl]` / `[cbo]` / `[fading-memory]` は必須
- 要約は日本語で、何がどうなるのかが 1 行で分かるように書く
- 対象のスキル名・エージェント名を要約に含める
  - 例: `[cbo] review:diff がレビュアーに差分本文を渡せず指摘0件で完了する`
  - 例: `[mgzl] commiting-to-git のコミットメッセージ例が allowed-tools と矛盾する`

### ラベル

次の 2 種類を必ず付与する。

- プラグインラベル（必須・1 つ）: `plugin:mgzl` / `plugin:cbo` / `plugin:fading-memory`
- 種別ラベル（必須・1 つ）: `bug`（動作しない・意図と違う挙動）/ `enhancement`（新機能・改善要望）/ `documentation`（記述の誤り・不足のみ）

### 本文

次のセクションを、この順序で書く。すべて省略しない。原因の予測・内部の仕組みの説明・修正案はどのセクションにも書かない。

```
## 事象
報告された、または実際に観測された事象だけを 1〜3 行で書く。エラーメッセージや出力があれば原文のまま引用する。

## 実行環境
- 実行したスキル / エージェント / コマンドと引数
- 実行時のモード（サンドボックス・auto mode・サブエージェント経由など）
- 対象プロジェクトのパス、使用モデル
（会話から分かる項目だけを書く。分からない項目は行ごと省く）

## 該当箇所
- `<リポジトリ相対パス>` L<行番号>

## 再現条件
分かっている条件を書く。特定できていない場合は「特定できていない」と書く。

## 影響
この問題によって何が困るのかを 1〜2 行で書く。
```

本文は見出しを含めて全体 25 行以内に収める。
