# typesafe 提案ログビューワー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** typesafe プラグインの提案ログ `suggestions-v3.jsonl` を、prompt と非ゼロ確率のスキルランキングを主役にブラウザで眺められ、追記された新着が自動で流れ込むビューワーを作る。

**Architecture:** `Bun.serve` 一本のローカルサーバーが、ログを 1 秒間隔の size polling で差分読み取りし、軽量化した `ViewRecord` を `GET /api/records`（初回）と `GET /events`（SSE、新着）で配る。ブラウザ側は素の JS 1 ファイルで、event / outcome の絞り込みと確率バー付きの詳細表示を持つ。変換（`lib/records.ts`）と差分読み取り（`lib/tail.ts`）は純粋な単体として切り出し、サーバーはそれらを配線するだけにする。

**Tech Stack:** TypeScript / Bun（`bun run` / `bun test`）。外部依存なし、build 無し。ブラウザ側は素の HTML + JS。

**Spec:** `docs/superpowers/specs/2026-09-19-typesafe-suggestions-viewer-design.md`

## Global Constraints

- 実装コードは TypeScript。`!`（non-null assertion）・`as`・`any` を極力使わない。使う場合は必要な理由をコメントで残す
- コードコメントは日本語で「コードから読み取れない実装の理由」のみを書く。「変更禁止」のような注意書きは書かない
- import は `.ts` 拡張子付きで書く（既存の流儀。`tsconfig` の `allowImportingTsExtensions` が前提）
- npm 依存を追加しない。`package.json` を変更しない
- テストは `bun test <ファイルパス>` で、そのタスクで触れたファイルのテストだけを個別に実行する。全体テスト・全体型チェックは実行しない
- 各 Task の最後はコミットではなく「変更ファイル一覧を確認する」。このリポジトリではコミットは人間が明示的に指示する
- Bash は 1 コマンド 1 目的。`&&` や `;` で連結しない。`cd` を使わない。パスは絶対パスまたはリポジトリルートからの相対パスで指定する
- `Bun.serve` の bind は、このリポジトリの `.claude/settings.local.json` に `sandbox.network.allowLocalBinding: true` と `allowedDomains: ["localhost", "127.0.0.1", "[::1]"]` が設定済みなのでサンドボックス内でも通る。`EADDRINUSE` で失敗したら設定の有無を疑い、サンドボックスを解除して再試行しない
- 既定ポートは `47391`、bind ホストは `127.0.0.1`。既定のログパスは `~/.claude/plugins/data/typesafe-mgzl-marketplace/<LOG_FILE_NAME>`（`LOG_FILE_NAME` は `typesafe/hooks/lib/log.ts` から import）
- polling 間隔の既定は `1000` ms、SSE の ping 間隔は `15000` ms

## ファイル構成

| ファイル | 責務 | 扱い |
|---|---|---|
| `typesafe/viewer/lib/records.ts` | ログ 1 行を `ViewRecord` に変換する純関数 | 新規 |
| `typesafe/viewer/lib/records.test.ts` | 同上のテスト | 新規 |
| `typesafe/viewer/lib/tail.ts` | byte offset を保持した差分読み取り | 新規 |
| `typesafe/viewer/lib/tail.test.ts` | 同上のテスト | 新規 |
| `typesafe/viewer/server.ts` | 引数解釈、`Bun.serve`、polling、SSE 配信 | 新規 |
| `typesafe/viewer/server.test.ts` | サーバーを実際に立てた結合テスト | 新規 |
| `typesafe/viewer/index.html` | 画面（素の JS を同梱） | 新規 |
| `typesafe/README.md` | 「ビューワー」節の追加と「テスト」節の修正 | 変更 |

---

## Task 1: `lib/records.ts` — ログ 1 行を `ViewRecord` に変換する

**Files:**
- Create: `typesafe/viewer/lib/records.ts`
- Test: `typesafe/viewer/lib/records.test.ts`

**Interfaces:**
- Consumes: なし（`LogRecord` の形はコメントで参照するだけで、実行時は `unknown` を型ガードで掘る）
- Produces:
  - `type RankingItem = { name: string; probability: number }`
  - `type ViewRecord = { ts: string; session_id: string; cwd: string; event: string; agent_type?: string; prompt: string; outcome: string; winner: string | null; noneProbability: number | null; elapsedMs: number; rosterSize: number; error?: string; ranking: RankingItem[]; confidence?: number; model?: string; usage?: { input_tokens: number; output_tokens: number } }`
  - `function toViewRecord(line: string): ViewRecord | null`

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/viewer/lib/records.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { toViewRecord } from "./records.ts";

/** 実ログと同じ形の suggested レコード。criteria は表示に不要なので 2 件に省いてある */
const SUGGESTED = JSON.stringify({
  ts: "2026-09-18T10:56:20.705Z",
  session_id: "113c9a46",
  cwd: "/Users/otto/workspace/mgzl-claude-code-plugin",
  event: "PreToolUse",
  tool_name: "Bash",
  prompt: "The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m \"fix\"",
  outcome: "suggested",
  winner: "mgzl:commiting-to-git",
  noneProbability: 0.03,
  shortlist: [{ name: "mgzl:commiting-to-git", probability: 0.86 }],
  calls: [
    {
      url: "https://api.typesafe.ai/v1/systemone",
      request: {
        model: "jev-latest",
        state: { request: "…", recent_context: "" },
        questions: {
          which: {
            type: "choice",
            instructions: "Which skill?",
            criteria: { "mgzl:commiting-to-git": "…", none: "…" },
          },
        },
      },
      response: {
        status: 200,
        body: {
          model: "jev-1.13.0",
          answers: {
            which: {
              type: "choice",
              choice: "mgzl:commiting-to-git",
              confidence: 0.85,
              probabilities: {
                "mgzl:commiting-to-git": 0.86,
                "superpowers:verification-before-completion": 0.11,
                none: 0.03,
                "fading-memory:list": 0,
                "nap:create-issue": 0,
              },
            },
          },
          usage: { input_tokens: 5074, output_tokens: 711 },
        },
      },
      elapsedMs: 661,
    },
  ],
  elapsedMs: 661,
  rosterSize: 47,
});

