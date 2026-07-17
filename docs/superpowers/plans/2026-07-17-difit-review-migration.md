# cbo レビュー報告書 difit 移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cbo プラグインのレビュー報告書を正本 JSON 形式に移行し、difit で開いて評価を往復できるようにする。

**Architecture:** 独自スキーマの JSON を `$MGZL_DIR/reviews/` の正本とし、difit はそこから導出するビューとする。起動・コメント導出・取得は共有 TypeScript スクリプト `cbo/scripts/difit-review.ts`（bun）が担い、人間の評価は difit スレッドへの返信 → `/api/comments-json` 経由で `review:fix` が取得して正本 JSON の `evaluation` に書き戻す。

**Tech Stack:** Markdown スキル定義（Claude Code プラグイン）、TypeScript + bun、difit（npx difit@latest）

**設計書:** `docs/superpowers/specs/2026-07-17-difit-review-migration-design.md`（実機検証結果を含む。必ず先に読むこと）

## Global Constraints

- **コミット禁止**: ユーザーの明示的な指示があるまで git commit を実行しない。各タスクは編集完了と検証結果の報告で終える
- スキル/エージェント md の記述言語は既存ファイルに合わせる（review 系スキル本文は日本語、reviewer エージェント本文は英語・レビュー出力は日本語）
- TypeScript で `!`（非 null 表明）/`as`/`any` は極力使用しない。使用する場合は理由をコメントで残す
- スクリプトは TypeScript + bun。実行は `bun run <path>` 形式
- Skill フロントマターは `name`, `description` 必須。`description` は説明文の後に「」付きトリガーフレーズを 3〜5 個
- `marketplace.json` の編集は不要（プラグイン追加ではないため）
- difit の検証済み仕様（設計書「実機検証の結果」節）に反する実装をしない。特に `--background` は使用禁止
- Bash 実行時に `cd` でディレクトリ移動しない。パスは絶対パスで指定する

---

### Task 1: 正本 JSON スキーマ定義書の新設

**Files:**
- Create: `cbo/skills/document-saver/references/format-review-result-json.md`
- Modify: `cbo/skills/document-saver/SKILL.md`（テンプレート表に 1 行追記）

**Interfaces:**
- Consumes: なし
- Produces: 後続タスク全部が参照するスキーマ定義。フィールド名は `reporter`, `model`, `base_commit`, `head_commit`, `created_at`, `target`, `good_points`, `findings[]`（`id`, `severity`, `file`, `anchor`, `problem`, `reason`, `reporter`, `proposals[]`, `evaluation`）, `references`

- [ ] **Step 1: スキーマ定義書を作成する**

`cbo/skills/document-saver/references/format-review-result-json.md` を以下の内容で作成する:

````markdown
# レビュー結果 正本 JSON スキーマ

review:diff / review:file / review:open が出力するレビュー報告書の正本フォーマット。
document-saver スキルは経由せず、各スキルが Write ツールで !`echo $MGZL_DIR`/reviews/ に直接保存する。

- ファイル名: `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`
- タイムスタンプ取得: `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"`

## スキーマ

```jsonc
{
  "reporter": "ClaudeCode review:diff",  // 実行主体。review:file は "ClaudeCode review:file"、review:open の変換は元 md の reporter を引き継ぐ
  "model": "claude-sonnet-4-6",          // 実行モデル名。不明なら "unknown"
  "base_commit": "abc...def",            // diff 対象のフル 40 桁 SHA-1。review:file 由来は null
  "head_commit": "abc...def",            // レビュー時 HEAD のフル 40 桁 SHA-1。review:file 由来は null
  "created_at": "2026-07-17T09:30:00+09:00",
  "target": null,                        // 任意: --target の絞り込み指定など。無ければ null
  "good_points": ["..."],                // 良い点。無ければ []
  "findings": [
    {
      "id": "R000",                      // R + 3桁ゼロパディング連番。出現順に R000, R001, ...
      "severity": 5,                     // 5=必須修正(ブロッカー) 4=強く推奨 3=推奨 2=軽微 1=情報
      "file": "src/foo.ts",              // リポジトリルートからの相対パス。ファイルを特定できない指摘は null
      "anchor": { "side": "new", "line": 42 },
      // side: "new"=追加後の行 / "old"=削除行のみに関する指摘
      // 範囲指摘は "line": { "start": 36, "end": 39 }
      // 単一行に紐づかない指摘（ファイル全体への指摘）は anchor 自体を null
      "problem": "問題の説明",
      "reason": "なぜ問題なのか、どの原則に反するか",
      "reporter": "@reviewer-for-logic", // 担当サブエージェント名
      "proposals": [
        { "label": null, "code": "改善後のコード例 もしくは 自然言語での修正案" }
        // 複数案があるときは label に "案A" / "案B" を設定し要素を分ける
      ],
      "evaluation": { "value": null, "directive": null }
      // value: "tp"(妥当) | "fp"(誤検知) | "nit"(些細) | "oos"(スコープ外) | null(未評価)
      // directive: 人間からの追加指示（従来の 対応： 欄）。無ければ null
    }
  ],
  "references": ["..."]                  // 任意: 参考情報。無ければ []
}
```

