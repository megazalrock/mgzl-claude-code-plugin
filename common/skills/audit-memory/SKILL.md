---
name: audit-memory
description: カレントプロジェクトの Claude Code AutoMemory（~/.claude/projects/<slug>/memory/）を棚卸しする。MEMORY.md との索引整合やフロントマターの構造検査をスクリプトで行い、各記憶の内容が現状のコード・CLAUDE.md と合っているかをサブエージェントで検証して「削除可 / 保持 / 要判断」に分類して報告する。報告のみで記憶の削除・修正は行わない。「記憶を棚卸しして」「AutoMemory を棚卸し」「メモリを棚卸し」「memory を監査して」などの依頼時に使用する。
allowed-tools: Agent, Bash, Read
---

## このスキルの目的

カレントプロジェクトの AutoMemory を読み取り専用で棚卸しし、人間が「要判断」の記憶だけを見れば済む報告書を出す。構造の検査はスクリプト、内容の検証は `mgzl:memory-auditor` エージェントが担い、このスキルは分割・起動・統合に徹する。記憶ファイルや `MEMORY.md` への書き込み・削除は一切行わない。

## ワークフロー

### Step 1: 構造検査

```
bun run "${CLAUDE_SKILL_DIR}/scripts/check-structure.ts" --project-dir "${CLAUDE_PROJECT_DIR}"
```

出力は 1 行 1 件の `key=value`:

- `error=memory_dir_not_found dir=<path>` → 「このプロジェクトに AutoMemory は未作成（<path>）」と報告して終了
- それ以外の `error=` 行（`missing_project_dir` / `bun_too_old`）→ `detail` をそのまま報告して終了
- `dir=` / `count=` → memory ディレクトリと記憶の件数
- `memory=<file> type=<type> name=<name> description=<desc>` → 記憶 1 件。`description` は行末まで
- `issue=<kind> file=<file> detail=<detail>` → 構造的問題 1 件

この段階では記憶の本文を Read しない。

### Step 2: エージェントの起動

`count=0` の場合（記憶ファイルが 1 件も無い）はエージェントを起動せず、Step 4 の形式で構造的問題（`file_missing` 等）だけを報告して終了する。

`memory=` 行を出力順に **5 件ずつ**のバッチに分け、バッチごとに `mgzl:memory-auditor` を Agent ツールで起動する。さらに横断検証を 1 体起動する。**全バッチと横断検証は同一メッセージで並列に起動する。**

個別検証のプロンプト（バッチごと）:

```
mode: individual
project_dir: <${CLAUDE_PROJECT_DIR}>
memory_dir: <dir= の値>
対象:
- <dir>/<file1>
- <dir>/<file2>
...（最大 5 件）
```

横断検証のプロンプト:

```
mode: cross
project_dir: <${CLAUDE_PROJECT_DIR}>
memory_dir: <dir= の値>
MEMORY.md: <dir>/MEMORY.md
記憶一覧:
- <file> / <type> / <name> / <description>
...（全件）
```

### Step 3: 統合

各エージェントの報告を次の規則で三分類に振り分ける:

- 判定が「削除可」でも、根拠に `path:line`・コミットハッシュ・CLAUDE.md の箇所のいずれも含まれない → **要判断**に格下げし、問題点に「根拠不足」と記す
- エージェントが結果を返さなかった、または対象ファイルが報告に無い → **要判断**（問題点「検証未完了」）
- 横断検証の確定ペアはすべて **要判断**
- それ以外はエージェントの判定どおり

### Step 4: 報告

以下の形式で出力する。表は使わずリストで書く。該当が無い節は「なし」と明記する。

```
## AutoMemory 棚卸し結果

- 対象: <dir>
- 総数: N 件 / 削除可: N 件 / 保持: N 件 / 要判断: N 件 / 構造的問題: N 件 / 未執筆リンク: N 件

### 構造的問題
- <kind>: <file> — <detail>（修正案: <索引行の追加 / フロントマターの修正 など一言>）

### 削除可
- <file> — <根拠 1 行>

### 保持
- <file>

### 要判断
- <file>
  - 問題点: <一言>
  - 根拠: <エージェントの根拠>
  - 提案: <修正案または確認すべき点>
- <fileA> / <fileB>（<重複|包含|矛盾>）
  - 根拠: ...
  - 統合案: ...

### 未執筆リンク
- <file> → [[<link>]]
```

`issue=broken_link` は「構造的問題」ではなく「未執筆リンク」に載せる（書くべき記憶の予告であり、エラーではない）。
サマリの「構造的問題」件数は `broken_link` を除いた `issue=` 行数、「未執筆リンク」件数は `broken_link` の行数とする。

## 守るべき姿勢

- **書き込まない** — 報告のあと、削除や修正はユーザーの指示を待つ。「削除可」であっても勝手に消さない
- **根拠のない削除可を通さない** — エージェントの判定を鵜呑みにせず、Step 3 の格下げ規則を必ず適用する
- **本文を持ち込まない** — 記憶の本文はエージェントが読む。メインは `memory=` 行と報告だけで統合する
