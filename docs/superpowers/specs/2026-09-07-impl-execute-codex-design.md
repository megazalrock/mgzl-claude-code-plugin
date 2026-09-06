# impl__execute-codex 設計書

作成日: 2026-09-07

## 目的

`cbo/skills/impl__execute` と同じ実装計画書を、Claude のサブエージェントではなく Codex CLI（GPT-6 Astra、reasoning effort low）に 1 ステップずつ実装させるスキルを追加する。
「Codex がどの程度実装に使えるか」を運用で評価するための実験用スキルであり、評価が終われば削除される可能性がある。そのため既存スキルには手を入れず、ディレクトリごと消せる独立した形で作る。

## スコープ

- 対象: `cbo/skills/impl__execute-codex/` の新設（SKILL.md、`scripts/`、`references/`）
- 対象外: `impl__execute` の変更、`cbo/agents/` の変更、codex プラグイン（`codex:*` スキル、`codex-rescue` エージェント）の利用

## 役割分担

- Codex が行うこと
  - 計画書の各ステップの実装（本体コード、テストコードとも）
  - レビュー指摘を元にした修正
  - ミューテーションテストで生き残ったミュータントに対するテスト追加
- Claude が行うこと（既存 `impl__execute` と同じエージェントを使う）
  - 計画書の読み取り、ステップの選定、進捗管理（チェックボックス更新）
  - `@mutation-tester` によるミューテーションテスト
  - `@reviewer-for-*` によるレビュー
  - 完了処理と報告

## 全体フロー

`impl__execute/SKILL.md` のタスク 1〜4（計画書の特定、概要確認、ステップと依存関係の読み取り、レビューベースラインの記録）はそのまま流用する。差分は以下。

1. **前提チェック（タスク 1 の前）**: `${CLAUDE_SKILL_DIR}/scripts/check-codex.ts` を実行する。`status=ng` なら理由を報告して即座に停止する。
2. **ステップ実行（タスク 5 相当）**: 未完了ステップを依存順に **直列** で 1 つずつ `${CLAUDE_SKILL_DIR}/scripts/run-codex-step.ts` に渡す。並列グループやチーム実行フロー（5-A）は使わない。
   - `status=ok` なら計画書のチェックボックスを `[x]` にする。
   - `status=error` なら計画書は更新せず、理由を報告して停止する。
3. **ミューテーションテスト（タスク 7 相当）**: 既存どおり `@mutation-tester` を直列起動する。生存ミュータントがあれば、テスト追加の依頼文を作って `run-codex-step.ts` に `--role test` で渡す。再検証ループは既存と同じく最大 2 回。
4. **レビュー（タスク 8 相当）**: 既存どおり `@reviewer-for-*` を並列起動する。修正が必要な指摘は、指摘内容をまとめた依頼文を `run-codex-step.ts` に `--role impl` で渡す。再レビューループは既存と同じく最大 2 回。
5. **完了処理（タスク 9〜10 相当）**: 既存と同じ。

ステップ実行中に Codex が使用不能になった場合（前提チェックは通ったが実行時に失敗した場合）も、Claude エージェントでの実装にフォールバックせず停止する。

## スクリプト

すべて TypeScript、`bun run` で実行する。出力は key=value 形式（1 行 1 項目）とし、Markdown 表は使わない。

### `scripts/check-codex.ts`

- PATH 上の `codex --version` を実行する。mise 等の迂回はしない。
- 成功: `status=ok` と `version=<バージョン>`
- 失敗: `status=ng` と `reason=<not_found | exec_failed>`、`detail=<stderr 先頭行>`

### `scripts/run-codex-step.ts`

引数:

- `--prompt <ファイル>`: Codex に渡す依頼文本体（ステップ本文、レビュー指摘など）
- `--cwd <ディレクトリ>`: 対象プロジェクトのルート。Codex の `-C` と書き込み範囲になる
- `--role <impl | test>`: 先頭に連結する規約ヘッダの選択

処理:

1. `references/codex-header-impl.md` または `references/codex-header-test.md` を読み、`--prompt` の内容と連結して一時ファイルに書き出す。一時ファイルは `$TMPDIR` 配下に置く。
2. 以下のコマンドを実行する。モデルと effort はスクリプト内の定数として固定し、引数で変更できないようにする。

