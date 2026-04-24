---
name: vue-tsc-runner
description: TypeScriptの型チェックを行いたい場合に使用するスキルです。TypeScriptの型チェックを求められた場合、vue-tscを実行したい場合、`pnpm vue-tsc --noEmit` を実行したい場合、「Typeエラーをチェック」「型エラーをチェック」など指示された場合に呼び出します。`<パス>` でCIと同等のチェック（パス省略時は全ファイル対象）、`--all <パス>` で全ファイルチェック（パス指定必須）。
allowed-tools: Bash(bun run */scripts/run-vue-tsc.ts)
model: sonnet
argument-hint: "[--all] [<パス>]"
---

# Vue tsc Runner

## 引数

```
$ARGUMENTS
```

## ワークフロー

### Step 1: 引数の解析と実行方法の決定

引数に基づいて実行方法を決定する。

| 引数 | 実行方法 |
|------|----------|
| `<ファイルパス or ディレクトリパス>` | CIと同等モード（指定パスのエラーのみ表示） |
| パスなし | CIと同等モード（全エラーを表示） |
| `--all <ファイルパス or ディレクトリパス>` | 全ファイルモード（パス指定必須） |

#### `--all` でパスが指定されていない場合

ユーザーに以下を通知して**即時終了**する（コマンドは実行しない）:
> `--all` モードはファイルパスまたはディレクトリパスの指定が必要です。
> 例: `/vue-tsc-runner --all pages/schedules/`

### Step 2: コマンド実行

#### パスあり

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts" '<パス>'
```

指定パスが `tsconfig.ci.json` の対象に含まれない場合は、スクリプト内で自動的に `tsconfig.mgzl.json` にフォールバックして実行します。

#### パスなし

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts"
```

#### 全ファイル（`--all <パス>` 指定時）

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/run-vue-tsc.ts" --all '<パス>'
```

### Step 3: 結果の通知

Typeエラーを検知した場合は発生したTypeエラーをユーザーへ通知し、判断を仰ぐ。
