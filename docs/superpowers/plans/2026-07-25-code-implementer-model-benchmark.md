# code-implementer モデル比較ベンチマーク 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `code-implementer` エージェントを Sonnet / Opus 5 で各 1 回ずつ動かして品質差・コスト差を測るベンチマークの実行基盤（runbook + 2 テンプレート）を作成し、業務リポジトリでの実施へ引き渡す。

**Architecture:** 静的なテンプレート類（runbook・記録シート・審査プロンプト）をプラグインリポジトリの `docs/benchmarks/code-implementer-model-benchmark/` に作成する。ベンチマーク実施自体は業務リポジトリで起動した別セッションが runbook に従って行い、実行データは `$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/` に保存する。

**Tech Stack:** Markdown ドキュメントのみ（スクリプト・コードなし）。実施時は Claude Code の Agent ツール（`cbo:code-implementer`、model オーバーライド）と cbo プラグインのスキル（vue-tsc-runner / test-runner）・eslint MCP を使用する。

**Spec:** `docs/superpowers/specs/2026-07-25-code-implementer-model-benchmark-design.md`

## Global Constraints

- コミットはユーザーの明示指示があるまで行わない（ユーザーのグローバル方針。本計画のどのタスクでも自動コミットしない）
- 業務リポジトリ（`/Users/otto/workspace/craftbank/arrangement-env/front`）では commit / push を一切行わない。ベンチ終了時に `git status` clean を確認する
- 業務リポジトリの操作は、業務リポジトリをカレントディレクトリとして起動した別セッションで行う。`git -C` や `cd` による横断操作をしない
- 記録・審査の出力形式は Markdown 表ではなく key=value / リスト形式を使う（ユーザーのフィードバック方針）
- 実装エージェントのモデルは `sonnet` / `opus` の 2 種のみ。審査員サブエージェントのみ `fable`（ユーザー明示指定の例外）
- 比較条件の統制: 同一開始コミット・同一指示文・各モデル 1 回・順次実行（worktree 不使用）
- パス定数: プラグインリポジトリ = `/Users/otto/workspace/mgzl-claude-code-plugin`、業務リポジトリ = `/Users/otto/workspace/craftbank/arrangement-env/front`、実行データ = `$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/`

---

### Task 1: 記録シートテンプレートの作成

**Files:**
- Create: `docs/benchmarks/code-implementer-model-benchmark/record-sheet-template.md`

**Interfaces:**
- Produces: 1 実行（タスク × モデル）ごとに記入する記録シートの雛形。Task 3 の runbook が Phase 3 手順 6 でこのファイルパスを参照する

- [x] **Step 1: テンプレートファイルを作成する**

以下の内容で `docs/benchmarks/code-implementer-model-benchmark/record-sheet-template.md` を Write する（ディレクトリは Write が自動作成する）:

````markdown
# 実行記録シート

<!-- 1 実行（タスク × モデル）につき本シートを 1 部コピーして記入する -->
<!-- 保存先: $MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/records/<task-id>-<model>.md -->

## 実行条件

- task_id: <T1 | T2 | T3>
- task_name: <タスク名>
- model: <sonnet | opus>
- 実行日時: <YYYY-MM-DD HH:MM>
- 開始コミット: <SHA>
- 指示文ファイル: instructions/<task-id>.md
- IDEA MCP 可用性: <利用可 | 利用不可>

## 実行結果

- 完了状態: <完了 | 未完了>
- 再実行: <なし | あり（理由: ）>
- 所要時間: <N 分>
- トークン消費: <N | 取得不能>

## エージェント自己申告

- lint: <エラー 0 | エラー N 件>
- 型チェック: <エラー 0 | エラー N 件>
- テスト: <全成功 | 失敗 N 件>
- 報告形式の遵守: <yes | no（欠落セクション: ）>
- test-implementer への引き継ぎ明記: <yes | no | 該当なし>

## 客観ゲート再実行（ベンチ実施者側・巻き戻し前に実施）

- eslint エラー数: <N>
- vue-tsc エラー数: <N>
- テスト: <pass | fail（失敗テスト: ）>

## 成果物

- patch ファイル: patches/<task-id>-<model>.patch
- 変更規模: <+N / -M 行>

## 備考

<特記事項（なければ「なし」）>
````

- [x] **Step 2: スペックとの突合で検証する**

