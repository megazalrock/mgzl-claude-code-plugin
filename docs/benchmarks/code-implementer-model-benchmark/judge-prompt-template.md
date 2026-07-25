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
2. guideline_compliance（コーディング指針遵守度）: 上記「コーディング指針」への適合度
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
