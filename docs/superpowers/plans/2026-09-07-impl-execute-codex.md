# impl__execute-codex 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実装計画書のステップを Codex CLI（GPT-6 Astra、effort low）に 1 ステップずつ実装させる実験用スキル `impl__execute-codex` を追加する。

**Architecture:** `cbo/skills/impl__execute-codex/` に SKILL.md、bun スクリプト 2 本（前提チェック、1 ステップ実行）、Codex に渡す規約ヘッダ 2 本を置く。純粋なロジック（JSONL 解析、変更ファイル算出、コマンド組み立て）は `scripts/lib/` に分離して bun test で検証し、サブプロセス起動は偽の codex スクリプトで検証する。ミューテーションテストとレビューは既存の Claude エージェントを使い、修正だけ Codex に戻す。

**Tech Stack:** TypeScript、bun 1.3.1（`Bun.spawn`、`bun test`）、Codex CLI 0.153.4（`codex exec --json`）

**Spec:** `docs/superpowers/specs/2026-09-07-impl-execute-codex-design.md`

## Global Constraints

- モデルは `gpt-6-astra`、effort は `low` を固定。スクリプト引数からは変更不可
- Codex が使用不能なら停止。Claude エージェントでの実装にフォールバックしない
- スクリプトは TypeScript、`bun run` で実行。出力は key=value 形式（1 行 1 項目）、Markdown 表は使わない
- スクリプトのパス参照は `${CLAUDE_SKILL_DIR}/scripts/<script>`
- SKILL.md のフロントマターは `name`、`description` 必須。`description` は説明文の後に「」付きトリガーフレーズを 3〜5 個
- SKILL.md は 500 行以内
- 既存の `impl__execute`、`cbo/agents/`、codex プラグインには手を入れない
- `!`/`as`/`any` は極力使わない。使う場合は理由コメント
- コメントは「コードから読み取れない理由」だけ。「してはならない」系は書かない
- コミットはユーザーの明示的な指示があるときだけ行う（各タスク末尾にコミット手順は置かない）
- Bash は 1 コマンド 1 目的。`cd`、`&&`、変数代入を使わない。テストは `bun test <ファイルの絶対パス>` で実行する

---

## ファイル構成

- Create: `cbo/skills/impl__execute-codex/SKILL.md` — スキル本体。既存 `impl__execute/SKILL.md` を複製し、ディスパッチ部分を Codex 呼び出しに置換
- Create: `cbo/skills/impl__execute-codex/scripts/lib/codex-events.ts` — JSONL イベントの解析（純粋関数）
- Create: `cbo/skills/impl__execute-codex/scripts/lib/codex-events.test.ts`
- Create: `cbo/skills/impl__execute-codex/scripts/lib/changed-files.ts` — `git status --porcelain` 出力の差分から変更ファイルを求める（純粋関数）
- Create: `cbo/skills/impl__execute-codex/scripts/lib/changed-files.test.ts`
- Create: `cbo/skills/impl__execute-codex/scripts/lib/codex-command.ts` — codex コマンド配列の組み立てとバイナリ差し替え（純粋関数）
- Create: `cbo/skills/impl__execute-codex/scripts/lib/codex-command.test.ts`
- Create: `cbo/skills/impl__execute-codex/scripts/check-codex.ts` — 前提チェック
- Create: `cbo/skills/impl__execute-codex/scripts/check-codex.test.ts`
- Create: `cbo/skills/impl__execute-codex/scripts/run-codex-step.ts` — 1 ステップ実行
- Create: `cbo/skills/impl__execute-codex/scripts/run-codex-step.test.ts`
- Create: `cbo/skills/impl__execute-codex/scripts/test-fixtures/fake-codex.ts` — テスト用の偽 codex
- Create: `cbo/skills/impl__execute-codex/references/codex-header-impl.md` — 本体コード実装用の規約ヘッダ
- Create: `cbo/skills/impl__execute-codex/references/codex-header-test.md` — テスト実装用の規約ヘッダ

以下、パスはすべてリポジトリルート `/Users/otto/workspace/mgzl-claude-code-plugin/` からの相対パス。スキルディレクトリを `SKILL_DIR` = `cbo/skills/impl__execute-codex` と略記する。

---

### Task 1: JSONL イベント解析 `codex-events.ts`

**Files:**
- Create: `SKILL_DIR/scripts/lib/codex-events.ts`
- Test: `SKILL_DIR/scripts/lib/codex-events.test.ts`

**Interfaces:**
- Produces: `parseCodexEvents(jsonl: string): CodexEventSummary` と型 `CodexEventSummary = { errors: string[]; turnFailed: boolean; turnCompleted: boolean }`。Task 5 の `run-codex-step.ts` が使う

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// SKILL_DIR/scripts/lib/codex-events.test.ts
import { describe, expect, it } from "bun:test";
import { parseCodexEvents } from "./codex-events";

