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
