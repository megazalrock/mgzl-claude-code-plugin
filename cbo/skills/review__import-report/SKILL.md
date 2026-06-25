---
name: review:import-report
description: レビュー報告書（Markdown）を読み込み、指摘内容（finding）と評価（verdict）を SQLite DB に保存する。「レビュー報告書をインポート」「レビュー結果をDBに保存」「レビューをDBに」などの依頼時に使用する。
argument-hint: [report-path]
---

## コンテキスト

- 指定のレビュー報告書: $ARGUMENTS

## 役割

レビュー報告書を取り込んで `${CLAUDE_PLUGIN_DATA}/review.sqlite` に保存する。CLI は永続化に専念し、本スキルが「報告書ファイル選択 → メタデータ取得 → finding 抽出 → CLI 投入」をオーケストレートする。

## 手順

### 1. レビュー報告書のパスを確定する

- $ARGUMENTS が指定されていればそれを採用し、絶対パスに正規化する。
- $ARGUMENTS が無い場合は、`$MGZL_DIR/reviews/` 配下から **最新 5 件の `.md` ファイル** を mtime 降順で取得し、AskUserQuestion でユーザーに選択させる。
  - 取得方法: Glob ツールで `${MGZL_DIR}/reviews/**/*.md` を取得し、各ファイルの mtime を `bun run` で確認するか、Bash で `ls -1t "${MGZL_DIR}/reviews/"*.md 2>/dev/null | head -5` を実行する。
  - 該当ファイルが 0 件ならエラー表示してスキルを終了する。

### 2. フロントマターから reporter / model を取得する

`${CLAUDE_SKILL_DIR}/scripts/read-frontmatter.ts` を起動し、出力を解釈する。

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/read-frontmatter.ts" <report-path>
```

出力例:

```
has_frontmatter=true
reporter=ClaudeCode review:diff
model=claude-sonnet-4-6
```

- `has_frontmatter=false` または `reporter=` が空の場合は、AskUserQuestion で reporter をユーザーに確認する。選択肢には少なくとも `Codex` / `GitHub Copilot` / `ClaudeCode review:diff` / `ClaudeCode code-review` / `unknown` を含める。
- `model=` が空の場合は null として扱い、CLI 呼び出し時に `--model` を省略する。

### 3. finding-extractor サブエージェントで構造化 JSON を得る

Agent ツールで `finding-extractor` サブエージェントを起動する。

- subagent_type: `finding-extractor`
- prompt: `report_path: <絶対パス>` と `reporter_hint: <手順 2 で確定した reporter>` を渡し、「スキーマに従って JSON 配列のみ返してください」と明示する。

サブエージェントの応答テキスト全体が JSON 配列であることを確認する。配列でない場合は失敗としてユーザーに報告し中断する。

### 4. 一時ファイルに JSON を書き出す

`${TMPDIR}/review-findings-<uuid>.json` のような一意なパスへ Write ツールで保存する。

### 5. CLI で UPSERT する

```bash
bun run "${CLAUDE_SKILL_DIR}/scripts/review-db.ts" import-report \
  <report-path> \
  --findings <jsonpath> \
  --model <model>
```

- model が null の場合は `--model` ごと省略する。
- CLI が `report_id=...` `findings_count=...` `verdicted_count=...` `unverdicted_count=...` の 4 行を返す。

### 6. 結果を報告する

CLI の出力 4 行をそのままユーザーに提示する。エラー終了した場合は stderr の内容を併せて報告し、スキルを終了する。

## 制約

- レビュー対象のソースコードは編集しない（レビュー報告書ファイル自体も含む）。
- CLI を Bash で起動するときは、`bun run` の前に `cd` してはならない（CLAUDE.md 制約）。スクリプトのパスは `${CLAUDE_SKILL_DIR}/scripts/...` の絶対形式で渡す。
- 一時 finding JSON は使い終わったら削除して構わない（DB に格納済みなのでファイル保持不要）。

## トラブルシューティング

- `CLAUDE_PLUGIN_DATA is not set` で CLI が落ちる場合: スキル経由でない直接実行が原因。Claude Code 経由なら通常設定される。
- `findings JSON の検証に失敗` の場合: finding-extractor の出力が JSON 配列スキーマに合っていない。サブエージェントを起動し直すか、出力を目視確認して手動修正する。
- 同一パスで再 import すると findings は CASCADE 削除されて再構築される（report ID は保持される）。
