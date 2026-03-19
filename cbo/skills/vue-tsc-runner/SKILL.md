---
name: vue-tsc-runner
description: TypeScriptの型チェックを行いたい場合に使用するスキルです。TypeScriptの型チェックを求められた場合、vue-tscを実行したい場合、`pnpm vue-tsc --noEmit` を実行したい場合、「Typeエラーをチェック」「型エラーをチェック」など指示された場合に呼び出します。引数なしでCIと同等のチェック、`--all <パス>` で全ファイルチェック（パス指定必須）。
allowed-tools: Bash(bun .claude/skills/vue-tsc-runner/scripts/run-vue-tsc-ci.ts), Bash(bun .claude/skills/vue-tsc-runner/scripts/run-vue-tsc-special-config.ts)
model: sonnet
argument-hint: "[--all <パス>]"
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
| なし（空） | CIと同等モード |
| `--all <ファイルパス or ディレクトリパス>` | 全ファイルモード（grepでフィルタ） |
| `--all`（パスなし） | **即時終了**（エラーメッセージをユーザーに表示） |

#### `--all` でパスが指定されていない場合

ユーザーに以下を通知して**即時終了**する（コマンドは実行しない）:
> `--all` オプションにはファイルパスまたはディレクトリパスの指定が必要です。
> 例: `/vue-tsc-runner --all pages/schedules/`

### Step 2: コマンド実行

#### CIと同等（デフォルト: 引数なし）

```bash
bun .claude/skills/vue-tsc-runner/scripts/run-vue-tsc-ci.ts
```

#### 全ファイル（`--all <パス>` 指定時）

無関係なファイルも検知されるため `grep` で引数のパスを指定して実行する。

```bash
bun .claude/skills/vue-tsc-runner/scripts/run-vue-tsc-special-config.ts | grep '<引数で指定されたパス>'
```

### Step 3: 結果の通知

Typeエラーを検知した場合は発生したTypeエラーをユーザーへ通知し、判断を仰ぐ。
