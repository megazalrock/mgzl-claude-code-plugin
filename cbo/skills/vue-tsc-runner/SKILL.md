---
name: vue-tsc-runner
description: TypeScriptの型チェックを行いたい場合に使用するスキルです。TypeScriptの型チェックを求められた場合、vue-tscを実行したい場合、`pnpm vue-tsc --noEmit` を実行したい場合、「Typeエラーをチェック」「型エラーをチェック」など指示された場合に呼び出します。`<パス>...` でCIと同等のチェック（複数指定可、パス省略時は全ファイル対象）、`--all <パス>...` で全ファイルチェック（パス指定必須・複数可）。
allowed-tools: Bash(bun run */scripts/run-vue-tsc.ts)
model: sonnet
argument-hint: "[--all] [<パス>...]"
---

# Vue tsc Runner

## 引数

```
$ARGUMENTS
```

## ワークフロー

### Step 1: 引数の解析と実行方法の決定

引数に基づいて実行方法を決定する。パスは複数指定可能。

| 引数 | 実行方法 |
|------|----------|
| `<パス>...`（1個以上） | CIと同等モード（指定パスのエラーのみ表示） |
| パスなし | CIと同等モード（全エラーを表示） |
| `--all <パス>...`（1個以上） | 全ファイルモード（パス指定必須） |

#### `--all` でパスが指定されていない場合

ユーザーに以下を通知して**即時終了**する（コマンドは実行しない）:
> `--all` モードはファイルパスまたはディレクトリパスの指定が必要です。
> 例: `/vue-tsc-runner --all pages/schedules/`

### Step 2: コマンド実行

#### パスあり（1個以上、空白区切りで複数指定可）

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts" '<パス1>' '<パス2>' ...
```

複数パス指定時、`tsconfig.ci.json` の対象パスは `tsconfig.ci.json` で、対象外のパスは `tsconfig.mgzl.json` で**それぞれ別途**実行されます（CI対象群と対象外群が混在する場合は2回実行され、出力が結合されます）。

#### パスなし

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts"
```

#### 全ファイル（`--all <パス>...` 指定時、複数可）

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts" --all '<パス1>' '<パス2>' ...
```

### Step 3: 結果の通知

Typeエラーを検知した場合は発生したTypeエラーをユーザーへ通知し、判断を仰ぐ。