describe("parseCodexEvents", () => {
  it("正常終了の JSONL では errors が空で turnCompleted が true になる", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","exit_code":0,"status":"completed"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ].join("\n");

    const summary = parseCodexEvents(jsonl);

    expect(summary).toStrictEqual({ errors: [], turnFailed: false, turnCompleted: true });
  });

  it("type が error のイベントは message を errors に集める", () => {
    const jsonl = '{"type":"error","message":"quota exceeded"}';

    const summary = parseCodexEvents(jsonl);

    expect(summary.errors).toStrictEqual(["quota exceeded"]);
  });

  it("turn.failed は error.message を errors に集め turnFailed を true にする", () => {
    const jsonl = '{"type":"turn.failed","error":{"message":"model not supported"}}';

    const summary = parseCodexEvents(jsonl);

    expect(summary).toStrictEqual({
      errors: ["model not supported"],
      turnFailed: true,
      turnCompleted: false,
    });
  });

  it("item.type が error の item.completed は警告扱いで errors に入れない", () => {
    const jsonl =
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"metadata not found"}}';

    const summary = parseCodexEvents(jsonl);

    expect(summary.errors).toStrictEqual([]);
  });

  it("JSON として不正な行と空行は読み飛ばす", () => {
    const jsonl = ['not json', '', '{"type":"turn.completed"}'].join("\n");

    const summary = parseCodexEvents(jsonl);

    expect(summary.turnCompleted).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/codex-events.test.ts`
Expected: FAIL（`codex-events` モジュールが見つからない）

- [ ] **Step 3: 実装する**

```typescript
// SKILL_DIR/scripts/lib/codex-events.ts

/** codex exec --json の JSONL を読み、失敗判定に必要な情報だけを抜き出した結果 */
export type CodexEventSummary = {
  errors: string[];
  turnFailed: boolean;
  turnCompleted: boolean;
};

type ParsedEvent = {
  type?: unknown;
  message?: unknown;
  error?: { message?: unknown };
};

const parseLine = (line: string): ParsedEvent | undefined => {
  if (line.trim() === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null) {
      // JSON.parse の戻り値は unknown なので、フィールドを任意参照するための最小限の形に絞る
      return parsed as ParsedEvent;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const toMessage = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

export const parseCodexEvents = (jsonl: string): CodexEventSummary => {
  const summary: CodexEventSummary = { errors: [], turnFailed: false, turnCompleted: false };

  for (const line of jsonl.split("\n")) {
    const event = parseLine(line);
    if (event === undefined) {
      continue;
    }
    if (event.type === "error") {
      summary.errors.push(toMessage(event.message));
    } else if (event.type === "turn.failed") {
      summary.turnFailed = true;
      summary.errors.push(toMessage(event.error?.message));
    } else if (event.type === "turn.completed") {
      summary.turnCompleted = true;
    }
  }

  return summary;
};
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/codex-events.test.ts`
Expected: PASS（5 件）

---

### Task 2: 変更ファイル算出 `changed-files.ts`

**Files:**
- Create: `SKILL_DIR/scripts/lib/changed-files.ts`
- Test: `SKILL_DIR/scripts/lib/changed-files.test.ts`

**Interfaces:**
- Produces: `parsePorcelain(output: string): Set<string>` と `diffChangedFiles(args: { before: Set<string>; after: Set<string> }): string[]`。Task 5 が使う

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// SKILL_DIR/scripts/lib/changed-files.test.ts
import { describe, expect, it } from "bun:test";
import { diffChangedFiles, parsePorcelain } from "./changed-files";

describe("parsePorcelain", () => {
  it("2 文字のステータスと空白を除いたパスの集合を返す", () => {
    const output = [" M src/a.ts", "?? src/new.ts", "A  src/added.ts"].join("\n");

    const files = parsePorcelain(output);

    expect(files).toStrictEqual(new Set(["src/a.ts", "src/new.ts", "src/added.ts"]));
  });

  it("リネーム行は矢印の右側のパスを使う", () => {
    const output = "R  src/old.ts -> src/renamed.ts";

    const files = parsePorcelain(output);

    expect(files).toStrictEqual(new Set(["src/renamed.ts"]));
  });

  it("空出力は空集合になる", () => {
    expect(parsePorcelain("")).toStrictEqual(new Set());
  });
});

describe("diffChangedFiles", () => {
  it("after にだけ含まれるパスをソート済み配列で返す", () => {
    const before = new Set(["src/pre.ts"]);
    const after = new Set(["src/pre.ts", "src/z.ts", "src/a.ts"]);

    const changed = diffChangedFiles({ before, after });

    expect(changed).toStrictEqual(["src/a.ts", "src/z.ts"]);
  });

  it("実行前から変更済みだったファイルは含めない", () => {
    const before = new Set(["src/pre.ts"]);
    const after = new Set(["src/pre.ts"]);

    expect(diffChangedFiles({ before, after })).toStrictEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/changed-files.test.ts`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 実装する**

```typescript
// SKILL_DIR/scripts/lib/changed-files.ts

/** `git status --porcelain` の出力からパスの集合を作る */
export const parsePorcelain = (output: string): Set<string> => {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    // porcelain v1 は先頭 2 文字がステータス、3 文字目が空白、以降がパス
    const rawPath = line.slice(3);
    const arrowIndex = rawPath.indexOf(" -> ");
    files.add(arrowIndex >= 0 ? rawPath.slice(arrowIndex + 4) : rawPath);
  }
  return files;
};

/**
 * 実行前後の git status 差分から、Codex の実行によって新たに変更されたファイルを求める。
 * 実行前から変更済みだったファイルは Codex の成果か判別できないため除外する
 */
export const diffChangedFiles = (args: { before: Set<string>; after: Set<string> }): string[] =>
  [...args.after].filter((file) => !args.before.has(file)).sort();
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/changed-files.test.ts`
Expected: PASS（5 件）

---

### Task 3: コマンド組み立て `codex-command.ts`

**Files:**
- Create: `SKILL_DIR/scripts/lib/codex-command.ts`
- Test: `SKILL_DIR/scripts/lib/codex-command.test.ts`

**Interfaces:**
- Produces:
  - `resolveCodexBin(env: Record<string, string | undefined>): string[]` — 既定 `["codex"]`。`IMPL_EXECUTE_CODEX_BIN` があれば空白分割
  - `buildExecArgs(args: { cwd: string; lastMessageFile: string }): string[]` — `exec` 以降の引数配列。モデルと effort は定数
  - 定数 `CODEX_MODEL = "gpt-6-astra"`、`CODEX_EFFORT = "low"`
- Task 4、Task 5 が使う

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// SKILL_DIR/scripts/lib/codex-command.test.ts
import { describe, expect, it } from "bun:test";
import { buildExecArgs, resolveCodexBin } from "./codex-command";

describe("resolveCodexBin", () => {
  it("環境変数が無ければ codex 単体を返す", () => {
    expect(resolveCodexBin({})).toStrictEqual(["codex"]);
  });

  it("IMPL_EXECUTE_CODEX_BIN を空白で分割して返す", () => {
    const env = { IMPL_EXECUTE_CODEX_BIN: "bun run /tmp/fake-codex.ts" };

    expect(resolveCodexBin(env)).toStrictEqual(["bun", "run", "/tmp/fake-codex.ts"]);
  });

  it("空文字の環境変数は未設定として扱う", () => {
    expect(resolveCodexBin({ IMPL_EXECUTE_CODEX_BIN: "" })).toStrictEqual(["codex"]);
  });
});

describe("buildExecArgs", () => {
  it("モデルと effort を固定した exec 引数を組み立てる", () => {
    const args = buildExecArgs({ cwd: "/work/front", lastMessageFile: "/tmp/last.md" });

    expect(args).toStrictEqual([
      "exec",
      "-m",
      "gpt-6-astra",
      "-c",
      "model_reasoning_effort=low",
      "-s",
      "workspace-write",
      "-C",
      "/work/front",
      "--skip-git-repo-check",
      "--disable",
      "skill_search",
      "--json",
      "-o",
      "/tmp/last.md",
      "-",
    ]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/codex-command.test.ts`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 実装する**

```typescript
// SKILL_DIR/scripts/lib/codex-command.ts

/** 実験の比較条件を揃えるため、モデルと effort は呼び出し側から変更できない定数にしている */
export const CODEX_MODEL = "gpt-6-astra";
export const CODEX_EFFORT = "low";

/** テストで偽の codex に差し替えるための環境変数名 */
export const CODEX_BIN_ENV = "IMPL_EXECUTE_CODEX_BIN";

export const resolveCodexBin = (env: Record<string, string | undefined>): string[] => {
  const override = env[CODEX_BIN_ENV];
  if (override === undefined || override.trim() === "") {
    return ["codex"];
  }
  return override.trim().split(/\s+/);
};

export const buildExecArgs = (args: { cwd: string; lastMessageFile: string }): string[] => [
  "exec",
  "-m",
  CODEX_MODEL,
  "-c",
  `model_reasoning_effort=${CODEX_EFFORT}`,
  "-s",
  "workspace-write",
  "-C",
  args.cwd,
  "--skip-git-repo-check",
  // Codex 側の skills 探索を止め、渡したプロンプトだけで実装させる
  "--disable",
  "skill_search",
  "--json",
  "-o",
  args.lastMessageFile,
  // プロンプトは stdin から読ませる（長文を引数に載せない）
  "-",
];
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/lib/codex-command.test.ts`
Expected: PASS（4 件）

---

### Task 4: 偽 codex と前提チェック `check-codex.ts`

**Files:**
- Create: `SKILL_DIR/scripts/test-fixtures/fake-codex.ts`
- Create: `SKILL_DIR/scripts/check-codex.ts`
- Test: `SKILL_DIR/scripts/check-codex.test.ts`

**Interfaces:**
- Consumes: `resolveCodexBin` (Task 3)
- Produces:
  - `fake-codex.ts`: 環境変数 `FAKE_CODEX_MODE` で挙動を切り替える偽 codex。`version` サブコマンド以外は Task 5 で使う
    - `--version` → `codex-cli 0.0.0-fake` を出力し exit 0（`FAKE_CODEX_MODE=version_fail` なら stderr に `boom` を出して exit 2）
    - `exec ...` → `FAKE_CODEX_MODE` が `ok` / `nochange` / `error_event` / `nonzero_exit` / `no_last_message` に応じた JSONL・ファイル生成（Task 5 の Step 1 に仕様を記載）
  - `check-codex.ts`: stdout に `status=ok` `version=...` または `status=ng` `reason=not_found|exec_failed` `detail=...`。exit code は ok なら 0、ng なら 1

- [ ] **Step 1: 偽 codex を作る**

```typescript
#!/usr/bin/env bun
// SKILL_DIR/scripts/test-fixtures/fake-codex.ts
// テスト専用。実際の codex CLI の代わりに起動され、FAKE_CODEX_MODE に応じた出力とファイルを生成する

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_CODEX_MODE ?? "ok";
const argv = process.argv.slice(2);

const readOption = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (argv[0] === "--version") {
  if (mode === "version_fail") {
    console.error("boom");
    process.exit(2);
  }
  console.log("codex-cli 0.0.0-fake");
  process.exit(0);
}

if (argv[0] !== "exec") {
  console.error(`unexpected args: ${argv.join(" ")}`);
  process.exit(3);
}

const cwd = readOption("-C");
const lastMessageFile = readOption("-o");
if (cwd === undefined || lastMessageFile === undefined) {
  console.error("missing -C or -o");
  process.exit(3);
}

// 受け取ったプロンプトを記録し、テスト側でヘッダ連結を検証できるようにする
const prompt = await Bun.stdin.text();
writeFileSync(join(cwd, ".fake-codex-prompt.txt"), prompt);

const emit = (event: Record<string, unknown>): void => {
  console.log(JSON.stringify(event));
};

emit({ type: "thread.started", thread_id: "fake-thread" });
emit({ type: "turn.started" });

if (mode === "error_event") {
  emit({ type: "error", message: "quota exceeded" });
  emit({ type: "turn.failed", error: { message: "quota exceeded" } });
  process.exit(1);
}

if (mode === "nonzero_exit") {
  console.error("codex crashed");
  process.exit(1);
}

if (mode === "ok") {
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "generated.ts"), "export const generated = true;\n");
}

emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });

if (mode !== "no_last_message") {
  writeFileSync(lastMessageFile, "実装しました。\n変更: src/generated.ts\n");
}

process.exit(0);
```

- [ ] **Step 2: check-codex の失敗するテストを書く**

```typescript
// SKILL_DIR/scripts/check-codex.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "check-codex.ts");
const fakeCodex = `bun run ${join(import.meta.dir, "test-fixtures", "fake-codex.ts")}`;

const runCheck = async (env: Record<string, string>): Promise<{ stdout: string; exitCode: number }> => {
  const proc = Bun.spawn(["bun", "run", scriptPath], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
};

describe("check-codex", () => {
  it("codex --version が成功すれば status=ok と version を出力する", async () => {
    const result = await runCheck({ IMPL_EXECUTE_CODEX_BIN: fakeCodex, FAKE_CODEX_MODE: "ok" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status=ok\nversion=codex-cli 0.0.0-fake\n");
  });

  it("バイナリが見つからなければ status=ng reason=not_found を出力する", async () => {
    const result = await runCheck({ IMPL_EXECUTE_CODEX_BIN: "/nonexistent/codex-xyz" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("status=ng\n");
    expect(result.stdout).toContain("reason=not_found\n");
  });

  it("codex --version が非 0 で終わればreason=exec_failed と stderr 先頭行を出力する", async () => {
    const result = await runCheck({
      IMPL_EXECUTE_CODEX_BIN: fakeCodex,
      FAKE_CODEX_MODE: "version_fail",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("status=ng\nreason=exec_failed\ndetail=boom\n");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/check-codex.test.ts`
Expected: FAIL（`check-codex.ts` が無く `bun run` が非 0 で終わる）

- [ ] **Step 4: check-codex.ts を実装する**

```typescript
#!/usr/bin/env bun
// SKILL_DIR/scripts/check-codex.ts

import { resolveCodexBin } from "./lib/codex-command";

const printNg = (args: { reason: string; detail: string }): never => {
  console.log("status=ng");
  console.log(`reason=${args.reason}`);
  console.log(`detail=${args.detail}`);
  process.exit(1);
};

const command = resolveCodexBin(process.env);

let proc: ReturnType<typeof Bun.spawn>;
try {
  proc = Bun.spawn([...command, "--version"], { stdout: "pipe", stderr: "pipe" });
} catch (error) {
  // Bun.spawn は実行ファイルが存在しないとき同期的に throw する
  printNg({ reason: "not_found", detail: error instanceof Error ? error.message : String(error) });
}

const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

if (exitCode !== 0) {
  printNg({ reason: "exec_failed", detail: stderr.split("\n")[0] ?? "" });
}

console.log("status=ok");
console.log(`version=${stdout.trim()}`);
```

`let proc` の後に `printNg` が `never` を返すため、TypeScript は catch 後の `proc` を確定代入済みと判断する。もし `bun run` で「使用前に代入されていない」エラーが出る場合は、`proc` の宣言を `const proc = (() => { try { return Bun.spawn(...) } catch (error) { return printNg(...) } })();` の形に書き換える。

- [ ] **Step 5: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/check-codex.test.ts`
Expected: PASS（3 件）

`not_found` のテストで Bun が throw ではなく exit code 非 0 のプロセスを返す場合は、テストの期待を `reason=exec_failed` ではなく実際の挙動に合わせず、実装側で `stderr` に `No such file` / `ENOENT` を含むときは `reason=not_found` にする分岐を追加する。

---

### Task 5: 1 ステップ実行 `run-codex-step.ts`

**Files:**
- Create: `SKILL_DIR/scripts/run-codex-step.ts`
- Test: `SKILL_DIR/scripts/run-codex-step.test.ts`
- 依存: `SKILL_DIR/references/codex-header-impl.md`、`codex-header-test.md`（Task 6 で本文を書く。このタスクではテスト用に 1 行の仮ファイルを置き、Task 6 で本文に差し替える）

**Interfaces:**
- Consumes: `parseCodexEvents` (Task 1)、`parsePorcelain` / `diffChangedFiles` (Task 2)、`resolveCodexBin` / `buildExecArgs` (Task 3)、`fake-codex.ts` (Task 4)
- Produces: CLI。引数 `--prompt <file> --cwd <dir> --role <impl|test>`。stdout は以下のいずれか
  - `status=ok` / `changed_files=<カンマ区切り>` / `last_message_file=<path>` / `summary=<最終メッセージ先頭行>`
  - `status=error` / `reason=<nonzero_exit|error_event|no_last_message|no_changes|git_failed|invalid_args>` / `detail=<要約>`
  - exit code は ok なら 0、error なら 1

- [ ] **Step 1: 仮の規約ヘッダを置く**

`SKILL_DIR/references/codex-header-impl.md` に 1 行 `# HEADER-IMPL` を、`SKILL_DIR/references/codex-header-test.md` に 1 行 `# HEADER-TEST` を書く（Task 6 で本文に差し替える）。

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// SKILL_DIR/scripts/run-codex-step.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "run-codex-step.ts");
const fakeCodex = `bun run ${join(import.meta.dir, "test-fixtures", "fake-codex.ts")}`;

type RunResult = { stdout: string; exitCode: number; lines: Record<string, string> };

const parseLines = (stdout: string): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      record[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return record;
};

const gitInit = async (dir: string): Promise<void> => {
  const init = Bun.spawn(["git", "init", "-q", dir], { stdout: "ignore", stderr: "ignore" });
  await init.exited;
};

let workDir: string;
let promptFile: string;

beforeEach(async () => {
  workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "run-codex-step-"));
  await gitInit(workDir);
  promptFile = join(workDir, "prompt.md");
  writeFileSync(promptFile, "## ステップ 1\nfoo を実装する\n");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const runStep = async (args: {
  mode: string;
  role?: string;
  extraArgs?: string[];
}): Promise<RunResult> => {
  const cliArgs =
    args.extraArgs ?? ["--prompt", promptFile, "--cwd", workDir, "--role", args.role ?? "impl"];
  const proc = Bun.spawn(["bun", "run", scriptPath, ...cliArgs], {
    env: { ...process.env, IMPL_EXECUTE_CODEX_BIN: fakeCodex, FAKE_CODEX_MODE: args.mode },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode, lines: parseLines(stdout) };
};

describe("run-codex-step", () => {
  it("成功時は status=ok と変更ファイル・最終メッセージを出力する", async () => {
    const result = await runStep({ mode: "ok" });

    expect(result.exitCode).toBe(0);
    expect(result.lines.status).toBe("ok");
    expect(result.lines.changed_files).toBe("src/generated.ts");
    expect(result.lines.summary).toBe("実装しました。");
    expect(existsSync(result.lines.last_message_file ?? "")).toBe(true);
  });

  it("role に応じた規約ヘッダをプロンプトの先頭に連結して渡す", async () => {
    await runStep({ mode: "ok", role: "test" });

    const received = readFileSync(join(workDir, ".fake-codex-prompt.txt"), "utf8");
    expect(received.startsWith("# HEADER-TEST")).toBe(true);
    expect(received).toContain("## ステップ 1\nfoo を実装する");
  });

  it("実行前から変更済みだったファイルは changed_files に含めない", async () => {
    writeFileSync(join(workDir, "pre-existing.txt"), "dirty\n");

    const result = await runStep({ mode: "ok" });

    expect(result.lines.changed_files).toBe("src/generated.ts");
  });

  it("error イベントがあれば reason=error_event で停止する", async () => {
    const result = await runStep({ mode: "error_event" });

    expect(result.exitCode).toBe(1);
    expect(result.lines.status).toBe("error");
    expect(result.lines.reason).toBe("error_event");
    expect(result.lines.detail).toContain("quota exceeded");
  });

  it("非 0 終了で error イベントが無ければ reason=nonzero_exit", async () => {
    const result = await runStep({ mode: "nonzero_exit" });

    expect(result.lines.reason).toBe("nonzero_exit");
    expect(result.lines.detail).toContain("codex crashed");
  });

  it("最終メッセージファイルが無ければ reason=no_last_message", async () => {
    const result = await runStep({ mode: "no_last_message" });

    expect(result.lines.reason).toBe("no_last_message");
  });

  it("変更ファイルが 0 件なら reason=no_changes", async () => {
    const result = await runStep({ mode: "nochange" });

    expect(result.lines.reason).toBe("no_changes");
  });

  it("cwd が git 管理外なら reason=git_failed", async () => {
    const plainDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "no-git-"));
    const result = await runStep({
      mode: "ok",
      extraArgs: ["--prompt", promptFile, "--cwd", plainDir, "--role", "impl"],
    });
    rmSync(plainDir, { recursive: true, force: true });

    expect(result.lines.reason).toBe("git_failed");
  });

  it("引数が不足していれば reason=invalid_args", async () => {
    const result = await runStep({ mode: "ok", extraArgs: ["--prompt", promptFile] });

    expect(result.exitCode).toBe(1);
    expect(result.lines.reason).toBe("invalid_args");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/run-codex-step.test.ts`
Expected: FAIL（`run-codex-step.ts` が無い）

- [ ] **Step 4: run-codex-step.ts を実装する**

```typescript
#!/usr/bin/env bun
// SKILL_DIR/scripts/run-codex-step.ts

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffChangedFiles, parsePorcelain } from "./lib/changed-files";
import { buildExecArgs, resolveCodexBin } from "./lib/codex-command";
import { parseCodexEvents } from "./lib/codex-events";

type Role = "impl" | "test";

const printError = (args: { reason: string; detail: string }): never => {
  console.log("status=error");
  console.log(`reason=${args.reason}`);
  // 複数行の detail は key=value 形式を崩すので 1 行に潰す
  console.log(`detail=${args.detail.replace(/\s*\n\s*/g, " / ").trim()}`);
  process.exit(1);
};

const readOption = (name: string): string | undefined => {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const isRole = (value: string | undefined): value is Role => value === "impl" || value === "test";

const promptPath = readOption("--prompt");
const cwd = readOption("--cwd");
const role = readOption("--role");

if (promptPath === undefined || cwd === undefined || !isRole(role)) {
  printError({
    reason: "invalid_args",
    detail: "usage: run-codex-step.ts --prompt <file> --cwd <dir> --role <impl|test>",
  });
}

const gitStatus = async (): Promise<Set<string>> => {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    printError({ reason: "git_failed", detail: stderr });
  }
  return parsePorcelain(stdout);
};

const headerPath = join(import.meta.dir, "..", "references", `codex-header-${role}.md`);
const header = readFileSync(headerPath, "utf8");
const body = readFileSync(promptPath, "utf8");

const workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "impl-execute-codex-"));
const fullPromptFile = join(workDir, "prompt.md");
const lastMessageFile = join(workDir, "last-message.md");
writeFileSync(fullPromptFile, `${header}\n\n---\n\n${body}`);

const before = await gitStatus();

const proc = Bun.spawn([...resolveCodexBin(process.env), ...buildExecArgs({ cwd, lastMessageFile })], {
  cwd,
  stdin: Bun.file(fullPromptFile),
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

const events = parseCodexEvents(stdout);
if (events.errors.length > 0 || events.turnFailed) {
  printError({ reason: "error_event", detail: events.errors.join(" / ") });
}
if (exitCode !== 0) {
  printError({ reason: "nonzero_exit", detail: `exit=${exitCode} ${stderr}` });
}
if (!existsSync(lastMessageFile)) {
  printError({ reason: "no_last_message", detail: lastMessageFile });
}

const after = await gitStatus();
const changedFiles = diffChangedFiles({ before, after });
if (changedFiles.length === 0) {
  const firstLine = readFileSync(lastMessageFile, "utf8").split("\n")[0] ?? "";
  printError({ reason: "no_changes", detail: firstLine });
}

const summary = readFileSync(lastMessageFile, "utf8").split("\n")[0] ?? "";
console.log("status=ok");
console.log(`changed_files=${changedFiles.join(",")}`);
console.log(`last_message_file=${lastMessageFile}`);
console.log(`summary=${summary}`);
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/run-codex-step.test.ts`
Expected: PASS（9 件）

- [ ] **Step 6: スキル配下の全テストを通す**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts`
Expected: PASS（Task 1〜5 の合計 26 件）

---

### Task 6: 規約ヘッダ `references/codex-header-{impl,test}.md`

**Files:**
- Modify: `SKILL_DIR/references/codex-header-impl.md`（Task 5 の仮ファイルを本文に差し替え）
- Modify: `SKILL_DIR/references/codex-header-test.md`（同上）
- Modify: `SKILL_DIR/scripts/run-codex-step.test.ts` — ヘッダ連結テストの期待値を `# HEADER-TEST` から本文の先頭行に合わせる

**Interfaces:**
- Consumes: `cbo/agents/code-implementer.md`、`cbo/agents/test-implementer.md` の本文（抜粋元）
- Produces: Codex に渡すプロンプト先頭部。Claude 固有の記述（SendMessage、eslint mcp、vue-tsc-runner / test-runner スキル、報告の宛先、計画書のチェックボックス更新）は含めない。検証コマンドは Codex 自身が対象プロジェクトで実行できる形（`pnpm` 経由）で書く

- [ ] **Step 1: 本体コード用ヘッダを書く**

`SKILL_DIR/references/codex-header-impl.md` を以下の内容で上書きする。

````markdown
# 実装依頼（本体コード）

あなたはこのリポジトリの本体コード（テストファイル以外）を実装する担当です。以下の依頼文に書かれた 1 ステップだけを実装してください。

## 作業範囲

- 依頼文に書かれたステップだけを実装する。他のステップ・無関係なリファクタリングには手を付けない
- テストファイル（`*.test.ts` / `*.spec.ts` / `__tests__/` 配下）は新規作成・修正しない。実装に伴い既存テストが失敗する場合、実装意図の変更による期待値調整に限り最小修正を許容し、最終メッセージに「回帰対応のためテスト側も併せて修正: <ファイル>:<テスト名>」と明記する
- 依頼文の `Interfaces`（守るべき契約）と `完了条件` をすべて満たしてから完了とする。満たせない条件がある場合、条件を読み替えたり範囲を狭めたりせず、実装を止めて最終メッセージにその旨を書く
- 満たすべき性質が読み取れない、または `Interfaces` と `完了条件` が矛盾する場合は推測で埋めず、実装せずに最終メッセージで報告する

## プロジェクト規約

- リポジトリの `CLAUDE.md` と `.claude/rules/` 配下のルールを読み、従う
- 型: `!` / `as` / `any` は極力使わない。使う場合は理由コメントを残す。`as any` ではなく `as unknown as TargetType`
- 関数の引数が 2 つ以上ならオブジェクト化する
- 型のみで使うシンボルは `import type`。`eslint-disable` は `/* eslint-disable ルール名 -- 理由 */` + `eslint-enable`
- null / undefined チェックはプロジェクトのヘルパー（`Type.isUndefined` / `Type.isNull` 等）に統一する
- 新規の型・定数・関数・ファイルを作る前に、既存の前例を Grep で確認して配置と命名を揃える。type-fest 等の既存ユーティリティ型を自前実装より優先する
- 関数名は責務だけで表現する。boolean を返す関数は引数ありなら `getIs`、なしなら `is` プレフィックス。ハンドラは `handle` プレフィックス
- 依存方向は component → composable / store。状態変化のトリガー（watch 等）は state を所有する層に閉じる。純粋関数はモジュールスコープに置く
- 導出値は ref + watch ではなく computed で表現する。`<script setup>` では依存される側を先に宣言する
- 配列探索（`findIndex` / `indexOf`）の結果は `index < 0` を明示ガードしてから破壊的操作に渡す
- catch は例外種別（`instanceof`）で分岐し、想定外は `else` で監視ツールへ通知する。`message` 文字列判定はしない
- fire-and-forget の非同期呼び出しは `void` を明示する
- サーバ由来文字列を innerHTML に渡さない
- SCSS の spacing はデザイントークン（`var(--cb-space-N)` 等）を使う

## コメント

- コメントは「コードからは読み取れない事実」だけを 1〜3 行で書く。型・制御フロー・エラーメッセージ・テストが担保している内容は書かない
- 「何をするか」の言い換え、将来の編集者への牽制（「変更しないこと」等）、編集経緯（「Step N 対応」等）、他コメントへの相互参照は書かない
- JSDoc は「名前から読み取れない役割」を書く。3〜4 行を上限とする

## 完了前の検証

以下をこの順に実行し、すべて成功させてから完了とする。実行コマンドが `package.json` の scripts と異なる場合は scripts を確認して読み替える。

1. Lint: `pnpm eslint <変更したファイル>`
2. 型チェック: `pnpm vue-tsc --noEmit`（Vue プロジェクトでない場合は `pnpm tsc --noEmit`）
3. 関連する既存テスト: `pnpm vitest run <関連テストファイル>`

失敗が残る場合は修正して再実行する。修正できない失敗が残る場合は完了とせず、最終メッセージにその内容を書く。

## 最終メッセージ

最終メッセージは日本語で、以下の順に書く。

1. 1 行目: 実装結果の要約（成功なら「実装完了: <ステップ名>」、止めた場合は「実装中断: <理由>」）
2. 変更したファイルの一覧
3. 実行した検証コマンドとその結果
4. 新規テストが必要な箇所（テストの追加は別担当が行うため、観点だけを列挙する）
5. 次のステップへの引き継ぎ事項（あれば）
````

- [ ] **Step 2: テスト用ヘッダを書く**

`SKILL_DIR/references/codex-header-test.md` を以下の内容で上書きする。

````markdown
# 実装依頼（テストコード）

あなたはこのリポジトリのテストコードを実装する担当です。以下の依頼文に書かれた 1 ステップだけを実装してください。

## 作業範囲

- 対象はテストファイル（`*.test.ts` / `*.spec.ts` / `__tests__/` 配下）だけ。本体コード（SUT）は修正しない
- テストを green にするために SUT を直したくなった場合は直さず、最終メッセージに「SUT 側の懸念」として報告する
- 依頼文に `RED 確認` の記載がある場合、そのステップは TDD の RED 工程である。SUT は未実装の前提で、テストが依頼文に書かれた期待どおりに失敗することを確認して完了とする。テストが成功してしまった場合は異常なので作業を止め、最終メッセージの 1 行目に「異常停止: RED 確認でテストが成功した」と書く
- 依頼文に書かれた範囲だけを実装する。他のステップ・無関係なリファクタリングには手を付けない

## テスト設計

- まず SUT を読み、責務・分岐・副作用・依存関係を把握する。既存の兄弟テストを Grep で洗い出し、命名・fixture・モック方針を揃える
- 差分で追加された分岐ごとに、その分岐を削除したら fail するテストを添える
- OR / AND の複合条件は各オペランドが単独で効くケースを対称に網羅する。有限の選択肢は `it.each` で全件
- 配列探索が `-1` を返すケース、空配列の vacuous truth、`Number('') === 0` 等の JS 境界挙動は独立にケース化する
- モックは SUT が実際に参照するメンバだけを返す。モック検証は `toHaveBeenCalledWith` と `toHaveBeenCalledTimes(N)` を併記する
- 空の `objectContaining({})` や `resolves.not.toThrow()` のような、何も検証しないアサーションを書かない
- ソートは逆順入力で検証する。配列・集合は `length` ではなく等価性で検証する
- テスト名は検証の核心条件を表現する。実装識別子・行番号・ステップ番号をテスト名に入れない
- `// Arrange` / `// Act` / `// Assert` のラベルは残す。それ以外の、テスト名やアサーションから自明な説明コメントは書かない
- TZ 依存はローカルパース関数か `new Date(year, monthIndex, day)` で非依存化する
- 非同期完了待ちは `vi.useFakeTimers({ shouldAdvanceTime: true })` + `vi.advanceTimersByTimeAsync(N)` + `flushPromises()`
- `vi.clearAllMocks()` は one-time 実装キューを消さないため、リセットは `afterEach` の `mockReset()` を使う
- SUT は相対パスで import する（import 並べ替え lint で `vi.mock` より前に並ぶと効かなくなる）

## プロジェクト規約

- リポジトリの `CLAUDE.md` と `.claude/rules/` 配下のルールを読み、従う。テストコードにも適用される
- 型: `!` / `as` / `any` は極力使わない。使う場合は理由コメントを残す。`as any` ではなく `as unknown as TargetType`
- 関数の引数が 2 つ以上ならオブジェクト化する（fixture・モック・セットアップ関数も同様）
- 型のみで使うシンボルは `import type`
- DOM 取得は表示文言や内部クラスではなく `.testIds.ts` の定数を使う

## 完了前の検証

以下をこの順に実行し、すべて成功させてから完了とする（RED 確認のステップでは 3 の失敗内容を確認して完了とする）。実行コマンドが `package.json` の scripts と異なる場合は scripts を確認して読み替える。

1. Lint: `pnpm eslint <変更したファイル>`
2. 型チェック: `pnpm vue-tsc --noEmit`（Vue プロジェクトでない場合は `pnpm tsc --noEmit`）
3. 追加・修正したテスト: `pnpm vitest run <テストファイル>`

## 最終メッセージ

最終メッセージは日本語で、以下の順に書く。

1. 1 行目: 結果の要約（成功なら「テスト実装完了: <ステップ名>」、止めた場合は「実装中断: <理由>」、RED 確認の異常は「異常停止: RED 確認でテストが成功した」）
2. 変更したファイルの一覧
3. 追加・修正した describe / it とその観点
4. 実行した検証コマンドとその結果（RED 確認のステップでは実際の失敗メッセージを要約せず転記する）
5. SUT 側の懸念（あれば）
````

- [ ] **Step 3: run-codex-step のヘッダ連結テストを本文に合わせる**

`SKILL_DIR/scripts/run-codex-step.test.ts` の以下の行を差し替える。

```typescript
    expect(received.startsWith("# HEADER-TEST")).toBe(true);
```

を

```typescript
    expect(received.startsWith("# 実装依頼（テストコード）")).toBe(true);
```

に変更する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts`
Expected: PASS（26 件）

---

### Task 7: SKILL.md

**Files:**
- Create: `SKILL_DIR/SKILL.md`

**Interfaces:**
- Consumes: `check-codex.ts`（Task 4）、`run-codex-step.ts`（Task 5）の CLI と出力形式
- Produces: スキル本体。`impl:execute-codex` として呼び出される

- [ ] **Step 1: SKILL.md を書く**

`cbo/skills/impl__execute/SKILL.md` を読み、以下の内容で `SKILL_DIR/SKILL.md` を作る。既存の手順 1〜4、7〜10 の文面はそのまま流用し、差分だけ書き換える。

````markdown
---
name: impl:execute-codex
description: 作成済みの実装計画書を読み込み、記載されたステップを Codex CLI（GPT-6 Astra、effort low）に順に実装させてコードレビューまで完了させる実験用スキル。Codex が使用不能なら停止し Claude での実装に切り替えない。「Codex で実装して」「codex で計画書を実行」「Codex に実装させて」「impl:execute-codex」などの依頼時に使用する。
argument-hint: [implementations file name | -y で確認をスキップ]
disable-model-invocation: true
---

## コンテキスト
- 指定の実装計画書: $ARGUMENTS

## このスキルの位置づけ

- `impl:execute` の実験版。ステップの実装・レビュー指摘の修正・生存ミュータントへのテスト追加を Codex CLI に任せ、Codex がどの程度実装に使えるかを評価する
- **Codex が使用不能なら停止する**。codex コマンドが見つからない、認証切れ、利用上限、API 障害のいずれでも、Claude のサブエージェント（`code-implementer` / `test-implementer`）での実装には切り替えない
- モデルは `gpt-6-astra`、effort は `low` にスクリプト側で固定されている。変更したい場合はスクリプトを編集する

## Bash 実行時の注意

- `${CLAUDE_SKILL_DIR}/scripts/check-codex.ts` と `${CLAUDE_SKILL_DIR}/scripts/run-codex-step.ts` を実行する Bash 呼び出しは **サンドボックスを無効化して実行する**。Codex CLI はサンドボックス内では `failed to initialize in-process app-server client: Operation not permitted` で起動できない
- スクリプトの出力は key=value 形式（1 行 1 項目）。`status=` 行で成否を判定する

## 進捗管理の方針

（`impl:execute` の「進捗管理の方針」をそのまま転記する。ただし 4 点目を以下に差し替える）

- チェックボックスの書き換えは本スキルが行う。`run-codex-step.ts` が `status=ok` を返したステップだけを `- [x]` にする。`status=error` のステップは `- [ ]` のまま残す

## タスク

0. Codex の前提チェック
  - `bun run ${CLAUDE_SKILL_DIR}/scripts/check-codex.ts` を実行する
  - `status=ng` なら `reason` と `detail` をユーザーに報告して **即座に停止する**。以降のタスクには進まない

1. 〜 4.（`impl:execute` の手順 1〜4 をそのまま転記する）

5. 次の未完了ステップを Codex に実装させる
  - `- [ ]` のステップのうち、`blockedBy` に挙がったステップがすべて `- [x]` になっているものを実行可能とする。実行可能なステップが複数あっても **1 つずつ直列に** 実行する（並列グループ・チーム実行フローは使わない）
  - 役割を判定する。計画書に `**担当**` があればそれに従い（`test-implementer` → `test`、それ以外 → `impl`）、無ければ変更対象ファイルが `*.test.ts` / `*.spec.ts` / `__tests__/` 配下のみなら `test`、それ以外は `impl`
  - 依頼文ファイルを作る。`$TMPDIR` 配下に Markdown ファイルを作成し、以下を書く
    - 計画書のパス
    - 当該ステップの見出しから次のステップ見出しの直前までの本文全体（`Interfaces`・`完了条件`・`RED 確認` を含む）
    - 計画書の冒頭にある概要・前提（Global Constraints 等の共通事項）
  - 対象プロジェクトのルート（計画書が対象とするリポジトリのルート。通常はカレントプロジェクト）を `--cwd` に指定し、以下を実行する

    ```
    bun run ${CLAUDE_SKILL_DIR}/scripts/run-codex-step.ts --prompt <依頼文ファイル> --cwd <プロジェクトルート> --role <impl|test>
    ```

  - `status=ok` の場合: `last_message_file` を読み、`changed_files` と最終メッセージの要約をコンテキストに控える。計画書の当該ステップ見出しを `- [x]` に書き換える。最終メッセージの 1 行目が「実装中断」「異常停止」で始まる場合は Codex が完了していないので、`- [x]` にせず内容をユーザーに報告して停止する
  - `status=error` の場合: `reason` と `detail` をユーザーに報告して **停止する**。計画書は書き換えない

6. 計画書を読み直して `- [ ]` のステップが残っているか確認し、残っていれば 5. を繰り返す

7. 全ステップ完了後、ミューテーションテストを実行
  （`impl:execute` の手順 7 を転記する。ただし survivor 対応の「テスト追加」を以下に差し替える）
  1. **テスト追加**: survivor の変異内容と「追加すべきテスト観点」、対象 SUT と関連テストファイルのパスを依頼文ファイルに書き、`run-codex-step.ts --role test` で Codex に委譲する。`status=error` なら報告して停止する

8. ミューテーションテスト完了後、コードレビューを実行
  （`impl:execute` の手順 8 を転記する。ただし 3. 「修正」の先頭を以下に差し替える）
  - `[2]` 以上の指摘を、指摘ごとの「問題」「理由」「提案」と対象ファイル・行を依頼文ファイルにまとめ、対象がテストファイルのみなら `--role test`、それ以外は `--role impl` で `run-codex-step.ts` に渡して修正させる。指摘が複数ファイルにまたがる場合も 1 回の呼び出しにまとめてよい。`status=error` なら報告して停止する
  - コメントに対する指摘への対処方針（追記より削除を優先する）は依頼文に含める

9. 実装計画書のタイトルに「（実装完了・Codex）」と追記

10. 全ての作業が完了した旨をユーザーに通知する。報告には各 Codex 呼び出しの回数、`status=error` で停止した場合はその理由、レビューで指摘された件数を含める（Codex の評価材料になる）

## 注意事項
- 進捗はいつでも実装計画書のチェックボックスで確認できる。停止後に再開する場合は本スキルを再度呼び出せば、`- [ ]` のステップから続行する
- 一時ファイル（依頼文、最終メッセージ）は `$TMPDIR` 配下に置く。`/tmp` 直下には置かない
````

- [ ] **Step 2: 行数と必須項目を確認する**

Run: `wc -l /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/SKILL.md`
Expected: 500 以下

Run: `head -6 /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/SKILL.md`
Expected: フロントマターに `name` と `description` がある

- [ ] **Step 3: 転記漏れを確認する**

`impl:execute` の手順 1〜4、7、8 の文面が「（転記する）」のプレースホルダのまま残っていないことを確認する。

Run: `grep -n "転記する" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/SKILL.md`
Expected: 出力なし

---

### Task 8: 実機での動作確認（手動）

**Files:**
- なし（確認のみ）

- [ ] **Step 1: codex を PATH に通す**

ユーザーが node 24 環境へ `npm i -g @openai/codex` を行うか、mise の設定で codex を含む node を既定にする。確認コマンド:

Run: `codex --version`
Expected: `codex-cli 0.153.4` 以上

- [ ] **Step 2: 前提チェックを実機で実行する**

Run（サンドボックス無効化）: `bun run /Users/otto/workspace/mgzl-claude-code-plugin/cbo/skills/impl__execute-codex/scripts/check-codex.ts`
Expected: `status=ok` と `version=codex-cli ...`

- [ ] **Step 3: 小さな計画書で 1 ステップ実行する**

対象プロジェクトに、1 ステップだけの実装計画書（例: ユーティリティ関数を 1 つ追加する）を用意し、`/cbo:impl:execute-codex <計画書>` を実行する。以下を確認する。

- `run-codex-step.ts` が `status=ok` を返し、`changed_files` に期待したファイルが含まれる
- 計画書のチェックボックスが `- [x]` になる
- ミューテーションテストとレビューが既存の Claude エージェントで実行される
- 最終報告に Codex 呼び出し回数が含まれる

- [ ] **Step 4: 停止経路を実機で確認する**

`IMPL_EXECUTE_CODEX_BIN=/nonexistent/codex` を付けて `check-codex.ts` を実行し、`status=ng` `reason=not_found` で止まることを確認する。SKILL.md がこれを受けて停止することは Step 3 の実行時に `PATH` から codex を外して確認する。