```
codex exec \
  -m gpt-6-astra \
  -c model_reasoning_effort=low \
  -s workspace-write \
  -C <cwd> \
  --skip-git-repo-check \
  --disable skill_search \
  --json \
  -o <最終メッセージファイル> \
  - < <連結したプロンプトファイル>
```

3. `--json` の JSONL イベントを読み、`type` が `error` または `turn.failed` のイベントを集める。実測では、不正なモデル指定時に `{"type":"error","message":...}` と `{"type":"turn.failed","error":{...}}` が出て終了コード 1 になる。`item.completed` の `item.type: "error"` は警告扱いで、それ単独では失敗にしない。
4. 変更ファイルは JSONL からは取れない（ファイル操作は `command_execution` イベントのシェルコマンドとして現れるだけ）。実行前後に `git status --porcelain` を取り、差分で変更ファイルを求める。
5. 出力:
   - 成功: `status=ok`、`changed_files=<カンマ区切り>`、`last_message_file=<パス>`、`summary=<最終メッセージ先頭行>`
   - 失敗: `status=error`、`reason=<nonzero_exit | error_event | no_last_message | no_changes | git_failed>`、`detail=<原因の要約>`

失敗判定:

- 終了コードが非 0
- JSONL に `type: "error"` または `type: "turn.failed"` のイベントがある（認証切れ、利用上限、API 障害はここで拾える）
- 最終メッセージファイルが生成されない
- 変更ファイルが 0 件（Codex が「実装できない」と判断して終えた場合。エラーにはならないので明示的に検出する）
- `git status` が失敗した（対象が git 管理外）

### サンドボックスに関する制約

Claude Code の Bash サンドボックス内で `codex exec` を実行すると `failed to initialize in-process app-server client: Operation not permitted` で即座に失敗する（実測）。SKILL.md からスクリプトを呼ぶ Bash 呼び出しはサンドボックスを無効化する必要がある。SKILL.md にその旨を明記する。テストコードで使う偽の codex はこの制約を受けない。

### テスト用の差し替え

環境変数 `IMPL_EXECUTE_CODEX_BIN` が設定されていれば、その値を空白で分割したコマンドを `codex` の代わりに使う（例: `bun run /path/fake-codex.ts`）。テスト専用であり、SKILL.md からは設定しない。モデルと effort の固定はこの差し替えの影響を受けない。

## 規約ヘッダ（`references/`）

- `codex-header-impl.md`: `cbo/agents/code-implementer.md` の本文から、対象プロジェクトのコード規約・禁止事項・完了条件（テスト実行、型チェック）を抜粋して書き起こす。Claude 固有の記述（ツール名、SendMessage による報告手順など）は含めない。
- `codex-header-test.md`: 同様に `cbo/agents/test-implementer.md` から抜粋する。
- どちらも末尾に「作業完了時は変更したファイルの一覧と、実施した検証コマンドとその結果を最終メッセージに書くこと」を指示する。`run-codex-step.ts` の `summary` と、Claude 側の報告に使う。

## SKILL.md

- `name`: `impl__execute-codex`（呼び出し名は `impl:execute-codex`）
- `description`: 説明文の末尾にトリガーフレーズを 3〜5 個置く（例: 「Codex で実装して」「codex で計画書を実行」「impl:execute-codex」）
- 本文は `impl__execute/SKILL.md` を複製し、上記フローの差分を反映する。500 行以内を目標とし、詳細はこの設計書と `references/` に逃がす。
- 冒頭に「実験用スキルであり、Codex が使用不能なら停止する。Claude での実装にフォールバックしない」と明記する。

## 前提となる環境

- `codex` が PATH から解決できること。現状は mise の node 22.x 配下にのみインストールされており、グローバルの node 24.14.1 からは見えない。PATH の整備はユーザー側で行う。
- `~/.codex/config.toml` の `model` と `model_reasoning_effort` はスクリプトの明示指定で上書きされるため、設定値に依存しない。

## テスト方針

- `check-codex.ts`、`run-codex-step.ts` は PATH や実行コマンドを差し替え可能にし、偽の `codex` スクリプトを使った bun のテストで「見つからない」「非 0 終了」「error イベント」「変更なし」の各失敗経路と成功経路を検証する。
- SKILL.md の動作は、小さな計画書を用意して実際に Codex で 1 ステップ実行する手動確認で行う。

## 削除時の手順

`cbo/skills/impl__execute-codex/` をディレクトリごと削除し、この設計書を削除する。他のファイルへの参照は持たない。
