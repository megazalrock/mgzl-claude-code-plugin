---
name: branch-name-maker
description: 新しいブランチ名を考え候補を挙げる。「ブランチ名を考えて」「新規ブランチ名」などの依頼時に使用
argument-hint: [task name]
disable-model-invocation: true
---

# branch-name-maker

## コンテキスト

- タスク内容: $ARGUMENTS

## タスク

0. タスク内容が空の場合は、ユーザーにその旨を伝えて終了する
1. タスク内容を作業するブランチ名をルールに則って異なる観点から3パターン作成する
2. 選択したブランチ名をユーザーに AskUserQuestion で提示する
3. 選択した物を表示する。ユーザーは `/copy` コマンドでコピーするため、ブランチ名以外は出力しない。バックティックでも囲わない。

## ブランチ名ルール

* `base/xxxx` 大きめ機能のベースブランチ
* `feature/xxxx` 通常の機能開発
* `fix/xxxx` バグ修正
* `qa-fix/xxxx` QA指摘事項の修正
* `hotfix/xxxx` main 向けの修正

## AskUserQuestionの選択肢に表示する内容

- label: ブランチ名
- description: どのような観点で作成したか