const SKIPPED = JSON.stringify({
  ts: "2026-09-18T13:44:46.451Z",
  session_id: "9dfad3e2",
  cwd: "/Users/otto/workspace/reviewview",
  event: "UserPromptSubmit",
  prompt: "/claude-api",
  outcome: "skipped",
  winner: null,
  noneProbability: null,
  shortlist: [],
  calls: [],
  elapsedMs: 0,
  rosterSize: 0,
});

const ERROR = JSON.stringify({
  ts: "2026-09-18T13:50:00.000Z",
  session_id: "",
  cwd: "",
  event: "UserPromptSubmit",
  prompt: "",
  outcome: "error",
  winner: null,
  noneProbability: null,
  shortlist: [],
  calls: [],
  elapsedMs: 0,
  rosterSize: 0,
  error: "malformed stdin payload",
});

const NO_RESPONSE = JSON.stringify({
  ts: "2026-09-18T14:00:00.000Z",
  session_id: "s",
  cwd: "/tmp",
  event: "PreToolUse",
  tool_name: "Agent",
  agent_type: "Explore",
  prompt: "The assistant is about to perform this action:\nsearch",
  outcome: "no_fit",
  winner: null,
  noneProbability: 0.9,
  shortlist: [],
  calls: [{ url: "https://api.typesafe.ai/v1/systemone", request: { model: "jev-latest", state: {}, questions: {} }, response: null, error: "timeout", elapsedMs: 3000 }],
  elapsedMs: 3000,
  rosterSize: 45,
});

