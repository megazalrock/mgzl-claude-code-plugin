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