## 編集規則

- 正本 JSON は原則イミュータブル。例外として、エージェント（review:fix）は difit から取得した人間の評価を **`evaluation` フィールドにのみ** 書き戻してよい
- 人間が `evaluation` を直接編集することも有効（difit を使わない場合の副経路）

## 人間の評価記入（difit スレッドへの返信）

各指摘は difit 上で 1 スレッドとして表示される（body 先頭に `R000` 形式の ID）。
評価はスレッドへの**返信**で記入する:

- 先頭トークンが `tp` / `fp` / `nit` / `oos` → `evaluation.value` として解釈される
- `対応：` 以降のテキスト → `evaluation.directive` として解釈される（例: `tp 対応：案A`）
- 評価値の無い返信 → 全文が directive として解釈される

## sidecar ファイル（difit セッション情報）

difit 起動時、正本 JSON の隣に `<報告書名（.json を除く）>.difit-session.json` が作成される:

```json
{ "url": "http://localhost:4966", "port": 4966, "pid": 12345, "started_at": "..." }
```

- セッション状態であり報告書の一部ではない。stale になっていたら（プロセス死亡）再起動で上書きされる
````

- [ ] **Step 2: document-saver のテンプレート表に注記を追加する**

`cbo/skills/document-saver/SKILL.md` のテンプレート表の直後（`| その他 | [format-general.md](references/format-general.md) |` の行の後）に以下を追加する:

```markdown

> **注**: review:diff / review:file が出力するレビュー結果は本スキルを経由せず、正本 JSON（[format-review-result-json.md](references/format-review-result-json.md)）として各スキルが直接保存する。本スキルの「レビュー結果」テンプレート（md）は review:plan 用に残っている。
```

- [ ] **Step 3: 検証**

Grep で以下を確認する:
- `cbo/skills/document-saver/references/format-review-result-json.md` に `evaluation` と `difit-session` が含まれること
- `cbo/skills/document-saver/SKILL.md` に `format-review-result-json.md` への参照が 1 箇所あること

---

### Task 2: 共有スクリプト difit-review.ts の作成（TDD）

**Files:**
- Create: `cbo/scripts/difit-review.ts`
- Create: `cbo/scripts/difit-review.test.ts`

**Interfaces:**
- Consumes: Task 1 のスキーマ（`Report` / `Finding` 型として実装）
- Produces:
  - CLI `bun run cbo/scripts/difit-review.ts launch <report.json> --diff <head> <base>` — diff モードで difit 起動
  - CLI `bun run cbo/scripts/difit-review.ts launch <report.json> --file <path>` — `/dev/null` diff でファイル全体表示
  - CLI `bun run cbo/scripts/difit-review.ts comments <port>` — `/api/comments-json` の生 JSON を stdout に出力
  - launch の stdout（key=value 形式）: `url=` / `port=` / `pid=` / `session=` / `unanchored=`（カンマ区切り ID または `none`）。失敗時は stderr に `error=` を出し exit 1
  - launch は報告書の隣に sidecar `<報告書名>.difit-session.json` を書く
  - export 関数 `buildCommentPayloads(report: Report): { comments: CommentPayload[]; unanchored: Finding[] }`

- [ ] **Step 1: 失敗するテストを書く**

`cbo/scripts/difit-review.test.ts` を以下の内容で作成する:

```typescript
import { describe, expect, test } from "bun:test";
import { buildCommentPayloads, type Finding, type Report } from "./difit-review";

function baseReport(findings: Finding[]): Report {
  return {
    reporter: "ClaudeCode review:diff",
    model: "test",
    base_commit: null,
    head_commit: null,
    created_at: "2026-07-17T00:00:00+09:00",
    target: null,
    good_points: [],
    findings,
    references: [],
  };
}

function finding(over: Partial<Finding>): Finding {
  return {
    id: "R000",
    severity: 3,
    file: "src/a.ts",
    anchor: { side: "new", line: 10 },
    problem: "p",
    reason: "r",
    reporter: "@reviewer-for-logic",
    proposals: [{ label: null, code: "x" }],
    evaluation: { value: null, directive: null },
    ...over,
  };
}

describe("buildCommentPayloads", () => {
  test("通常の指摘は thread コメントに変換され body 先頭に ID が入る", () => {
    const { comments, unanchored } = buildCommentPayloads(baseReport([finding({})]));
    expect(unanchored).toHaveLength(0);
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe("thread");
    expect(comments[0].filePath).toBe("src/a.ts");
    expect(comments[0].position).toEqual({ side: "new", line: 10 });
    expect(comments[0].body.startsWith("R000 [3] 推奨")).toBe(true);
    expect(comments[0].author).toBe("@reviewer-for-logic");
  });

  test("anchor: null かつ file ありは先頭行アンカーとファイル全体の注記になる", () => {
    const { comments } = buildCommentPayloads(baseReport([finding({ anchor: null })]));
    expect(comments[0].position).toEqual({ side: "new", line: 1 });
    expect(comments[0].body).toContain("【ファイル全体への指摘】");
  });

  test("file: null は difit に載せず unanchored に分類される", () => {
    const { comments, unanchored } = buildCommentPayloads(
      baseReport([finding({ file: null, anchor: null })])
    );
    expect(comments).toHaveLength(0);
    expect(unanchored.map((f) => f.id)).toEqual(["R000"]);
  });

  test("範囲アンカーと複数案がそのまま反映される", () => {
    const f = finding({
      anchor: { side: "new", line: { start: 3, end: 6 } },
      proposals: [
        { label: "案A", code: "a" },
        { label: "案B", code: "b" },
      ],
    });
    const { comments } = buildCommentPayloads(baseReport([f]));
    expect(comments[0].position.line).toEqual({ start: 3, end: 6 });
    expect(comments[0].body).toContain("提案（案A）:");
    expect(comments[0].body).toContain("提案（案B）:");
  });

  test("body 末尾に返信書式のヒントが入る", () => {
    const { comments } = buildCommentPayloads(baseReport([finding({})]));
    expect(comments[0].body).toContain("返信例: tp 対応：案A");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.test.ts`