作成したファイルを Read し、スペックの Phase 3「記録テンプレートへ以下を記録する」の 5 項目（完了/未完了・所要時間・トークン消費・エージェント自己申告のゲート結果・報告内容の質）と Phase 4 の客観ゲート再実行結果、および IDEA MCP 可用性（リスク対策）がすべて記入欄として存在することを確認する。欠落があれば追記する。

### Task 2: 審査プロンプトテンプレートの作成

**Files:**
- Create: `docs/benchmarks/code-implementer-model-benchmark/judge-prompt-template.md`

**Interfaces:**
- Consumes: `cbo/agents/code-implementer.md` の「コーディング指針」セクション（実施時に差し込む）
- Produces: fable サブエージェントへ投入するブラインド審査プロンプトの雛形。Task 3 の runbook が Phase 4 手順 2 でこのファイルパスを参照する

- [x] **Step 1: テンプレートファイルを作成する**

以下の内容で `docs/benchmarks/code-implementer-model-benchmark/judge-prompt-template.md` を Write する:

````markdown
# 審査プロンプトテンプレート

<!-- <> 内を差し替えて、fable サブエージェントへの単一プロンプトとして投入する -->
<!-- A/B へのモデル割当はタスクごとに入れ替え、assignment.md（審査員には渡さない）に記録する -->
<!-- patch が 1 回のプロンプトに収まらない場合はファイル単位に分割して同形式で複数回審査し、軸ごとの平均（小数第 1 位）を採用。分割した旨を審査結果に明記する -->

あなたはコードレビューの審査員です。同一のタスク指示文に対して独立に作成された 2 つの実装（実装 A / 実装 B）を、参照実装と比較して採点してください。

制約:

- 実装 A / B の作成者・作成手段（使用モデル等）を推定しない。推定に基づく評価をしない
- 採点は下記 3 軸で、各軸 1〜5 の整数（5 が最良）
- 各スコアには根拠となる具体的指摘（ファイル名・該当箇所付き）を必ず列挙する
- 出力は下記「出力形式」に厳密に従う

## 入力

### タスク指示文

<instructions/<task-id>.md の内容>

### 参照実装（人間がレビューしてマージした正解 diff）

<answers/<task-id>.diff の内容>

### 実装 A

<patches/ 配下の該当 patch の内容>

### 実装 B

<patches/ 配下の該当 patch の内容>

### コーディング指針

<cbo/agents/code-implementer.md の「## コーディング指針」セクション全文>

## 採点軸

1. functional_equivalence（機能的等価性）: 参照実装が満たしている機能要件をどの程度満たしているか。参照実装と異なる手段でも要件を満たしていれば減点しない
2. guideline_compliance（コーディング指針遵守度): 上記「コーディング指針」への適合度
3. design_quality（設計品質）: 責務分離・命名・コメント品質

## 追加確認

- 丸写し兆候: 参照実装とコメント文面・変数名・実装順序まで不自然に一致する箇所の有無（あれば具体的に列挙）

## 出力形式

```
implementation=A
functional_equivalence=<1-5>
guideline_compliance=<1-5>
design_quality=<1-5>
copy_suspicion=<none | suspected>
findings:
- <スコアの根拠となる指摘（ファイル名・該当箇所付き）>

implementation=B
functional_equivalence=<1-5>
guideline_compliance=<1-5>
design_quality=<1-5>
copy_suspicion=<none | suspected>
findings:
- <同上>

summary:
- <両実装の総合所見。優劣への言及は可、作成手段の推定は不可>
```
````

- [x] **Step 2: スペックとの突合で検証する**

作成したファイルを Read し、スペック Phase 4 の要件（採点軸 3 つ・各 5 段階・指摘列挙・丸写し兆候の確認・A/B 匿名化・分割審査ルール）がすべて含まれることを確認する。欠落があれば追記する。

### Task 3: 実行手順書（runbook）の作成

**Files:**
- Create: `docs/benchmarks/code-implementer-model-benchmark/runbook.md`

**Interfaces:**
- Consumes: Task 1 の `record-sheet-template.md`、Task 2 の `judge-prompt-template.md`（絶対パスで参照）
- Produces: 業務リポジトリの別セッションが従う Phase 1〜5 の完全な実行手順

- [x] **Step 1: runbook を作成する**

以下の内容で `docs/benchmarks/code-implementer-model-benchmark/runbook.md` を Write する:

````markdown
# code-implementer モデル比較ベンチマーク 実行手順書

設計書: `/Users/otto/workspace/mgzl-claude-code-plugin/docs/superpowers/specs/2026-07-25-code-implementer-model-benchmark-design.md`