describe("toViewRecord", () => {
  test("suggested: 非ゼロの確率だけを降順に並べ none も含める", () => {
    const view = toViewRecord(SUGGESTED);
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.event).toBe("PreToolUse:Bash");
    expect(view.winner).toBe("mgzl:commiting-to-git");
    expect(view.ranking).toEqual([
      { name: "mgzl:commiting-to-git", probability: 0.86 },
      { name: "superpowers:verification-before-completion", probability: 0.11 },
      { name: "none", probability: 0.03 },
    ]);
    expect(view.confidence).toBe(0.85);
    expect(view.model).toBe("jev-1.13.0");
    expect(view.usage).toEqual({ input_tokens: 5074, output_tokens: 711 });
    expect(view.prompt).toContain("git commit");
    expect("shortlist" in view).toBe(false);
  });

  test("同率の候補は名前順に並ぶ", () => {
    const tie = JSON.parse(SUGGESTED);
    tie.calls[0].response.body.answers.which.probabilities = { b: 0.5, a: 0.5, none: 0 };
    const view = toViewRecord(JSON.stringify(tie));
    expect(view?.ranking.map((item) => item.name)).toEqual(["a", "b"]);
  });

  test("skipped: calls が空なら ranking は空配列で任意項目は省略される", () => {
    const view = toViewRecord(SKIPPED);
    expect(view?.event).toBe("UserPromptSubmit");
    expect(view?.ranking).toEqual([]);
    expect(view?.noneProbability).toBeNull();
    expect(view?.confidence).toBeUndefined();
    expect(view?.model).toBeUndefined();
    expect(view?.usage).toBeUndefined();
  });

  test("error: error フィールドを持ち越す", () => {
    const view = toViewRecord(ERROR);
    expect(view?.outcome).toBe("error");
    expect(view?.error).toBe("malformed stdin payload");
  });

  test("response が null でも落ちず agent_type を持ち越す", () => {
    const view = toViewRecord(NO_RESPONSE);
    expect(view?.event).toBe("PreToolUse:Agent");
    expect(view?.agent_type).toBe("Explore");
    expect(view?.ranking).toEqual([]);
  });

  test("JSON として読めない行は null", () => {
    expect(toViewRecord("{\"ts\":\"2026-")).toBeNull();
    expect(toViewRecord("")).toBeNull();
  });

  test("ts が文字列でない行は null", () => {
    expect(toViewRecord(JSON.stringify({ ts: 123, prompt: "x" }))).toBeNull();
    expect(toViewRecord(JSON.stringify([1, 2]))).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test typesafe/viewer/lib/records.test.ts`
Expected: FAIL。`./records.ts` が見つからないエラー

- [ ] **Step 3: 実装を書く**

`typesafe/viewer/lib/records.ts`:

```ts
/**
 * ログ 1 行（hooks/lib/log.ts の LogRecord を JSON 化したもの）をブラウザ向けの軽量な形に変換する。
 * 元レコードの型は import せず unknown を型ガードで掘る。ログは過去の版のフックが書いた行も
 * 混ざりうるため、型に合わない行でも落とさず null で捨てたい。
 */

export type RankingItem = { name: string; probability: number };

export type ViewRecord = {
  ts: string;
  session_id: string;
  cwd: string;
  /** "UserPromptSubmit" | "PreToolUse:Bash" | "PreToolUse:Agent" など。tool_name を event に畳み込んだ表示用の値 */
  event: string;
  agent_type?: string;
  prompt: string;
  outcome: string;
  winner: string | null;
  noneProbability: number | null;
  elapsedMs: number;
  rosterSize: number;
  error?: string;
  /** 確率が 0 より大きい候補だけを降順に並べたもの。none も含む。API を呼んでいなければ空 */
  ranking: RankingItem[];
  confidence?: number;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** calls[0].response.body を辞書として取り出す。無ければ undefined */
function firstResponseBody(calls: unknown): Dict | undefined {
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const first: unknown = calls[0];
  if (!isDict(first) || !isDict(first["response"])) return undefined;
  const body = first["response"]["body"];
  return isDict(body) ? body : undefined;
}

function whichAnswer(body: Dict | undefined): Dict | undefined {
  if (body === undefined || !isDict(body["answers"])) return undefined;
  const which = body["answers"]["which"];
  return isDict(which) ? which : undefined;
}

function toRanking(which: Dict | undefined): RankingItem[] {
  if (which === undefined || !isDict(which["probabilities"])) return [];
  const items: RankingItem[] = [];
  for (const [name, probability] of Object.entries(which["probabilities"])) {
    if (typeof probability === "number" && probability > 0) items.push({ name, probability });
  }
  return items.sort((left, right) =>
    right.probability !== left.probability
      ? right.probability - left.probability
      : left.name.localeCompare(right.name),
  );
}

function toUsage(body: Dict | undefined): ViewRecord["usage"] {
  if (body === undefined || !isDict(body["usage"])) return undefined;
  const input = body["usage"]["input_tokens"];
  const output = body["usage"]["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input_tokens: input, output_tokens: output };
}

function toEvent(raw: Dict): string {
  const event = str(raw["event"], "UserPromptSubmit");
  const tool = optStr(raw["tool_name"]);
  return event === "PreToolUse" && tool !== undefined ? `${event}:${tool}` : event;
}

export function toViewRecord(line: string): ViewRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDict(parsed) || typeof parsed["ts"] !== "string") return null;

  const body = firstResponseBody(parsed["calls"]);
  const which = whichAnswer(body);
  const view: ViewRecord = {
    ts: parsed["ts"],
    session_id: str(parsed["session_id"]),
    cwd: str(parsed["cwd"]),
    event: toEvent(parsed),
    prompt: str(parsed["prompt"]),
    outcome: str(parsed["outcome"]),
    winner: optStr(parsed["winner"]) ?? null,
    noneProbability: optNum(parsed["noneProbability"]) ?? null,
    elapsedMs: num(parsed["elapsedMs"]),
    rosterSize: num(parsed["rosterSize"]),
    ranking: toRanking(which),
  };
  const agentType = optStr(parsed["agent_type"]);
  if (agentType !== undefined) view.agent_type = agentType;
  const error = optStr(parsed["error"]);
  if (error !== undefined) view.error = error;
  const confidence = optNum(which?.["confidence"]);
  if (confidence !== undefined) view.confidence = confidence;
  const model = optStr(body?.["model"]);
  if (model !== undefined) view.model = model;
  const usage = toUsage(body);
  if (usage !== undefined) view.usage = usage;
  return view;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test typesafe/viewer/lib/records.test.ts`
Expected: PASS（7 件）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git status --short typesafe/viewer`
Expected: `records.ts` と `records.test.ts` の 2 件が untracked

---

## Task 2: `lib/tail.ts` — byte offset を保持した差分読み取り

**Files:**
- Create: `typesafe/viewer/lib/tail.ts`
- Test: `typesafe/viewer/lib/tail.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type TailResult = { lines: string[]; reset: boolean }`
  - `type Tail = { read(): TailResult }`
  - `function createTail(path: string): Tail`

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/viewer/lib/tail.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTail } from "./tail.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-tail-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("createTail", () => {
  test("初回は先頭から完結した行を全部返す", () => {
    const path = join(root, "a.jsonl");
    writeFileSync(path, "one\ntwo\n");
    const tail = createTail(path);
    expect(tail.read()).toEqual({ lines: ["one", "two"], reset: false });
  });

  test("2 回目は前回以降の行だけを返す", () => {
    const path = join(root, "b.jsonl");
    writeFileSync(path, "one\n");
    const tail = createTail(path);
    tail.read();
    appendFileSync(path, "two\nthree\n");
    expect(tail.read().lines).toEqual(["two", "three"]);
    expect(tail.read().lines).toEqual([]);
  });

  test("改行で終わらない断片は次回に連結される", () => {
    const path = join(root, "c.jsonl");
    writeFileSync(path, "one\ntw");
    const tail = createTail(path);
    expect(tail.read().lines).toEqual(["one"]);
    appendFileSync(path, "o\nthree\n");
    expect(tail.read().lines).toEqual(["two", "three"]);
  });

  test("ファイルが無ければ空を返し、生成されたら読み始める", () => {
    const path = join(root, "d.jsonl");
    const tail = createTail(path);
    expect(tail.read()).toEqual({ lines: [], reset: false });
    writeFileSync(path, "one\n");
    expect(tail.read()).toEqual({ lines: ["one"], reset: false });
  });

  test("切り詰められたら reset を立てて先頭から読み直す", () => {
    const path = join(root, "e.jsonl");
    writeFileSync(path, "one\ntwo\nthree\n");
    const tail = createTail(path);
    tail.read();
    writeFileSync(path, "x\n");
    expect(tail.read()).toEqual({ lines: ["x"], reset: true });
    appendFileSync(path, "y\n");
    expect(tail.read()).toEqual({ lines: ["y"], reset: false });
  });

  test("マルチバイト文字が chunk 境界で切れても壊れない", () => {
    const path = join(root, "f.jsonl");
    const tail = createTail(path);
    writeFileSync(path, "日本語\n");
    expect(tail.read().lines).toEqual(["日本語"]);
    appendFileSync(path, "追記\n");
    expect(tail.read().lines).toEqual(["追記"]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test typesafe/viewer/lib/tail.test.ts`
Expected: FAIL。`./tail.ts` が見つからないエラー

- [ ] **Step 3: 実装を書く**

`typesafe/viewer/lib/tail.ts`:

```ts
import { closeSync, openSync, readSync, statSync } from "node:fs";

export type TailResult = {
  lines: string[];
  /** ファイルが消えた・縮んだために offset を 0 に戻し、先頭から読み直したことを示す */
  reset: boolean;
};

export type Tail = { read(): TailResult };

/**
 * 追記専用ファイルを byte offset で差分読み取りする。
 * 複数の hook プロセスが同時に追記するため、改行で終わらない末尾は書きかけとみなして
 * 次回に持ち越す。行の分割は文字列化してから行うが、UTF-8 の途中で chunk が切れると
 * 文字が壊れるので、持ち越しは Buffer のまま保持し、連結してからデコードする。
 */
export function createTail(path: string): Tail {
  let offset = 0;
  let carry: Buffer = Buffer.alloc(0);

  function sizeOf(): number | undefined {
    try {
      return statSync(path).size;
    } catch {
      return undefined;
    }
  }

  function readFrom(start: number, end: number): Buffer {
    const fd = openSync(path, "r");
    try {
      const chunk = Buffer.alloc(end - start);
      let done = 0;
      while (done < chunk.length) {
        const got = readSync(fd, chunk, done, chunk.length - done, start + done);
        if (got === 0) break;
        done += got;
      }
      return chunk.subarray(0, done);
    } finally {
      closeSync(fd);
    }
  }

  function read(): TailResult {
    const size = sizeOf();
    let reset = false;
    if (size === undefined) {
      // ファイルが無い。次に現れたら先頭から読む
      if (offset !== 0 || carry.length !== 0) reset = true;
      offset = 0;
      carry = Buffer.alloc(0);
      return { lines: [], reset };
    }
    if (size < offset) {
      reset = true;
      offset = 0;
      carry = Buffer.alloc(0);
    }
    if (size === offset) return { lines: [], reset };

    const fresh = readFrom(offset, size);
    offset += fresh.length;
    const joined = Buffer.concat([carry, fresh]);
    const lastNewline = joined.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      carry = joined;
      return { lines: [], reset };
    }
    carry = joined.subarray(lastNewline + 1);
    const lines = joined
      .subarray(0, lastNewline)
      .toString("utf8")
      .split("\n");
    return { lines, reset };
  }

  return { read };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test typesafe/viewer/lib/tail.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git status --short typesafe/viewer`
Expected: Task 1 の 2 件に `tail.ts` と `tail.test.ts` が加わる

---

## Task 3: `server.ts` — HTTP と SSE の配線

**Files:**
- Create: `typesafe/viewer/server.ts`
- Create: `typesafe/viewer/index.html`（このタスクでは `/` が返せる最小の骨組みだけ。画面は Task 4）
- Test: `typesafe/viewer/server.test.ts`

**Interfaces:**
- Consumes: `toViewRecord`, `ViewRecord`（Task 1）、`createTail`（Task 2）、`LOG_FILE_NAME`（`typesafe/hooks/lib/log.ts`）
- Produces:
  - `type ViewerOptions = { file: string; port: number; pollMs?: number; pingMs?: number }`
  - `type Viewer = { url: string; stop(): void }`
  - `function startViewer(options: ViewerOptions): Viewer`
  - HTTP: `GET /` → HTML、`GET /api/records` → `{ records: ViewRecord[]; warnings: { droppedLines: number } }`、`GET /events` → SSE（`event: record` / `event: reset`、15 秒ごとの `: ping`）、他は 404
  - CLI: `bun run typesafe/viewer/server.ts [--file <path>] [--port <n>]`。起動時に stdout へ `url=http://127.0.0.1:<port>/`

- [ ] **Step 1: `index.html` の骨組みを置く**

`typesafe/viewer/index.html`（Task 4 で全面的に書き換える。ここでは `/` の応答確認用）:

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>typesafe suggestions viewer</title>
</head>
<body>
<p>typesafe suggestions viewer</p>
</body>
</html>
```

- [ ] **Step 2: 失敗するテストを書く**

`typesafe/viewer/server.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "./server.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-viewer-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function line(ts: string, prompt: string): string {
  return `${JSON.stringify({
    ts,
    session_id: "s",
    cwd: "/tmp",
    event: "UserPromptSubmit",
    prompt,
    outcome: "no_fit",
    winner: null,
    noneProbability: 0.9,
    shortlist: [],
    calls: [],
    elapsedMs: 10,
    rosterSize: 3,
  })}\n`;
}

/** SSE の本文から目的の event 行が現れるまで読む。届かなければ timeoutMs で諦める */
async function waitForEvent(res: Response, name: string, timeoutMs: number): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(`event: ${name}\n`)) {
      await reader.cancel();
      return buffer;
    }
  }
  await reader.cancel();
  throw new Error(`event ${name} が ${timeoutMs}ms 以内に届かなかった: ${buffer}`);
}

describe("startViewer", () => {
  test("/ は HTML を返す", async () => {
    const file = join(root, "a.jsonl");
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("typesafe suggestions viewer");
    } finally {
      viewer.stop();
    }
  });

  test("/api/records は起動時のファイル内容を返し、壊れた行は数える", async () => {
    const file = join(root, "b.jsonl");
    writeFileSync(file, `${line("2026-09-19T00:00:00.000Z", "one")}{broken\n${line("2026-09-19T00:00:01.000Z", "two")}`);
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}api/records`);
      const json = await res.json();
      expect(json.records.map((r: { prompt: string }) => r.prompt)).toEqual(["one", "two"]);
      expect(json.warnings).toEqual({ droppedLines: 1 });
    } finally {
      viewer.stop();
    }
  });

  test("ファイルが無くても起動し、生成後の追記が SSE で届く", async () => {
    const file = join(root, "c.jsonl");
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const first = await (await fetch(`${viewer.url}api/records`)).json();
      expect(first.records).toEqual([]);
      const sse = await fetch(`${viewer.url}events`);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      appendFileSync(file, line("2026-09-19T00:00:02.000Z", "fresh"));
      const body = await waitForEvent(sse, "record", 2000);
      expect(body).toContain("\"prompt\":\"fresh\"");
    } finally {
      viewer.stop();
    }
  });

  test("切り詰められたら reset が届く", async () => {
    const file = join(root, "d.jsonl");
    writeFileSync(file, line("2026-09-19T00:00:00.000Z", "one") + line("2026-09-19T00:00:01.000Z", "two"));
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const sse = await fetch(`${viewer.url}events`);
      writeFileSync(file, line("2026-09-19T00:00:03.000Z", "x"));
      const body = await waitForEvent(sse, "reset", 2000);
      expect(body).toContain("event: reset\n");
      const after = await (await fetch(`${viewer.url}api/records`)).json();
      expect(after.records.map((r: { prompt: string }) => r.prompt)).toEqual(["x"]);
    } finally {
      viewer.stop();
    }
  });

  test("知らないパスは 404", async () => {
    const viewer = startViewer({ file: join(root, "e.jsonl"), port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}nope`);
      expect(res.status).toBe(404);
    } finally {
      viewer.stop();
    }
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `bun test typesafe/viewer/server.test.ts`
Expected: FAIL。`./server.ts` が見つからないエラー

- [ ] **Step 4: 実装を書く**

`typesafe/viewer/server.ts`:

```ts
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LOG_FILE_NAME } from "../hooks/lib/log.ts";
import { toViewRecord, type ViewRecord } from "./lib/records.ts";
import { createTail } from "./lib/tail.ts";

export type ViewerOptions = {
  file: string;
  /** 0 を渡すと空きポートを使う（テスト用） */
  port: number;
  pollMs?: number;
  pingMs?: number;
};

export type Viewer = {
  /** 末尾に "/" が付いた形 */
  url: string;
  stop(): void;
};

export const DEFAULT_PORT = 47391;
export const DEFAULT_POLL_MS = 1000;
export const DEFAULT_PING_MS = 15000;
const HOST = "127.0.0.1";

/** Claude Code が typesafe プラグインに与える CLAUDE_PLUGIN_DATA の実体。hook 側と同じファイル名を使う */
export const DEFAULT_LOG_FILE = join(
  homedir(),
  ".claude",
  "plugins",
  "data",
  "typesafe-mgzl-marketplace",
  LOG_FILE_NAME,
);

const HTML_PATH = join(import.meta.dir, "index.html");

type Client = ReadableStreamDefaultController<Uint8Array>;

function sseFrame(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export function startViewer(options: ViewerOptions): Viewer {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const pingMs = options.pingMs ?? DEFAULT_PING_MS;
  const tail = createTail(options.file);
  const records: ViewRecord[] = [];
  let droppedLines = 0;
  let lastSize = -1;
  const clients = new Set<Client>();

  function broadcast(frame: Uint8Array): void {
    for (const client of clients) {
      try {
        client.enqueue(frame);
      } catch {
        // 切断済みの client。cancel が走る前に enqueue すると投げるので外す
        clients.delete(client);
      }
    }
  }

  function ingest(lines: string[]): ViewRecord[] {
    const added: ViewRecord[] = [];
    for (const line of lines) {
      const view = toViewRecord(line);
      if (view === null) {
        droppedLines += 1;
        continue;
      }
      records.push(view);
      added.push(view);
    }
    return added;
  }

  function poll(): void {
    let size = -2;
    try {
      size = statSync(options.file).size;
    } catch {
      size = -1;
    }
    if (size === lastSize) return;
    lastSize = size;
    const result = tail.read();
    if (result.reset) {
      records.length = 0;
      droppedLines = 0;
      broadcast(sseFrame("reset", "{}"));
    }
    for (const view of ingest(result.lines)) {
      broadcast(sseFrame("record", JSON.stringify(view)));
    }
  }

  // 起動時の全件読み込みも同じ経路。offset 0 からの差分読み取りに等しい
  poll();
  const pollTimer = setInterval(poll, pollMs);
  const pingTimer = setInterval(() => broadcast(new TextEncoder().encode(": ping\n\n")), pingMs);

  const server = Bun.serve({
    hostname: HOST,
    port: options.port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        return new Response(Bun.file(HTML_PATH), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/api/records") {
        return Response.json({ records, warnings: { droppedLines } });
      }
      if (pathname === "/events") {
        let self: Client | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            self = controller;
            clients.add(controller);
            controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            if (self !== undefined) clients.delete(self);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://${HOST}:${server.port}/`,
    stop() {
      clearInterval(pollTimer);
      clearInterval(pingTimer);
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // 既に閉じている
        }
      }
      clients.clear();
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: "string" },
      port: { type: "string" },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`error=invalid port: ${values.port}`);
    process.exit(1);
  }
  try {
    const viewer = startViewer({ file: values.file ?? DEFAULT_LOG_FILE, port });
    console.log(`url=${viewer.url}`);
    console.log(`file=${values.file ?? DEFAULT_LOG_FILE}`);
  } catch (error) {
    console.error(`error=${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `bun test typesafe/viewer/server.test.ts`
Expected: PASS（5 件）。`EADDRINUSE` で失敗した場合は `.claude/settings.local.json` の `sandbox.network.allowLocalBinding` を確認し、サンドボックスは解除しない

- [ ] **Step 6: CLI 起動を確認する**

背景で起動し、curl で確認したのち停止する。

Run（`run_in_background`）: `bun run typesafe/viewer/server.ts --file /nonexistent/suggestions-v3.jsonl --port 47391`
Expected: stdout に `url=http://127.0.0.1:47391/` と `file=/nonexistent/suggestions-v3.jsonl`

Run: `curl -s --max-time 5 http://127.0.0.1:47391/api/records`
Expected: `{"records":[],"warnings":{"droppedLines":0}}`

Run: `pkill -f "typesafe/viewer/server.ts"`
Expected: 終了

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short typesafe/viewer`
Expected: `server.ts`、`server.test.ts`、`index.html` が加わる

---

## Task 4: `index.html` — 画面

**Files:**
- Modify: `typesafe/viewer/index.html`（全面書き換え）
- Test: `typesafe/viewer/server.test.ts`（`/` の検証に要素の存在確認を 1 件追加）

**Interfaces:**
- Consumes: `GET /api/records` → `{ records: ViewRecord[]; warnings: { droppedLines: number } }`、`GET /events` の `record` / `reset`（Task 3）
- Produces: なし（末端）

- [ ] **Step 1: `/` の検証を強める失敗テストを追加する**

`typesafe/viewer/server.test.ts` の `"/ は HTML を返す"` の末尾（`expect(await res.text()).toContain(...)` の行）を次に置き換える:

```ts
      const html = await res.text();
      expect(html).toContain("typesafe suggestions viewer");
      expect(html).toContain("id=\"filters\"");
      expect(html).toContain("id=\"list\"");
      expect(html).toContain("id=\"detail\"");
      expect(html).toContain("new EventSource(\"/events\")");
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test typesafe/viewer/server.test.ts`
Expected: FAIL。`id="filters"` が含まれない

- [ ] **Step 3: `index.html` を書く**

`typesafe/viewer/index.html` を次の内容で置き換える:

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>typesafe suggestions viewer</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --panel: #f6f8fa;
    --accent: #0969da; --bar: #54aeff; --bar-none: #d4a72c; --win: #dafbe1; --err: #ffebe9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --line: #30363d; --panel: #161b22;
      --accent: #58a6ff; --bar: #1f6feb; --bar-none: #9e6a03; --win: #1a3d2a; --err: #4a1c1c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--fg); background: var(--bg); }
  header { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header h1 { font-size: 14px; margin: 0 8px 0 0; }
  .group { display: flex; gap: 6px; align-items: center; }
  .group span { color: var(--muted); }
  .chip { border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; cursor: pointer; background: var(--bg); color: var(--muted); user-select: none; }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  #stats { margin-left: auto; color: var(--muted); }
  #banner { display: none; padding: 6px 16px; background: var(--err); }
  main { display: grid; grid-template-columns: minmax(320px, 40%) 1fr; height: calc(100vh - 48px); }
  #list { overflow: auto; border-right: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 64px auto auto 1fr; gap: 8px; align-items: baseline; padding: 6px 12px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .row:hover { background: var(--panel); }
  .row.selected { background: var(--panel); box-shadow: inset 3px 0 var(--accent); }
  .row .ts { color: var(--muted); font-variant-numeric: tabular-nums; }
  .badge { font-size: 11px; border-radius: 4px; padding: 0 6px; border: 1px solid var(--line); white-space: nowrap; }
  .badge.suggested { background: var(--win); }
  .badge.error { background: var(--err); }
  .row .head { grid-column: 1 / -1; display: flex; gap: 8px; align-items: baseline; }
  .row .winner { color: var(--accent); }
  .row .excerpt { grid-column: 1 / -1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
  #detail { overflow: auto; padding: 16px; }
  #detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 16px; }
  #detail dt { color: var(--muted); }
  #detail dd { margin: 0; word-break: break-all; }
  #detail h2 { font-size: 13px; margin: 16px 0 6px; color: var(--muted); }
  #detail pre { white-space: pre-wrap; word-break: break-word; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin: 0; max-height: 40vh; overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 6px; vertical-align: middle; }
  td.name { white-space: nowrap; }
  td.p { text-align: right; font-variant-numeric: tabular-nums; width: 4em; }
  td.bar { width: 100%; }
  .bar div { height: 10px; background: var(--bar); border-radius: 2px; }
  tr.none .bar div { background: var(--bar-none); }
  tr.winner td.name { font-weight: 600; color: var(--accent); }
  .empty { padding: 24px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
<header>
  <h1>typesafe suggestions viewer</h1>
  <div id="filters">
    <div class="group" data-key="event"><span>event</span></div>
    <div class="group" data-key="outcome"><span>outcome</span></div>
  </div>
  <label class="group"><input type="checkbox" id="follow" checked> 最新に追従</label>
  <div id="stats"></div>
</header>
<div id="banner"></div>
<main>
  <div id="list"></div>
  <div id="detail"><div class="empty">左の一覧から選んでくださいまし</div></div>
</main>
<script>
(() => {
  const EVENTS = ["UserPromptSubmit", "PreToolUse:Bash", "PreToolUse:Agent"];
  const OUTCOMES = ["suggested", "no_fit", "skipped", "error"];

  /** 状態。records はファイル順（古い順）で持ち、描画時に降順にする */
  const state = {
    records: [],
    droppedLines: 0,
    filters: { event: new Set(EVENTS), outcome: new Set(OUTCOMES) },
    selectedTs: null,
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const detailEl = $("detail");
  const statsEl = $("stats");
  const bannerEl = $("banner");
  const followEl = $("follow");

  function buildChips() {
    for (const group of document.querySelectorAll("#filters .group")) {
      const key = group.dataset.key;
      const values = key === "event" ? EVENTS : OUTCOMES;
      for (const value of values) {
        const chip = document.createElement("span");
        chip.className = "chip on";
        chip.textContent = value;
        chip.addEventListener("click", () => {
          const set = state.filters[key];
          if (set.has(value)) set.delete(value); else set.add(value);
          chip.classList.toggle("on", set.has(value));
          render();
        });
        group.appendChild(chip);
      }
    }
  }

  function matches(record) {
    // 想定外の event 値（PreToolUse:<他のツール>）は chip が無いので常に表示する
    const eventOk = EVENTS.includes(record.event) ? state.filters.event.has(record.event) : true;
    const outcomeOk = OUTCOMES.includes(record.outcome) ? state.filters.outcome.has(record.outcome) : true;
    return eventOk && outcomeOk;
  }

  function visibleRecords() {
    return state.records.filter(matches).sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString("ja-JP", { hour12: false });
  }

  function excerpt(prompt) {
    const first = (prompt || "").split("\n").find((line) => line.trim() !== "") || "";
    return first.length > 160 ? `${first.slice(0, 160)}…` : first;
  }

  function badge(text, cls) {
    const el = document.createElement("span");
    el.className = `badge ${cls || ""}`;
    el.textContent = text;
    return el;
  }

  function renderList() {
    const visible = visibleRecords();
    listEl.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = state.records.length === 0 ? "まだ記録がありません" : "絞り込みに一致する記録がありません";
      listEl.appendChild(empty);
    }
    for (const record of visible) {
      const row = document.createElement("div");
      row.className = `row${record.ts === state.selectedTs ? " selected" : ""}`;
      row.dataset.ts = record.ts;
      const head = document.createElement("div");
      head.className = "head";
      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = fmtTime(record.ts);
      head.append(ts, badge(record.event), badge(record.outcome, record.outcome));
      const winner = document.createElement("span");
      winner.className = "winner";
      winner.textContent = record.winner || "-";
      head.appendChild(winner);
      const ex = document.createElement("div");
      ex.className = "excerpt";
      ex.textContent = excerpt(record.prompt);
      row.append(head, ex);
      row.addEventListener("click", () => {
        state.selectedTs = record.ts;
        render();
      });
      listEl.appendChild(row);
    }
    statsEl.textContent = `表示 ${visible.length} / 全体 ${state.records.length} / 捨てた行 ${state.droppedLines}`;
  }

  function dl(pairs) {
    const el = document.createElement("dl");
    for (const [key, value] of pairs) {
      if (value === undefined || value === null || value === "") continue;
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      el.append(dt, dd);
    }
    return el;
  }

  function renderDetail() {
    const record = state.records.find((r) => r.ts === state.selectedTs);
    detailEl.replaceChildren();
    if (record === undefined) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "左の一覧から選んでくださいまし";
      detailEl.appendChild(empty);
      return;
    }
    detailEl.appendChild(dl([
      ["ts", record.ts],
      ["event", record.event],
      ["outcome", record.outcome],
      ["winner", record.winner],
      ["noneProbability", record.noneProbability === null ? null : record.noneProbability.toFixed(2)],
      ["confidence", record.confidence === undefined ? null : record.confidence.toFixed(2)],
      ["session_id", record.session_id],
      ["cwd", record.cwd],
      ["agent_type", record.agent_type],
      ["elapsedMs", record.elapsedMs],
      ["rosterSize", record.rosterSize],
      ["model", record.model],
      ["usage", record.usage ? `in ${record.usage.input_tokens} / out ${record.usage.output_tokens}` : null],
      ["error", record.error],
    ]));

    const h1 = document.createElement("h2");
    h1.textContent = "prompt";
    const pre = document.createElement("pre");
    pre.textContent = record.prompt || "(空)";
    detailEl.append(h1, pre);

    const h2 = document.createElement("h2");
    h2.textContent = "ranking（確率 > 0）";
    detailEl.appendChild(h2);
    if (record.ranking.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "API を呼んでいない";
      detailEl.appendChild(empty);
      return;
    }
    const table = document.createElement("table");
    const max = record.ranking[0].probability;
    for (const item of record.ranking) {
      const tr = document.createElement("tr");
      if (item.name === "none") tr.classList.add("none");
      if (item.name === record.winner) tr.classList.add("winner");
      const name = document.createElement("td");
      name.className = "name";
      name.textContent = item.name;
      const p = document.createElement("td");
      p.className = "p";
      p.textContent = item.probability.toFixed(2);
      const bar = document.createElement("td");
      bar.className = "bar";
      const fill = document.createElement("div");
      fill.style.width = `${max > 0 ? (item.probability / max) * 100 : 0}%`;
      bar.appendChild(fill);
      tr.append(name, p, bar);
      table.appendChild(tr);
    }
    detailEl.appendChild(table);
  }

  function render() {
    renderList();
    renderDetail();
  }

  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.style.display = text ? "block" : "none";
  }

  async function loadAll() {
    try {
      const res = await fetch("/api/records");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      state.records = json.records;
      state.droppedLines = json.warnings.droppedLines;
      showBanner("");
      if (state.selectedTs === null && followEl.checked && state.records.length > 0) {
        state.selectedTs = visibleRecords()[0]?.ts ?? null;
      }
      render();
    } catch (error) {
      showBanner(`records の取得に失敗: ${error.message}`);
    }
  }

  function connect() {
    const source = new EventSource("/events");
    // 再接続のたびに全件取り直して、切断中の取りこぼしを埋める
    source.onopen = () => { loadAll(); };
    source.addEventListener("record", (ev) => {
      const record = JSON.parse(ev.data);
      state.records.push(record);
      if (followEl.checked && matches(record)) state.selectedTs = record.ts;
      render();
    });
    source.addEventListener("reset", () => {
      state.records = [];
      state.droppedLines = 0;
      state.selectedTs = null;
      loadAll();
    });
    source.onerror = () => { showBanner("サーバーとの接続が切れました。再接続を待っています"); };
  }

  buildChips();
  render();
  connect();
})();
</script>
</body>
</html>
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test typesafe/viewer/server.test.ts`
Expected: PASS（5 件）

- [ ] **Step 5: 実ログで目視確認する**

背景で起動し、実際のログを読ませてブラウザで確認する。

Run（`run_in_background`）: `bun run typesafe/viewer/server.ts`
Expected: stdout に `url=http://127.0.0.1:47391/` と `file=/Users/otto/.claude/plugins/data/typesafe-mgzl-marketplace/suggestions-v3.jsonl`

Run: `curl -s --max-time 5 http://127.0.0.1:47391/api/records | head -c 400`
Expected: `{"records":[{"ts":"2026-09-18T...` で始まる JSON。`criteria` や `shortlist` の文字列が含まれない

Run: `curl -s --max-time 3 http://127.0.0.1:47391/events`
Expected: `: connected` が届き、3 秒で timeout 終了（正常）

人間に `http://127.0.0.1:47391/` を開いてもらい、次を確認する:
- 一覧が新しい順に並び、event / outcome の badge が付いている
- chip を外すと該当する行が消え、件数表示が変わる
- 行を選ぶと右に prompt 全文と、確率バー付きのランキング（`none` は別色、winner は強調）が出る
- Claude Code で何か操作してログが追記されると、一覧の先頭に行が増える（追従 on なら詳細も切り替わる）

確認後に停止する。

Run: `pkill -f "typesafe/viewer/server.ts"`

- [ ] **Step 6: 変更ファイル一覧を確認する**

Run: `git status --short typesafe/viewer`
Expected: `index.html` と `server.test.ts` が変更されている（他は前タスクのまま）

---

## Task 5: README の更新

**Files:**
- Modify: `typesafe/README.md`（「ログ」節の直後に「ビューワー」節を追加。「テスト」節の末尾段落を書き換え）

**Interfaces:**
- Consumes: Task 3 の CLI（`--file` / `--port`、既定値）
- Produces: なし

- [ ] **Step 1: 「ビューワー」節を追加する**

`typesafe/README.md` の「## 評価」見出しの直前に次を挿入する:

```markdown
## ビューワー

```
bun run typesafe/viewer/server.ts [--file <path>] [--port <n>]
```

提案ログをブラウザで眺めるローカルサーバー。起動すると `url=http://127.0.0.1:<port>/` を出すので、それを開く。`--file` の既定は `~/.claude/plugins/data/typesafe-mgzl-marketplace/suggestions-v3.jsonl`、`--port` の既定は 47391。ブラウザは自動で開かない。

左の一覧は新しい順で、`event`（`UserPromptSubmit` / `PreToolUse:Bash` / `PreToolUse:Agent`）と `outcome` の chip で絞り込める。行を選ぶと右に `prompt` の全文と、Jev が返した確率のうち 0 より大きい候補だけを降順に並べたランキングが出る。`none` も同列に載せ、`winner` と一致する行を強調する。`shortlist` はランキングの上位 3 件と同じ情報なので表示しない。

ログは 1 秒間隔の size polling で差分読み取りし、新着は Server-Sent Events で一覧の先頭に流し込む。「最新に追従」が on なら詳細も新着に切り替わる。改行で終わっていない末尾行は書きかけとみなして次回に持ち越す。JSON として読めない行は捨てて件数だけ「捨てた行」に出す。ファイルが無くても起動し、生成されたら読み始める。

`calls[].request.questions.which.criteria` は全スキルの description を毎回含むため 1 行が平均 20KB あるが、ブラウザにはこれを除いた軽い形（`ViewRecord`）だけを渡す。
```

- [ ] **Step 2: 「テスト」節の末尾段落を書き換える**

`typesafe/README.md` の「## テスト」節にある次の段落:

```markdown
`hooks/suggest-skill.test.ts` のうち偽の System One を要する数件は `startFakeServer` でローカルの `Bun.serve` を立ち上げる。Claude Code の Bash サンドボックス内ではポートを bind できず `EADDRINUSE` で失敗するが、通常のシェルでは通る。サンドボックス内での失敗はテストの不備ではない。なお「API に到達できなくても無出力で exit 0（フェイルオープン）」は存在しないポートを指すだけで `Bun.serve` を使わないため、サンドボックス内でも通る。
```

を次に置き換える:

```markdown
`hooks/suggest-skill.test.ts` のうち偽の System One を要する数件と、`viewer/server.test.ts` は、ローカルの `Bun.serve` を立ち上げる。Claude Code の Bash サンドボックスは既定でポートの bind を拒否し `EADDRINUSE` で失敗するので、このリポジトリの `.claude/settings.local.json` には `sandbox.network.allowLocalBinding: true` と `allowedDomains: ["localhost", "127.0.0.1", "[::1]"]` を入れてある（前者が listen、後者が localhost への接続を許可する。設定ファイルは監視されているので再起動は要らない）。この設定が無い環境で `EADDRINUSE` になるのはテストの不備ではない。なお「API に到達できなくても無出力で exit 0（フェイルオープン）」は存在しないポートを指すだけで `Bun.serve` を使わないため、設定が無くても通る。
```

- [ ] **Step 3: 書き換えを確認する**

Run: `grep -n "## ビューワー\|allowLocalBinding" typesafe/README.md`
Expected: 「## ビューワー」が 1 件、`allowLocalBinding` が「テスト」節に 1 件

- [ ] **Step 4: 変更ファイル一覧を確認する**

Run: `git status --short typesafe`
Expected: `typesafe/README.md` が modified、`typesafe/viewer/` 配下が untracked