Expected: FAIL（`difit-review` モジュールが存在しない）

- [ ] **Step 3: スクリプト本体を実装する**

`cbo/scripts/difit-review.ts` を以下の内容で作成する:

```typescript
// レビュー報告書（正本 JSON）を difit で開く・コメントを取得する共有スクリプト。
// スキーマ: cbo/skills/document-saver/references/format-review-result-json.md
//
// usage:
//   bun run difit-review.ts launch <report.json> --diff <head> <base>
//   bun run difit-review.ts launch <report.json> --file <path>
//   bun run difit-review.ts comments <port>
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Side = "new" | "old";
export type AnchorLine = number | { start: number; end: number };
export interface Anchor {
  side: Side;
  line: AnchorLine;
}
export interface Proposal {
  label: string | null;
  code: string;
}
export interface Evaluation {
  value: "tp" | "fp" | "nit" | "oos" | null;
  directive: string | null;
}
export interface Finding {
  id: string;
  severity: 1 | 2 | 3 | 4 | 5;
  file: string | null;
  anchor: Anchor | null;
  problem: string;
  reason: string;
  reporter: string;
  proposals: Proposal[];
  evaluation: Evaluation;
}
export interface Report {
  reporter: string;
  model: string;
  base_commit: string | null;
  head_commit: string | null;
  created_at: string;
  target: string | null;
  good_points: string[];
  findings: Finding[];
  references: string[];
}
export interface CommentPayload {
  type: "thread";
  filePath: string;
  position: Anchor;
  body: string;
  author: string;
}

const SEVERITY_LABELS: Record<number, string> = {
  5: "必須修正 (ブロッカー)",
  4: "強く推奨",
  3: "推奨",
  2: "軽微",
  1: "情報",
};

export function buildCommentPayloads(report: Report): {
  comments: CommentPayload[];
  unanchored: Finding[];
} {
  const comments: CommentPayload[] = [];
  const unanchored: Finding[] = [];
  for (const f of report.findings) {
    if (f.file === null) {
      unanchored.push(f);
      continue;
    }
    const position: Anchor = f.anchor ?? { side: "new", line: 1 };
    const lines: string[] = [`${f.id} [${f.severity}] ${SEVERITY_LABELS[f.severity]}`];
    if (f.anchor === null) {
      lines.push("【ファイル全体への指摘】");
    }
    lines.push(`問題: ${f.problem}`, `理由: ${f.reason}`, `報告者: ${f.reporter}`);
    for (const p of f.proposals) {
      lines.push(p.label === null ? "提案:" : `提案（${p.label}）:`, p.code);
    }
    lines.push("--- 返信例: tp 対応：案A（評価値: tp / fp / nit / oos）");
    comments.push({
      type: "thread",
      filePath: f.file,
      position,
      body: lines.join("\n"),
      author: f.reporter,
    });
  }
  return { comments, unanchored };
}

function resolveDifitCommand(): string[] {
  return Bun.which("difit") === null ? ["npx", "--yes", "difit@latest"] : ["difit"];
}

function fail(message: string): never {
  console.error(`error=${message}`);
  process.exit(1);
}

async function launch(reportPath: string, mode: string, modeArgs: string[]): Promise<void> {
  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as Report;
  // as を使う理由: JSON.parse の戻り値に実行時スキーマ検証を導入するほどの規模ではなく、
  // スキーマ不一致は後続処理のエラーとして顕在化するため型表明で扱う
  const { comments, unanchored } = buildCommentPayloads(report);
  const workDir = mkdtempSync(join(tmpdir(), "difit-review-"));

  const args = [...resolveDifitCommand()];
  let stdinFd: number | "ignore" = "ignore";
  if (mode === "--diff") {
    if (modeArgs.length < 2) fail("--diff には <head> <base> の 2 引数が必要です");
    args.push(modeArgs[0], modeArgs[1]);
  } else if (mode === "--file") {
    if (modeArgs.length < 1) fail("--file には対象ファイルパスが必要です");
    const diff = spawnSync("git", ["diff", "--", "/dev/null", modeArgs[0]], {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    if (typeof diff.stdout !== "string" || diff.stdout === "") {
      fail("対象ファイルの diff を生成できませんでした");
    }
    const diffPath = join(workDir, "target.diff");
    writeFileSync(diffPath, diff.stdout);
    stdinFd = openSync(diffPath, "r");
  } else {
    fail("不明なモードです（--diff / --file）");
  }
  for (const c of comments) {
    args.push("--comment", JSON.stringify(c));
  }

  const logPath = join(workDir, "launch.log");
  const logFd = openSync(logPath, "w");
  const child = spawn(args[0], args.slice(1), {
    detached: true,
    stdio: [stdinFd, logFd, logFd],
  });
  child.unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await Bun.sleep(500);
    const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    const m = log.match(/started on (http:\/\/localhost:(\d+))/);
    if (m !== null) {
      const sessionPath = reportPath.replace(/\.json$/, ".difit-session.json");
      const session = {
        url: m[1],
        port: Number(m[2]),
        pid: child.pid,
        started_at: new Date().toISOString(),
      };
      writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
      console.log(`url=${m[1]}`);
      console.log(`port=${m[2]}`);
      console.log(`pid=${child.pid}`);
      console.log(`session=${sessionPath}`);
      console.log(
        `unanchored=${unanchored.length === 0 ? "none" : unanchored.map((f) => f.id).join(",")}`
      );
      return;
    }
  }
  fail(`difit の起動を 90 秒以内に確認できませんでした（ログ: ${logPath}）`);
}

async function comments(port: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}/api/comments-json`);
  } catch {
    fail(`サーバーに接続できませんでした（port=${port}）`);
  }
  if (!res.ok) fail(`HTTP ${res.status}`);
  console.log(await res.text());
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "launch" && rest.length >= 2) {
    await launch(rest[0], rest[1], rest.slice(2));
  } else if (cmd === "comments" && rest.length >= 1) {
    await comments(rest[0]);
  } else {
    console.error(
      "usage: difit-review.ts launch <report.json> --diff <head> <base> | launch <report.json> --file <path> | comments <port>"
    );
    process.exit(1);
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 実機スモークテスト（--diff モード）**

1. スクラッチディレクトリにフィクスチャ報告書 `smoke-report.json` を作成する。`base_commit` に `git rev-parse HEAD~1`、`head_commit` に `git rev-parse HEAD` の値を埋め、findings は 1 件（`id: "R000"`, `severity: 3`, `file` は `git diff --name-only HEAD~1 HEAD` の 1 件目, `anchor: { "side": "new", "line": 1 }`, ほかは任意の文字列、`evaluation: { "value": null, "directive": null }`）とする
2. Run: `bun run /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.ts launch <スクラッチ>/smoke-report.json --diff <head SHA> <base SHA>`
   Expected: `url=` / `port=` / `pid=` / `session=` / `unanchored=none` が出力される（ブラウザが開く）
3. Run: `bun run /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.ts comments <port>`
   Expected: `{"version":1,"threads":[...]}` に R000 の body が含まれる
4. sidecar `<スクラッチ>/smoke-report.difit-session.json` が作成されていることを確認する
5. 後片付け: `kill <pid>`

- [ ] **Step 6: 実機スモークテスト（--file モード）**

1. 同じフィクスチャ報告書の `base_commit` / `head_commit` を null にし、`file` を `cbo/README.md` に変えたコピーを作る
2. Run: `bun run /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.ts launch <スクラッチ>/smoke-report-file.json --file cbo/README.md`
   Expected: `url=` 等が出力される（ポートは前のテストの残りがあれば自動フォールバック）
3. `comments <port>` で R000 が取得できることを確認する
4. 後片付け: `kill <pid>`

---

### Task 3: レビュアーエージェント 5 種の報告テンプレートに位置情報欄を追加

**Files:**
- Modify: `cbo/agents/reviewer-for-logic.md`
- Modify: `cbo/agents/reviewer-for-design.md`
- Modify: `cbo/agents/reviewer-for-security-performance.md`
- Modify: `cbo/agents/reviewer-for-comments.md`
- Modify: `cbo/agents/reviewer-for-test-code.md`

**Interfaces:**
- Consumes: なし
- Produces: 各レビュアーの報告に `**位置**:` 行が入る。書式は `{相対パス}:{行 または 開始行-終了行} ({new|old})`、単一行に紐づかない場合 `{相対パス}:ファイル全体`、ファイル特定不能なら `なし`。Task 4/5 の統合ステップがこの欄から `file` / `anchor` を組み立てる

- [ ] **Step 1: 5 ファイルそれぞれに位置記載ルールのセクションを追加する**

各エージェント md の「Report template」セクションの**直前**に、以下のセクションを挿入する（5 ファイル共通、英語本文のファイルに合わせて英語で記載）:

```markdown
## Finding location (required)

Every finding MUST include a `**位置**` line so the caller can anchor it in a diff viewer:

- Use the repository-relative file path
- Prefer the line number on the **new** (post-change) side of the diff; use the old side only for findings about deleted lines, marking it `(old)`
- Use `start-end` for multi-line findings
- If the finding applies to the whole file, write `{path}:ファイル全体`
- If no single file can be identified, write `なし`
```

- [ ] **Step 2: 各テンプレートの指摘ブロックに `**位置**` 行を追加する**

5 ファイルそれぞれの Report template 内で、指摘ブロックの `**問題**:` 行の**直前**に以下の行を追加する（テンプレート内の全 severity セクションのうち、ブロック形式が明示されている箇所。「[同様の形式]」で省略されている箇所は変更不要）:

```markdown
**位置**: [ファイルパス:行番号 または 行範囲 (new|old) / ファイルパス:ファイル全体 / なし]
```

例（reviewer-for-logic.md の場合、`### [5] 必須修正 (ブロッカー)` ブロック）:

```markdown
### [5] 必須修正 (ブロッカー)
**位置**: [ファイルパス:行番号 または 行範囲 (new|old) / ファイルパス:ファイル全体 / なし]
**問題**: [問題の説明]
**理由**: [なぜ問題なのか、どの入力で何が壊れるか]
**提案**:
```

- [ ] **Step 3: 検証**

Grep（`output_mode: "count"`）で 5 ファイルすべてに `**位置**` が 1 回以上、`Finding location` が 1 回ずつ含まれることを確認する。

---

### Task 4: review:diff の JSON 化と difit 起動

**Files:**
- Modify: `cbo/skills/review__diff/SKILL.md`

**Interfaces:**
- Consumes: Task 1 のスキーマ定義書、Task 2 の `launch ... --diff` CLI、Task 3 の `**位置**` 欄
- Produces: `$MGZL_DIR/reviews/yyyyMMdd-hhmmss-*.json` の正本報告書と sidecar。review:fix / review:open が読む

- [ ] **Step 1: Step 6（サブエージェント入力）に位置出力の指示を追加する**

`cbo/skills/review__diff/SKILL.md` の Step 6 の末尾（「**ファイル全体は渡さない**…」の行の後）に以下を追加する:

```markdown
  - サブエージェントへの指示に「各指摘には差分のハンク行番号に基づく `**位置**` 欄（new 側の行番号を優先）を必ず記載すること」を含める
```

- [ ] **Step 2: Step 9（統合・保存）を JSON 出力に置き換える**

Step 9 全体（「9. 全てのレビュー結果をまとめる…」から「document-saver スキルで !`echo $MGZL_DIR`/reviews/ ディレクトリに保存する」まで）を以下に置き換える:

```markdown
9. 全てのレビュー結果を統合し、正本 JSON 報告書を組み立てて保存する
   - スキーマは `cbo/skills/document-saver/references/format-review-result-json.md` に従う。document-saver スキルは使わず Write ツールで直接保存する
   - `reporter` は固定で `ClaudeCode review:diff`。`model` は実行中の自身のモデル名（不明なら `unknown`）
   - `base_commit` / `head_commit` は Step 2 で解決したフル 40 桁 SHA-1（**必須**）
   - 各指摘を `findings[]` の要素にする:
     - `id` は出現順に R000, R001, ...（R + 3桁ゼロパディング連番）
     - `reporter` に担当サブエージェント名を記載する
     - レビュアー報告の `**位置**` 欄から `file` と `anchor` を組み立てる（`ファイル全体` → `anchor: null`、`なし` → `file: null` かつ `anchor: null`）
     - `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する
   - 差分中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（difit のコメント本文に載るため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
```

- [ ] **Step 3: Step 10（知見蓄積）の判定文言を severity に読み替える**

Step 10 内の「統合レビュー結果に `[3]` 推奨以上（`[3]`/`[4]`/`[5]`）の指摘が **1 件以上** ある場合のみ」を「正本 JSON の `findings` に `severity` が 3 以上の指摘が **1 件以上** ある場合のみ」に、「`[2]` 以下のみ・0 件ならスキップする」を「`severity` 2 以下のみ・0 件ならスキップする」に置き換える。`source` には正本 JSON の内容をそのまま渡す。

- [ ] **Step 4: Step 11（IDE で開く確認）を difit 起動に置き換える**

Step 11 を以下に置き換える:

```markdown
11. 保存した報告書を difit で開く
   - `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <保存した JSON の絶対パス> --diff <head_commit> <base_commit>` を実行する
   - 出力（key=value 形式）の `url=` をユーザーに提示する
   - `unanchored=` に指摘 ID がある場合、それらは difit に表示されないため Step 12 の報告に指摘本文を含める
   - stderr に `error=` が出力された場合は difit 起動を諦め、保存先パスの提示にフォールバックする（レビュー自体は成功として扱う）
   - 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入する
```

- [ ] **Step 5: Step 12（最終報告）を更新する**

Step 12 を以下に置き換える:

```markdown
12. 以下をユーザーに伝えて終了する: 正本 JSON の保存先パス、difit の URL（起動できた場合）、difit に載らなかった指摘（`unanchored=` 対象）の本文、教訓蓄積をバックグラウンドで起動した旨（スキップ時はその旨）
```

- [ ] **Step 6: 検証**

- Grep で `review__diff/SKILL.md` に `document-saver スキルで` の残存が無いこと、`difit-review.ts` / `format-review-result-json.md` への参照があることを確認する
- ファイル全体を読み、Step 番号の連番と参照整合（「Step 2 で取得したハッシュ」等）が崩れていないことを確認する

---

### Task 5: review:file の JSON 化と difit 起動

**Files:**
- Modify: `cbo/skills/review__file/SKILL.md`

**Interfaces:**
- Consumes: Task 1 のスキーマ定義書、Task 2 の `launch ... --file` CLI、Task 3 の `**位置**` 欄
- Produces: `base_commit` / `head_commit` が null の正本 JSON 報告書と sidecar

- [ ] **Step 1: Step 2（レビュー実行）に位置出力の指示を追加する**

Step 2 の末尾に以下を追加する:

```markdown
  - 各サブエージェントへの指示に「各指摘には対象ファイルの行番号に基づく `**位置**` 欄（side は new、行番号はファイル全体の行番号）を必ず記載すること」を含める
```

- [ ] **Step 2: Step 3〜4（統合・保存）を JSON 出力に置き換える**

Step 3 と Step 4 を以下に置き換える:

```markdown
3. 全サブエージェントのレビュー結果を統合し、正本 JSON 報告書を組み立てて保存する
   - スキーマは `cbo/skills/document-saver/references/format-review-result-json.md` に従う。document-saver スキルは使わず Write ツールで直接保存する
   - `reporter` は固定で `ClaudeCode review:file`。`model` は実行中の自身のモデル名（不明なら `unknown`）
   - `base_commit` / `head_commit` はどちらも `null`
   - 各指摘を `findings[]` の要素にする（`id` は R000 形式の連番、`reporter` に担当サブエージェント名、`**位置**` 欄から `file` / `anchor` を組み立て、`anchor.side` は `new`）
   - `evaluation` は全指摘 `{ "value": null, "directive": null }` で初期化する
   - 対象ファイル中の秘密情報（トークン・鍵など）を `problem` / `reason` / `proposals` に転記しない（difit のコメント本文に載るため）
   - ファイル名は `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`。タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得し、!`echo $MGZL_DIR`/reviews/ に保存する
4. 保存した報告書を difit で開く
   - `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <保存した JSON の絶対パス> --file <レビュー対象ファイルの相対パス>` を実行する
   - 出力の `url=` をユーザーに提示し、`unanchored=` に指摘 ID があればその本文を最終報告に含める
   - stderr に `error=` が出力された場合は difit 起動を諦め、保存先パスの提示にフォールバックする
   - 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入する
```

- [ ] **Step 3: Step 5〜7 を更新する**

- Step 5（知見蓄積）: Task 4 Step 3 と同じ読み替え（`severity` 3 以上 / 2 以下スキップ、`source` は正本 JSON）を適用する
- Step 6（IDE で開くか尋ねる）: **削除する**（Step 4 の difit 起動に置き換わったため）
- Step 7 → 6 に繰り上げ、内容を「レビュー結果の保存先パスと difit の URL、教訓蓄積をバックグラウンドで起動した旨（スキップ時はその旨）をユーザーに伝え終了する」に更新する

- [ ] **Step 4: 検証**

Grep で `review__file/SKILL.md` に `document-saver スキルで` / `open_file_in_editor` の残存が無いこと、Step 番号が 1〜6 の連番であることを確認する。

---

### Task 6: review:fix の JSON 対応と difit 評価取得

**Files:**
- Modify: `cbo/skills/review__fix/SKILL.md`

**Interfaces:**
- Consumes: Task 1 のスキーマ（`findings[].evaluation` 等）、Task 2 の `comments <port>` CLI、Task 4/5 が書く sidecar `<報告書名>.difit-session.json`
- Produces: 正本 JSON の `evaluation` フィールドへの書き戻し（これのみ編集可）。md 報告書の従来フローは無変更で維持

- [ ] **Step 1: 引数の解釈ルールを両形式対応にする**

「コンテキスト」セクションの `- \`.md\` で終わるトークン → レビュー報告書のファイルパス（省略可。報告書は必ず \`.md\` で保存されるため、これで自然言語指定と区別する）` を以下に置き換える:

```markdown
  - `.json` または `.md` で終わるトークン → レビュー報告書のファイルパス（省略可。報告書は必ずこのいずれかの拡張子で保存されるため、これで自然言語指定と区別する）
```

また、「レビュー報告書のフォーマットは…」の行を以下に置き換える:

```markdown
- レビュー報告書のフォーマット: JSON 報告書は `cbo/skills/document-saver/references/format-review-result-json.md`、md 報告書（旧形式・review:plan 由来）は `cbo/skills/document-saver/references/format-review-result.md` を参照する
```

- [ ] **Step 2: タスク 1（報告書特定）の候補取得を両形式にする**

タスク 1 の「`!`echo $MGZL_DIR`/reviews/` 配下の最新 5 件を取得し」を「`!`echo $MGZL_DIR`/reviews/` 配下の報告書（`.json` と `.md`。`.difit-session.json` は除外）の最新 5 件を取得し」に置き換える。

- [ ] **Step 3: タスク 2 の冒頭に JSON 報告書の分岐を追加する**

タスク 2 の冒頭（「候補集合を決定する:」の前）に以下を追加する:

```markdown
  - **報告書が JSON の場合**、指摘の抽出前に difit から人間の評価を取り込む:
    1. 報告書と同じディレクトリの sidecar `<報告書名（.json を除く）>.difit-session.json` を探す
    2. sidecar があれば `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" comments <sidecar の port>` を実行する
    3. 成功したら、各スレッドの `messages[0]`（エージェントの指摘。body 先頭の R-ID で `findings` と突合する）より後のメッセージを人間の返信として解釈する:
       - 先頭トークンが `tp` / `fp` / `nit` / `oos` → `evaluation.value`
       - `対応：` 以降のテキスト → `evaluation.directive`
       - 評価値の無い返信 → 全文を `evaluation.directive`
       - 同一スレッドに複数の返信がある場合は最後の返信を採用する
    4. 解釈結果を正本 JSON の `evaluation` フィールドに書き戻す（**書き戻してよいのは `evaluation` のみ**。他フィールドは変更しない）
    5. `error=` で失敗した（difit が落ちている）場合: 正本 JSON 内の `evaluation` に記入済みの値があればそれをそのまま使う。評価が必要なのに全指摘未評価なら、AskUserQuestion で「review:open で difit を再起動して評価を記入する / 未評価のまま続行する / 中止する」を提示する
  - JSON 報告書では、以降の手順の読み替えを行う:
    - 「`### R*` 指摘」→ `findings[]` の要素
    - 見出しの重要度 `[N]` → `severity`
    - `**問題**`/`**理由**`/`**報告者**`/`**提案**` → `problem` / `reason` / `reporter` / `proposals`
    - 対象ファイルの判断 → `file` フィールド（本文からの推測は不要）
    - `評価：` の値 → `evaluation.value`、`対応：` の記述 → `evaluation.directive`（human_directive として扱う）
    - 複数案フラグ → `proposals` の要素数が 2 以上（採用案の識別子は `proposals[].label`）
```

- [ ] **Step 4: サブエージェント向けプロンプトと注意事項の文言を更新する**

- タスク 6 のプロンプト雛形内「## 人間からの追加指示（見出し行の `対応：` 欄より）」を「## 人間からの追加指示（difit 返信または `対応：` 欄より）」に置き換える
- 同雛形の注意「報告書ファイル自体は編集しない（見出し行末尾の `評価：` / `対応：` はいずれも人間が記入する欄であり、エージェントは触らない）」を「報告書ファイル自体は編集しない（`evaluation` の書き戻しは呼び出し元スキルだけが行う）」に置き換える
- 「注意事項」セクションの「報告書 Markdown の見出し行末尾の `評価：` は人間が手動記入する唯一の入力経路。エージェントは触らない」を以下に置き換える:

```markdown
- 人間の評価・指示の入力経路: JSON 報告書は difit スレッドへの返信（または `evaluation` フィールドの直接編集）、md 報告書は従来どおり見出し行末尾の `評価：`/`対応：`。本スキルが JSON 報告書に書き戻してよいのは `evaluation` フィールドのみ
```

- [ ] **Step 5: 検証**

- Grep で `review__fix/SKILL.md` に `.json` / `difit-session` / `comments <` の参照が入ったことを確認する
- ファイル全体を読み、md 報告書の従来フロー（`評価：`/`対応：` パース、タスク 3〜9）が変更されずに残っていることを確認する

---

### Task 7: 新スキル review:open の作成

**Files:**
- Create: `cbo/skills/review__open/SKILL.md`

**Interfaces:**
- Consumes: Task 1 のスキーマ、Task 2 の `launch` CLI（--diff / --file 両モード）
- Produces: 既存報告書（JSON / md）を difit で開く機能。`--save` 時は md から変換した正本 JSON を `$MGZL_DIR/reviews/` に保存

- [ ] **Step 1: SKILL.md を作成する**

`cbo/skills/review__open/SKILL.md` を以下の内容で作成する:

````markdown
---
name: review:open
description: 保存済みのレビュー報告書（JSON または旧 md 形式）を difit（diff ビューア）で開き、各指摘を該当行のコメントとして表示する。「レビュー報告書を difit で開いて」「difit で開いて」「レビューを difit で見せて」「review open」などの依頼時に使用する。
argument-hint: [report file path] [--save]
model: sonnet
---

## コンテキスト

- 引数: $ARGUMENTS
  - `.json` / `.md` で終わるトークン → レビュー報告書のパス
  - `--save` フラグ → md 報告書から推測・変換した内容を正本 JSON として保存する
- 正本 JSON のスキーマ: `cbo/skills/document-saver/references/format-review-result-json.md`

## タスク

1. 報告書を特定する
  - 引数にパスがあればそれを使う
  - 無ければ !`echo $MGZL_DIR`/reviews/ 配下の報告書（`.json` と `.md`。`.difit-session.json` は除外）の最新 5 件から AskUserQuestion で選択させる
2. 報告書の形式で分岐する

### JSON 報告書の場合

3. 報告書を読み、`base_commit` / `head_commit` を確認する
  - 両方に SHA がある場合: `git cat-file -e <sha>^{commit}` で双方の存在を確認する。存在しない SHA がある場合（rebase / GC 後）はその旨を報告して中止する
    - 存在すれば `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <報告書の絶対パス> --diff <head_commit> <base_commit>`
  - 両方 `null` の場合（review:file 由来）: `findings[].file` の代表値（通常は全指摘で共通）を対象に
    `bun run "${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts" launch <報告書の絶対パス> --file <対象ファイルの相対パス>`
    を実行する。報告書作成後にファイルが変更されていると行がズレる可能性がある旨をユーザーに伝える
4. `--save` が指定されていた場合、JSON 報告書には不要である旨を伝える（既に正本のため。処理は継続する）

### md 報告書の場合（旧形式。推測ベースのベストエフォート）

3. 報告書をパースして正本 JSON と同じ構造を組み立てる
  - フロントマターの `reporter` / `model` / `base_commit` / `head_commit` を引き継ぐ（無い項目は `unknown` または `null`）
  - `### R*` 見出しごとに `id` / `severity`（`[N]`）/ `problem`（`**問題**`）/ `reason`（`**理由**`）/ `reporter`（`**報告者**`）/ `proposals`（`**提案**`。`**案A**`/`**案B**` があれば分割）を抽出する
  - 見出し行末尾の `評価：` / `対応：` の記入があれば `evaluation` に引き継ぐ
  - `file` / `anchor` は `**問題**`・`**提案**` 本文中のファイルパス・行番号の記述から**推測**する。推測できなければ `file: null`
4. 推測結果の要約（各 ID → `file:line`）をユーザーに提示し、誤アンカーの可能性がある旨を明示する
5. 組み立てた JSON を保存する
  - `--save` 指定時: `yyyyMMdd-hhmmss-<元のファイル名の英語部分>-converted.json` として !`echo $MGZL_DIR`/reviews/ に保存する（タイムスタンプは `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"` で取得。元の md は移動・削除しない）
  - `--save` なし: !`echo $MGZL_DIR`/tmp/ に一時ファイルとして保存する
6. diff 対象を決めて起動する
  - `base_commit` / `head_commit` が引き継げて双方実在する → `launch <JSON パス> --diff <head_commit> <base_commit>`
  - 引き継げない → 対象ファイル（findings の `file` の代表値）で `launch <JSON パス> --file <相対パス>`。現在のワークツリーに対して開くため行ズレの可能性がある旨を明示する
  - 対象ファイルすら特定できない場合はその旨を報告して中止する

### 共通の仕上げ

- 出力の `url=` をユーザーに提示する。`unanchored=` に指摘 ID があればその本文をターミナルに表示する
- 評価の記入方法を案内する: difit の各指摘スレッドに**返信**で `tp / fp / nit / oos`（必要なら続けて `対応：<指示>`）を記入し、修正は review:fix を呼び出す
- stderr に `error=` が出力された場合は difit 起動を諦め、報告書パスの提示にフォールバックする

## 注意事項

- このスキルはレビュー対象コードを修正しない。正本 JSON の新規保存（`--save` / 一時ファイル）以外の既存ファイル編集も行わない
- 秘密情報（トークン・鍵など）が報告書に含まれる場合、コメント本文へ転記しない
````

- [ ] **Step 2: 検証**

- フロントマターに `name` / `description` / `argument-hint` / `model` が揃っていること、`description` 末尾にトリガーフレーズが 4 個あることを確認する
- Grep で `review__open/SKILL.md` から `difit-review.ts` / `format-review-result-json.md` への参照があることを確認する

---

### Task 8: README・設計書の整合

**Files:**
- Modify: `cbo/README.md`
- Modify: `docs/superpowers/specs/2026-07-17-difit-review-migration-design.md`（ステータス行のみ）

**Interfaces:**
- Consumes: Task 1〜7 の成果物
- Produces: ドキュメント整合

- [ ] **Step 1: README のディレクトリ説明を更新する**

`cbo/README.md` の `├── reviews/                  # レビュー結果` を以下に置き換える:

```markdown
├── reviews/                  # レビュー結果（正本 JSON・difit セッション sidecar・旧 md 報告書）
```

（注: `cbo/.claude-plugin/plugin.json` には `version` フィールドが存在せず、リポジトリ内でバージョン管理は実運用されていないため、バージョン更新は行わない）

- [ ] **Step 2: 設計書のステータスを更新する**

設計書冒頭の `- ステータス: 承認済み（実装計画未着手）` を `- ステータス: 実装済み（計画: docs/superpowers/plans/2026-07-17-difit-review-migration.md）` に置き換える。

- [ ] **Step 3: 横断整合チェック**

- Grep で `cbo/` 配下に「レビュー報告書は必ず `.md`」前提の残存記述が無いことを確認する（検索語: `必ず \`.md\``、`document-saver スキルで`。review:plan と document-saver 本体の md 記述は対象外）
- Grep で `${CLAUDE_PLUGIN_ROOT}/scripts/difit-review.ts` を参照するスキルが review:diff / review:file / review:fix / review:open の 4 つであることを確認する
- `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/scripts/difit-review.test.ts` が PASS のままであることを確認する
- 最後に全タスクの変更ファイル一覧を `git status` で確認し、ユーザーに変更サマリーを報告する（コミットはしない）