## 前提条件

- Claude Code セッションを業務リポジトリ `/Users/otto/workspace/craftbank/arrangement-env/front` をカレントディレクトリとして起動する（cbo プラグイン有効・eslint MCP / IDEA MCP 接続済み）
- Docker 環境（テスト・型チェックの実行系）が起動済みであること
- `git status` が clean であること。現在のブランチ名を控える（最後に復帰する）
- IDEA MCP の可用性を最初に確認し、6 実行すべてで同じ状態（全部使える / 全部使えない）に統一して各記録シートに記録する
- 結果保存ディレクトリを作成する:

```bash
mkdir -p "$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark"/{instructions,answers,patches,records,judgements}
```

- 本手順の全期間を通じて、業務リポジトリでは commit / push をしない

## Phase 1: タスク選定

1. マージ済み履歴から候補を発掘する。コマンド例（マージコミット運用の場合）:

```bash
git log --first-parent --merges --author='Otto Kamiya' --since="2 months ago" --pretty='%h %s'
```

squash マージ運用の場合（`<日付>` は実行日の 2 ヶ月前を YYYY-MM-DD で指定）:

```bash
gh pr list --state merged --search "author:@me merged:>=<日付>" --limit 50 --json number,title,mergedAt,files
```

2. 各候補の規模・変更ファイルを確認する:

```bash
git show --stat <sha>
```

3. 選定条件（設計書 Phase 1 と同一）:
   - 作成者が Otto Kamiya のコミット / PR に限る
   - マージが直近 2 ヶ月以内のものに限る
   - 本体コード（非テスト）中心で、Vue コンポーネントまたは TS ロジックを含む
   - 規模で層別: 小 = 〜50 行 / 中 = 50〜200 行 / 大 = 200 行〜
   - 単一 PR で完結し、開始コミット（正解の親コミット）が明確
   - 3 件で種別が偏らない（新規コンポーネント作成・既存改修・ロジック実装から各 1 件が理想）
4. 候補ごとに「概要・変更ファイル一覧・変更規模・リプレイに向く理由」をユーザーへ提示し、3 件を確定してもらう
5. 確定した 3 件に task_id（T1 = 小 / T2 = 中 / T3 = 大）を割り当て、各タスクの開始コミット SHA（正解コミットの親。squash なら `<sha>^`）と正解コミット SHA を控える

## Phase 2: 指示文作成

1. 各タスクの PR 説明・コミットメッセージから「実装前に開発者へ渡されたであろう指示文」を起案し、`$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/instructions/<task-id>.md` に保存する
   - 粒度は実運用の実装計画書ステップに合わせる
   - 正解実装の内部詳細（関数名・具体的な実装方針・ファイル分割の答え）を書かない
2. 正解 diff を保存する:

```bash
git diff <開始コミットSHA> <正解コミットSHA> > "$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/answers/<task-id>.diff"
```

3. ユーザーが指示文をレビューし、正解を誘導する記述（情報リーク）を除去して確定する

## Phase 3: 実行（タスクごとに以下を繰り返す）

1. `git status` で clean を確認する
2. 開始コミットへ checkout する（detached HEAD で良い）:

```bash
git checkout <開始コミットSHA>
```

3. Agent ツールで実装エージェントを起動する:
   - `subagent_type`: `cbo:code-implementer`
   - `model`: 1 巡目 `sonnet` / 2 巡目 `opus`
   - `run_in_background`: false
   - プロンプト: 指示文（instructions/<task-id>.md の全文）+ 末尾に以下の追加制約文:

> 以下は単発の実装タスクです。git log・git show・リモートブランチ・reflog 等の git 履歴参照は禁止します（本タスクはベンチマークであり、履歴に参照実装が含まれるため）。現在チェックアウトされている作業ツリーの内容のみを参照してください。

4. 完了後、巻き戻し前に客観ゲートを実施者側で再実行し、結果を控える:
   - eslint MCP（変更ファイル対象）
   - vue-tsc-runner スキル
   - test-runner スキル（変更ファイルに対応する既存テスト）
5. 成果を patch として保存する（新規ファイルを含めるため staging を経由する）:

```bash
git add -A
git diff --cached > "$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/patches/<task-id>-<model>.patch"
```

6. `/Users/otto/workspace/mgzl-claude-code-plugin/docs/benchmarks/code-implementer-model-benchmark/record-sheet-template.md` を `records/<task-id>-<model>.md` へコピーして全欄を記入する
   - 所要時間・トークン消費は Agent 実行完了時に表示される情報から転記する。取得できない場合は「取得不能」と記入する
7. 開始状態へ巻き戻す:

```bash
git reset --hard && git clean -fd
```

8. もう一方のモデルで手順 3〜7 を繰り返す
9. タスク完了後、次のタスクの開始コミットへ checkout する（全タスク終了後は元のブランチへ復帰する）

エラー対応: エージェントが異常終了した場合は同条件で 1 回だけ再実行し、記録シートの「再実行」欄に理由を明記する。2 回目も失敗した場合は「未完了」として記録し、次へ進む。

## Phase 4: 評価

1. A/B 割当を決めて `assignment.md` に記録する（審査員には渡さない）:

```
T1: A=sonnet, B=opus
T2: A=opus,   B=sonnet
T3: A=sonnet, B=opus
```

2. タスクごとに `/Users/otto/workspace/mgzl-claude-code-plugin/docs/benchmarks/code-implementer-model-benchmark/judge-prompt-template.md` の `<>` を実値（指示文・正解 diff・patch 2 本・コーディング指針全文）で差し替え、**fable の汎用サブエージェント**に投入する。出力を `judgements/<task-id>.md` へ保存する
   - patch がプロンプトに収まらない場合はファイル単位に分割して複数回審査し、軸ごとの平均（小数第 1 位）を採用。分割した旨を審査結果に明記する
3. 人間確認: ユーザーが最低 1 タスク分の両 patch を目視し、審査結果の妥当性を確認する

## Phase 5: レポート

`$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/report.md` に以下を key=value / リスト形式でまとめる:

- 結果マトリクス: タスク × モデルごとに「客観ゲート結果 / 3 軸スコア / トークン / 所要時間」
- 総評: どの種別・難易度で差が出たか
- 推奨アクション: 「opus へ切替」「sonnet 維持」「タスク種別・難易度で使い分け」のいずれか
- パイロットの限界: 各 1 回実行のためモデル内ばらつきと区別できない旨を明記。僅差の場合のみ該当タスクを追加実行して判定する

切替判断の目安（設計書より）:

- Opus が 3 タスク中 2 タスク以上で審査スコア優位、かつ客観ゲート同等以上、かつコスト増が許容範囲 → opus へ切替
- 品質ほぼ同等 → sonnet 維持
- 大規模・複雑タスクのみ優位 → 使い分けを検討

## 後片付け

- 業務リポジトリで `git status` が clean であること、元のブランチへ復帰していることを確認する
- 業務リポジトリ側に一時ファイルを残さない（実行データはすべて `$MGZL_DIR` 側にある状態にする）
````

- [x] **Step 2: スペックとの突合で検証する**

作成した runbook を Read し、スペックの「実行方式: 順次実行」の 7 手順、Phase 1〜5 の各要件、リーク対策（git 参照禁止文・指示文レビュー・丸写し検知）、エラー対応（1 回だけ再実行）、後片付けがすべて含まれることを確認する。参照している 2 テンプレートのパスが Task 1・Task 2 の作成物と一致することも確認する。

### Task 4: セルフレビューとユーザーへの引き渡し

**Files:**
- Modify: なし（確認のみ）

**Interfaces:**
- Consumes: Task 1〜3 の全成果物

- [x] **Step 1: 3 ファイルの相互整合を確認する**

以下を確認し、不整合があれば修正する:

- runbook が参照するテンプレートの絶対パス 2 つが実ファイルと一致する
- record-sheet-template の保存先パス表記と runbook Phase 3 手順 6 の保存先が一致する
- judge-prompt-template の入力欄（指示文 / 正解 diff / patch×2 / コーディング指針）と runbook Phase 4 手順 2 の差し込み内容が一致する
- 3 ファイルとも `$MGZL_DIR/benchmarks/2026-07-code-implementer-model-benchmark/` という同一のデータディレクトリ名を使っている

- [x] **Step 2: ユーザーへ引き渡す**

以下をユーザーへ報告する:

- 作成した 3 ファイルのパス
- コミットは未実施であること（明示指示があれば `docs: code-implementer モデル比較ベンチマークの runbook とテンプレートを追加` の 1 コミットにまとめる）
- 次のアクション: 業務リポジトリ `/Users/otto/workspace/craftbank/arrangement-env/front` で Claude Code セッションを起動し、runbook の Phase 1（タスク選定）から開始すること
