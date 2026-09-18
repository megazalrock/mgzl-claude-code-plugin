# typesafe プラグイン: Jev によるスキル選択サジェスト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `UserPromptSubmit` フックで TypeSafe の System One モデル Jev に 2 リクエストを投げ、そのターンに関係するスキル 1 件または「該当なし」を `additionalContext` として注入する typesafe プラグインを作る。

**Architecture:** フック入口 `suggest-skill.ts` が stdin を読み、`roster.ts` でファイルシステムから候補スキルを毎回発見し、`pipeline.ts` が `jev.ts` 経由で Call 1（全件を浅く読む + gate 3 問）→ Call 2（上位 3 件を深く読む + fits）を実行する。結果は 1 ブロックの `additionalContext` として stdout に出し、同時に `log.ts` が JSONL へ追記する。あらゆる失敗はフェイルオープン（stdout 無出力・exit 0）で、後から当たり外れを測るために `eval/` に評価スクリプトを同梱する。

**Tech Stack:** TypeScript + bun（`bun:test`）、依存パッケージなし（ルートの `@types/bun` に相乗り）、TypeSafe System One HTTP API を `fetch` で直叩き。

**Spec:** `docs/superpowers/specs/2026-09-18-typesafe-skill-routing-design.md`（参考資料: `docs/typesafe/jev-skill-routing.md`）

## Global Constraints

- 新規パッケージ依存を追加しない。`typesafe/package.json` と `typesafe/bun.lock` は作らない。型は ルートの `@types/bun` に相乗りする。
- `plugin.json` は `{ name, description, author: { name: "otto" } }` の形式で `version` フィールドを持たない。
- テストは `bun:test` を使い、対象と同じディレクトリに `<対象>.test.ts` として置く。実行は `bun test --cwd typesafe`。
- `fetch` は必ず引数で差し替え可能にし、テストでは偽の `fetch` を渡す。テストから実ネットワークへ出ない。
- TypeScript で `!` / `as` / `any` は極力使わない。使う場合は必要な理由をコメントで残す。
- フロントマターの解析は外部依存なしの自前簡易パーサで行う。
- フェイルオープン: キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで stdout に何も出さず exit 0。
- 定数は仕様書の値をそのまま使う: `SHORTLIST = 3`、`EXCERPT_CHARS = 700`、`GATE_THRESHOLD = 0.30`、`FITS_THRESHOLD = 0.30`、roster 本文 1600 文字、Choice 候補上限 255 件、1 コール 3000 ms タイムアウト、hooks.json の `timeout` は 10。
- 環境変数: `TYPESAFE_API_KEY`（必須）、`TYPESAFE_BASE_URL`（既定 `https://api.typesafe.ai`）、`TYPESAFE_SKILL_MODEL`（既定 `jev-latest`）、`CLAUDE_PLUGIN_DATA`（ログ出力先。未設定ならログを書かない）。
- 注入する文面は仕様書の英文を一字一句そのまま使う。Jev への質問文（instructions）も一字一句そのまま使う。
- コミットは Conventional Commits の日本語 1 行。コミットメッセージにバッククォートを使わない。
- Bash は 1 コマンド 1 目的。`&&` や `;` でコマンドを連結しない。

## File Structure

- `typesafe/.claude-plugin/plugin.json` — プラグインのメタデータ。
- `typesafe/hooks/hooks.json` — `UserPromptSubmit` へのフック登録。
- `typesafe/hooks/suggest-skill.ts` — 入口。stdin 解析、スキップ判定、`additionalContext` 整形、ログ、フェイルオープン。
- `typesafe/hooks/suggest-skill.test.ts` — `Bun.spawn` による起動テスト。
- `typesafe/hooks/lib/jev.ts` — System One HTTP クライアントと質問・応答の型。
- `typesafe/hooks/lib/jev.test.ts` — 偽 `fetch` によるリクエスト検証、非 2xx とタイムアウトの例外化。
- `typesafe/hooks/lib/roster.ts` — 有効プラグインの解決、SKILL.md の収集、フロントマター簡易パーサ。
- `typesafe/hooks/lib/roster.test.ts` — 一時ディレクトリの fixture による発見結果の検証。
- `typesafe/hooks/lib/pipeline.ts` — 2 コールの組み立てと閾値判定。
- `typesafe/hooks/lib/pipeline.test.ts` — 3 経路（`gate_quiet` / `no_fit` / `suggested`）の検証。
- `typesafe/hooks/lib/log.ts` — `suggestions.jsonl` への追記。
- `typesafe/hooks/lib/log.test.ts` — 追記内容とフェイルサイレントの検証。
- `typesafe/eval/golden.json` — 手書きゴールデンセット 30 件。
- `typesafe/eval/run.ts` — 評価スクリプト（引数解析、並列実行、集計）。
- `typesafe/eval/run.test.ts` — 集計関数 `buildReport` の検証。
- `typesafe/manifest.test.ts` — マニフェスト 3 ファイルの整合検証。
- `typesafe/README.md` — 使い方・環境変数・既知の制約・評価手順。
- `.claude-plugin/marketplace.json`（既存を修正） — `plugins` 配列に typesafe を追記。

---

### Task 1: プラグインの骨組み（plugin.json / marketplace.json / hooks.json）

**Files:**
- Create: `typesafe/.claude-plugin/plugin.json`
- Create: `typesafe/hooks/hooks.json`
- Create: `typesafe/manifest.test.ts`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: フックのコマンド文字列 `bun run "${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts"`。以降のタスクはこのパスに実ファイルを置く。

このタスクにはコードのテストがないため、マニフェストの整合をテストで固定する。

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/manifest.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir);
const REPO_ROOT = join(import.meta.dir, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

describe("typesafe のマニフェスト", () => {
  test("plugin.json は name / description / author を持ち version を持たない", async () => {
    const plugin = await readJson(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));
    expect(plugin).toMatchObject({ name: "typesafe", author: { name: "otto" } });
    expect(JSON.stringify(plugin)).not.toContain('"version"');
  });

  test("hooks.json は UserPromptSubmit に suggest-skill.ts を timeout 10 で登録する", async () => {
    const hooks = await readJson(join(PLUGIN_ROOT, "hooks", "hooks.json"));
    expect(hooks).toMatchObject({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'bun run "${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts"',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
  });

  test("marketplace.json の plugins に typesafe が含まれる", async () => {
    const marketplace = await readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json"));
    expect(marketplace).toMatchObject({
      plugins: expect.arrayContaining([
        expect.objectContaining({ name: "typesafe", source: "./typesafe" }),
      ]),
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe manifest.test.ts`
Expected: FAIL（`typesafe/.claude-plugin/plugin.json` が存在せず JSON 読み込みで例外）

- [ ] **Step 3: マニフェストを書く**

`typesafe/.claude-plugin/plugin.json`:

```json
{
  "name": "typesafe",
  "description": "UserPromptSubmit フックで TypeSafe の Jev にスキル選択を問い合わせ、そのターンに関係するスキル 1 件を提案として注入する",
  "author": {
    "name": "otto"
  }
}
```

`typesafe/hooks/hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`.claude-plugin/marketplace.json` の `plugins` 配列の末尾（`ja-lint` の後）に次の要素を追記する:

```json
    {
      "name": "typesafe",
      "source": "./typesafe",
      "description": "UserPromptSubmit フックで TypeSafe の Jev にスキル選択を問い合わせ、そのターンに関係するスキル 1 件を提案として注入する"
    }
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe manifest.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/.claude-plugin/plugin.json typesafe/hooks/hooks.json typesafe/manifest.test.ts .claude-plugin/marketplace.json
```

```bash
git commit -m "feat: typesafeプラグインの骨組みとhooks設定を追加"
```

---

### Task 2: Jev クライアント `lib/jev.ts`

**Files:**
- Create: `typesafe/hooks/lib/jev.ts`
- Create: `typesafe/hooks/lib/jev.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - 型 `ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> }`
  - 型 `NoulQuestion = { type: "noul"; instructions: string }`
  - 型 `Question = ChoiceQuestion | NoulQuestion`
  - 型 `ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }`
  - 型 `NoulAnswer = { type: "noul"; noul: number }`
  - 型 `Answer = ChoiceAnswer | NoulAnswer`
  - 型 `SystemOneResponse = { model: string; answers: Record<string, Answer>; usage?: unknown }`
  - 型 `FetchLike = (input: string, init: RequestInit) => Promise<Response>`
  - 型 `JevOptions = { apiKey: string; baseUrl?: string; model?: string; fetchImpl?: FetchLike; timeoutMs?: number }`
  - 関数 `askSystemOne(state: Record<string, string>, questions: Record<string, Question>, options: JevOptions): Promise<SystemOneResponse>`
  - 定数 `DEFAULT_BASE_URL = "https://api.typesafe.ai"`、`DEFAULT_MODEL = "jev-latest"`、`DEFAULT_TIMEOUT_MS = 3000`

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/jev.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { askSystemOne, type FetchLike, type SystemOneResponse } from "./jev.ts";

const RESPONSE: SystemOneResponse = {
  model: "jev-latest",
  answers: { q: { type: "noul", noul: 0.42 } },
};

type Captured = { url: string; init: RequestInit };

function capturingFetch(): { fetchImpl: FetchLike; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, captured };
}

describe("askSystemOne", () => {
  test("既定のエンドポイントとヘッダとボディで POST する", async () => {
    const { fetchImpl, captured } = capturingFetch();
    const result = await askSystemOne(
      { request: "この差分をレビューして", recent_context: "" },
      { q: { type: "noul", instructions: "Is this a request?" } },
      { apiKey: "sk-test", fetchImpl },
    );

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      model: "jev-latest",
      state: { request: "この差分をレビューして", recent_context: "" },
      questions: { q: { type: "noul", instructions: "Is this a request?" } },
    });
    expect(result.answers["q"]).toEqual({ type: "noul", noul: 0.42 });
  });

  test("baseUrl と model の指定が反映される", async () => {
    const { fetchImpl, captured } = capturingFetch();
    await askSystemOne(
      { request: "x", recent_context: "" },
      { q: { type: "noul", instructions: "Is this a request?" } },
      { apiKey: "sk-test", baseUrl: "http://127.0.0.1:9999", model: "jev-1.13", fetchImpl },
    );
    expect(captured[0]?.url).toBe("http://127.0.0.1:9999/v1/systemone");
    expect(JSON.parse(String(captured[0]?.init.body)).model).toBe("jev-1.13");
  });

  test("非 2xx は例外になる", async () => {
    const fetchImpl: FetchLike = async () => new Response("nope", { status: 500 });
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl },
      ),
    ).rejects.toThrow("TypeSafe System One returned 500");
  });

  test("タイムアウトは例外になる", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl, timeoutMs: 10 },
      ),
    ).rejects.toThrow("aborted");
  });

  test("リトライしない（失敗しても fetch は 1 回だけ）", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("nope", { status: 503 });
    };
    await expect(
      askSystemOne(
        { request: "x", recent_context: "" },
        { q: { type: "noul", instructions: "Is this a request?" } },
        { apiKey: "sk-test", fetchImpl },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe hooks/lib/jev.test.ts`
Expected: FAIL（`Cannot find module './jev.ts'`）

- [ ] **Step 3: 最小の実装を書く**

`typesafe/hooks/lib/jev.ts`:

```ts
/** Jev に投げる 1 問。Choice は候補ごとの確率、Noul は真偽の確率を返す */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type NoulQuestion = { type: "noul"; instructions: string };
export type Question = ChoiceQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type NoulAnswer = { type: "noul"; noul: number };
export type Answer = ChoiceAnswer | NoulAnswer;

export type SystemOneResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage?: unknown;
};

/** テストで差し替えるための fetch の最小形 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type JevOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * System One に 1 リクエストを投げる。同じ state に対する質問は 1 リクエストにまとめて
 * 並列評価されるため、質問を増やしても往復は増えない。
 */
export async function askSystemOne(
  state: Record<string, string>,
  questions: Record<string, Question>,
  options: JevOptions,
): Promise<SystemOneResponse> {
  const baseUrl = options.baseUrl ?? process.env["TYPESAFE_BASE_URL"] ?? DEFAULT_BASE_URL;
  const model = options.model ?? process.env["TYPESAFE_SKILL_MODEL"] ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await doFetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`TypeSafe System One returned ${response.status}`);
  }
  return parseResponse(await response.json());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnswer(value: unknown): Answer | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] === "noul" && typeof value["noul"] === "number") {
    return { type: "noul", noul: value["noul"] };
  }
  if (
    value["type"] === "choice" &&
    typeof value["choice"] === "string" &&
    typeof value["confidence"] === "number" &&
    isRecord(value["probabilities"])
  ) {
    const probabilities: Record<string, number> = {};
    for (const [key, probability] of Object.entries(value["probabilities"])) {
      if (typeof probability === "number") probabilities[key] = probability;
    }
    return {
      type: "choice",
      choice: value["choice"],
      confidence: value["confidence"],
      probabilities,
    };
  }
  return undefined;
}

/** 応答の形が想定外なら例外にする。フェイルオープンは入口側でまとめて行う */
function parseResponse(payload: unknown): SystemOneResponse {
  if (!isRecord(payload) || !isRecord(payload["answers"])) {
    throw new Error("TypeSafe System One returned an unexpected payload");
  }
  const answers: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(payload["answers"])) {
    const answer = parseAnswer(value);
    if (answer !== undefined) answers[key] = answer;
  }
  const model = typeof payload["model"] === "string" ? payload["model"] : "";
  return { model, answers, usage: payload["usage"] };
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe hooks/lib/jev.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/hooks/lib/jev.ts typesafe/hooks/lib/jev.test.ts
```

```bash
git commit -m "feat: typesafeプラグインのJev HTTPクライアントを追加"
```

---

### Task 3: roster の発見 `lib/roster.ts`

**Files:**
- Create: `typesafe/hooks/lib/roster.ts`
- Create: `typesafe/hooks/lib/roster.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - 型 `RosterEntry = { name: string; description: string; body: string; path: string }`
  - 型 `Frontmatter = { name?: string; description?: string; disableModelInvocation: boolean }`
  - 型 `DiscoverOptions = { home?: string }`
  - 関数 `parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string }`
  - 関数 `discover(cwd: string, options?: DiscoverOptions): RosterEntry[]`
  - 定数 `BODY_CHARS = 1600`、`MAX_ENTRIES = 255`

フロントマターは外部依存なしで解析する。`---` で始まる先頭ブロックを行単位で `key: value` として読み、`name` / `description` / `disable-model-invocation` だけを見る。値が `"` または `'` で囲まれていれば外す。

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/roster.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BODY_CHARS, discover, MAX_ENTRIES, parseFrontmatter } from "./roster.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-roster-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let caseCounter = 0;

type Fixture = { home: string; cwd: string; installRoot: string };

function newFixture(): Fixture {
  const base = join(root, `case-${caseCounter++}`);
  const fixture = {
    home: join(base, "home"),
    cwd: join(base, "project"),
    installRoot: join(base, "installed"),
  };
  mkdirSync(join(fixture.home, ".claude", "plugins"), { recursive: true });
  mkdirSync(join(fixture.cwd, ".claude"), { recursive: true });
  mkdirSync(fixture.installRoot, { recursive: true });
  return fixture;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function writeSkill(skillsDir: string, dir: string, frontmatter: string, body = "本文です。"): void {
  mkdirSync(join(skillsDir, dir), { recursive: true });
  writeFileSync(join(skillsDir, dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

/** 1 プラグイン（demo@mkt）だけを user スコープで有効にした fixture を作る */
function singlePluginFixture(): Fixture & { skillsDir: string } {
  const fixture = newFixture();
  const installPath = join(fixture.installRoot, "demo");
  writeJson(join(fixture.home, ".claude", "settings.json"), {
    enabledPlugins: { "demo@mkt": true },
  });
  writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
    plugins: { "demo@mkt": [{ scope: "user", installPath }] },
  });
  return { ...fixture, skillsDir: join(installPath, "skills") };
}

describe("parseFrontmatter", () => {
  test("key: value を読み、引用符を外す", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: "差分をレビューする"\n---\n\n本文\n`,
    );
    expect(parsed.frontmatter.name).toBe("alpha");
    expect(parsed.frontmatter.description).toBe("差分をレビューする");
    expect(parsed.frontmatter.disableModelInvocation).toBe(false);
    expect(parsed.body).toBe("本文\n");
  });

  test("値に含まれるコロンは落とさない", () => {
    const parsed = parseFrontmatter(`---\ndescription: 使い方: bun run x.ts\n---\n本文\n`);
    expect(parsed.frontmatter.description).toBe("使い方: bun run x.ts");
  });

  test("disable-model-invocation: true を読む", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: x\ndisable-model-invocation: true\n---\n本文\n`,
    );
    expect(parsed.frontmatter.disableModelInvocation).toBe(true);
  });

  test("フロントマターが無いときは本文全体を body にする", () => {
    const parsed = parseFrontmatter(`# 見出し\n本文\n`);
    expect(parsed.frontmatter.name).toBeUndefined();
    expect(parsed.frontmatter.description).toBeUndefined();
    expect(parsed.body).toBe("# 見出し\n本文\n");
  });

  test("閉じの --- が無いときは本文を空として扱う", () => {
    const parsed = parseFrontmatter(`---\nname: alpha\ndescription: x\n`);
    expect(parsed.frontmatter.name).toBe("alpha");
    expect(parsed.body).toBe("");
  });
});

describe("discover", () => {
  test("有効なプラグインのスキルを plugin:name で拾う", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");

    const roster = discover(fixture.cwd, { home: fixture.home });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe("demo:alpha");
    expect(roster[0]?.description).toBe("アルファをする");
    expect(roster[0]?.body).toBe("本文です。\n");
    expect(roster[0]?.path).toBe(join(fixture.skillsDir, "alpha", "SKILL.md"));
  });

  test("フロントマターに name が無ければディレクトリ名を使う", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "beta", "description: ベータをする");
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.name).toBe("demo:beta");
  });

  test("enabledPlugins は後勝ちで、settings.local.json の false が無効化する", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeJson(join(fixture.cwd, ".claude", "settings.local.json"), {
      enabledPlugins: { "demo@mkt": false },
    });
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(0);
  });

  test("プロジェクトの settings.json で有効化できる", () => {
    const fixture = newFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeJson(join(fixture.cwd, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: { "demo@mkt": [{ scope: "user", installPath }] },
    });
    writeSkill(join(installPath, "skills"), "alpha", "name: alpha\ndescription: アルファをする");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(1);
  });

  test("projectPath が cwd に一致するエントリを採用する", () => {
    const fixture = newFixture();
    const mine = join(fixture.installRoot, "mine");
    const other = join(fixture.installRoot, "other");
    writeJson(join(fixture.home, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: {
        "demo@mkt": [
          { scope: "local", projectPath: join(fixture.installRoot, "elsewhere"), installPath: other },
          { scope: "local", projectPath: fixture.cwd, installPath: mine },
        ],
      },
    });
    writeSkill(join(mine, "skills"), "alpha", "name: mine\ndescription: こちらを拾う");
    writeSkill(join(other, "skills"), "alpha", "name: other\ndescription: 拾わない");
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.name).toBe("demo:mine");
  });

  test("scope も projectPath も一致しなければそのプラグインを読み飛ばす", () => {
    const fixture = newFixture();
    const other = join(fixture.installRoot, "other");
    writeJson(join(fixture.home, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: {
        "demo@mkt": [
          { scope: "local", projectPath: join(fixture.installRoot, "elsewhere"), installPath: other },
        ],
      },
    });
    writeSkill(join(other, "skills"), "alpha", "name: other\ndescription: 拾わない");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(0);
  });

  test("disable-model-invocation: true と description 欠落を除外する", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeSkill(
      fixture.skillsDir,
      "hidden",
      "name: hidden\ndescription: 隠す\ndisable-model-invocation: true",
    );
    writeSkill(fixture.skillsDir, "nodesc", "name: nodesc");

    const names = discover(fixture.cwd, { home: fixture.home }).map((entry) => entry.name);
    expect(names).toEqual(["demo:alpha"]);
  });

  test("ユーザーとプロジェクトのスキルはプレフィックスなしで拾う", () => {
    const fixture = newFixture();
    writeSkill(join(fixture.home, ".claude", "skills"), "u", "name: user-skill\ndescription: ユーザー");
    writeSkill(join(fixture.cwd, ".claude", "skills"), "p", "name: proj-skill\ndescription: プロジェクト");

    const names = discover(fixture.cwd, { home: fixture.home }).map((entry) => entry.name);
    expect(names).toEqual(["user-skill", "proj-skill"]);
  });

  test("同名は先に見つかったものを残す", () => {
    const fixture = newFixture();
    writeSkill(join(fixture.home, ".claude", "skills"), "dup", "name: dup\ndescription: ユーザー側");
    writeSkill(join(fixture.cwd, ".claude", "skills"), "dup", "name: dup\ndescription: プロジェクト側");

    const roster = discover(fixture.cwd, { home: fixture.home });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.description).toBe("ユーザー側");
  });

  test("body は先頭 1600 文字で打ち切る", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "long", "name: long\ndescription: 長い", "あ".repeat(3000));
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.body.length).toBe(BODY_CHARS);
  });

  test("255 件を超えたら先頭 255 件で打ち切る", () => {
    const fixture = singlePluginFixture();
    for (let i = 0; i < MAX_ENTRIES + 45; i++) {
      writeSkill(fixture.skillsDir, `s${String(i).padStart(4, "0")}`, `name: s${i}\ndescription: d${i}`);
    }
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(MAX_ENTRIES);
  });

  test("設定ファイルが無くても例外にならず空を返す", () => {
    const fixture = newFixture();
    expect(discover(fixture.cwd, { home: fixture.home })).toEqual([]);
  });

  test("壊れた JSON の設定は読み飛ばす", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeFileSync(join(fixture.cwd, ".claude", "settings.json"), "{ broken");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe hooks/lib/roster.test.ts`
Expected: FAIL（`Cannot find module './roster.ts'`）

- [ ] **Step 3: 最小の実装を書く**

`typesafe/hooks/lib/roster.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Jev に渡す候補スキル 1 件 */
export type RosterEntry = {
  /** "cbo:review__diff" など。プラグイン外のスキルはプレフィックスなし */
  name: string;
  /** フロントマターの description 全文 */
  description: string;
  /** フロントマター以降の本文の先頭 1600 文字 */
  body: string;
  /** SKILL.md の絶対パス。ログとデバッグ用 */
  path: string;
};

export type Frontmatter = {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
};

export type DiscoverOptions = { home?: string };

export const BODY_CHARS = 1600;
/** Jev の Choice が受け取れる候補数の上限 */
export const MAX_ENTRIES = 255;

function stripQuotes(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

/**
 * SKILL.md の先頭フロントマターを行単位で読む簡易パーサ。
 * 外部依存を持たないため、ネストやブロックスカラーは扱わず key: value だけを見る。
 */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const frontmatter: Frontmatter = { disableModelInvocation: false };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatter, body: text };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter, body: "" };

  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? "";
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (key === "name") frontmatter.name = value;
    if (key === "description") frontmatter.description = value;
    if (key === "disable-model-invocation") frontmatter.disableModelInvocation = value === "true";
  }

  return { frontmatter, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** settings.json 3 枚の enabledPlugins を後勝ちでマージし、true のキーだけ返す */
function enabledPluginKeys(cwd: string, home: string): string[] {
  const merged = new Map<string, boolean>();
  const files = [
    join(home, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
  for (const file of files) {
    const settings = readJsonFile(file);
    if (!isRecord(settings)) continue;
    const enabled = settings["enabledPlugins"];
    if (!isRecord(enabled)) continue;
    for (const [key, value] of Object.entries(enabled)) {
      if (typeof value === "boolean") merged.set(key, value);
    }
  }
  return [...merged.entries()].filter(([, value]) => value).map(([key]) => key);
}

/** installed_plugins.json から、この cwd に効くインストール先を引く */
function installPathFor(key: string, cwd: string, home: string): string | undefined {
  const installed = readJsonFile(join(home, ".claude", "plugins", "installed_plugins.json"));
  if (!isRecord(installed)) return undefined;
  const plugins = installed["plugins"];
  if (!isRecord(plugins)) return undefined;
  const entries = plugins[key];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const installPath = entry["installPath"];
    if (typeof installPath !== "string") continue;
    if (entry["scope"] === "user" || entry["projectPath"] === cwd) return installPath;
  }
  return undefined;
}

function readSkill(skillsDir: string, dirName: string, prefix: string): RosterEntry | undefined {
  const path = join(skillsDir, dirName, "SKILL.md");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const { frontmatter, body } = parseFrontmatter(text);
  if (frontmatter.description === undefined || frontmatter.description === "") return undefined;
  if (frontmatter.disableModelInvocation) return undefined;
  const bare = frontmatter.name === undefined || frontmatter.name === "" ? dirName : frontmatter.name;
  return {
    name: `${prefix}${bare}`,
    description: frontmatter.description,
    body: body.slice(0, BODY_CHARS),
    path,
  };
}

function collect(skillsDir: string, prefix: string, into: Map<string, RosterEntry>): void {
  let dirNames: string[];
  try {
    dirNames = readdirSync(skillsDir).sort();
  } catch {
    return;
  }
  for (const dirName of dirNames) {
    const entry = readSkill(skillsDir, dirName, prefix);
    if (entry === undefined) continue;
    if (!into.has(entry.name)) into.set(entry.name, entry);
  }
}

/**
 * 有効なプラグインとユーザー / プロジェクトのスキルディレクトリを走査して roster を作る。
 * キャッシュは持たず毎回ディスクを読む。数十件の規模なら hook の予算内に収まる。
 */
export function discover(cwd: string, options: DiscoverOptions = {}): RosterEntry[] {
  const home = options.home ?? process.env["HOME"] ?? homedir();
  const entries = new Map<string, RosterEntry>();

  for (const key of enabledPluginKeys(cwd, home)) {
    const installPath = installPathFor(key, cwd, home);
    if (installPath === undefined) continue;
    const pluginName = key.split("@")[0] ?? key;
    collect(join(installPath, "skills"), `${pluginName}:`, entries);
  }
  collect(join(home, ".claude", "skills"), "", entries);
  collect(join(cwd, ".claude", "skills"), "", entries);

  const all = [...entries.values()];
  if (all.length > MAX_ENTRIES) {
    process.stderr.write(
      `typesafe suggest-skill: roster が ${all.length} 件あるため先頭 ${MAX_ENTRIES} 件で打ち切りました\n`,
    );
    return all.slice(0, MAX_ENTRIES);
  }
  return all;
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe hooks/lib/roster.test.ts`
Expected: PASS（18 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/hooks/lib/roster.ts typesafe/hooks/lib/roster.test.ts
```

```bash
git commit -m "feat: typesafeプラグインのスキルroster発見を追加"
```

---

### Task 4: パイプライン `lib/pipeline.ts`

**Files:**
- Create: `typesafe/hooks/lib/pipeline.ts`
- Create: `typesafe/hooks/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `jev.ts` の `askSystemOne` / `Question` / `JevOptions` / `SystemOneResponse`、`roster.ts` の `RosterEntry`
- Produces:
  - 定数 `SHORTLIST = 3`、`EXCERPT_CHARS = 700`、`GATE_THRESHOLD = 0.30`、`FITS_THRESHOLD = 0.30`
  - 型 `Outcome = "suggested" | "gate_quiet" | "no_fit"`
  - 型 `GateScores = { acts_on_user_system: number; would_follow_documented_procedure: number; prose_suffices: number; mean: number }`
  - 型 `ShortlistItem = { name: string; wideProbability: number; rerankProbability?: number; fits?: number }`
  - 型 `SuggestResult = { outcome: Outcome; winner: string | null; gate: GateScores; shortlist: ShortlistItem[]; rerankConfidence?: number; elapsedMs: number }`
  - 関数 `suggest(prompt: string, roster: readonly RosterEntry[], options: JevOptions): Promise<SuggestResult>`

質問文は仕様書の英文をそのまま使う。

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/pipeline.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { FetchLike, SystemOneResponse } from "./jev.ts";
import type { RosterEntry } from "./roster.ts";
import { FITS_THRESHOLD, GATE_THRESHOLD, SHORTLIST, suggest } from "./pipeline.ts";

const ROSTER: RosterEntry[] = [
  {
    name: "mgzl:commiting-to-git",
    description: "差分を分析しコミットメッセージを生成してコミットする",
    body: "コミット手順の本文。",
    path: "/tmp/a/SKILL.md",
  },
  {
    name: "reviewview:reviewview-prepare",
    description: "レビュー結果を人間にトリアージ依頼する",
    body: "トリアージ依頼の本文。",
    path: "/tmp/b/SKILL.md",
  },
  {
    name: "fading-memory:remember",
    description: "セッションの内容から記憶を作成する",
    body: "記憶作成の本文。",
    path: "/tmp/c/SKILL.md",
  },
  {
    name: "superpowers:writing-plans",
    description: "仕様から実装計画を書く",
    body: "計画作成の本文。",
    path: "/tmp/d/SKILL.md",
  },
];

type Body = { model: string; state: Record<string, string>; questions: Record<string, unknown> };

function queuedFetch(responses: SystemOneResponse[]): {
  fetchImpl: FetchLike;
  bodies: Body[];
} {
  const bodies: Body[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const response = responses[index++];
    if (response === undefined) throw new Error("予定外の fetch 呼び出し");
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, bodies };
}

function call1(gate: [number, number, number], probabilities: Record<string, number>, choice: string): SystemOneResponse {
  return {
    model: "jev-latest",
    answers: {
      which: { type: "choice", choice, confidence: 0.6, probabilities },
      "gate::acts_on_user_system": { type: "noul", noul: gate[0] },
      "gate::would_follow_documented_procedure": { type: "noul", noul: gate[1] },
      "gate::prose_suffices": { type: "noul", noul: gate[2] },
    },
  };
}

const OPTIONS = { apiKey: "sk-test", baseUrl: "http://127.0.0.1:9", model: "jev-latest" };

describe("suggest", () => {
  test("gate が閾値未満なら gate_quiet で終わり Call 2 を呼ばない", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    const result = await suggest("モナドとは何ですか", ROSTER, { ...OPTIONS, fetchImpl });

    expect(result.outcome).toBe("gate_quiet");
    expect(result.winner).toBeNull();
    // gate で黙っても Call 1 の上位候補は評価用に残す（rerank / fits は無い）
    expect(result.shortlist).toEqual([{ name: "mgzl:commiting-to-git", wideProbability: 0.4 }]);
    expect(result.gate.mean).toBeCloseTo((0.1 + 0.1 + (1 - 0.9)) / 3, 10);
    expect(result.gate.mean).toBeLessThan(GATE_THRESHOLD);
    expect(bodies).toHaveLength(1);
  });

  test("Call 1 は全件を description で問い、gate 3 問を同じリクエストに載せる", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl });

    const body = bodies[0];
    expect(body?.state).toEqual({ request: "この変更をコミットして", recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual([
      "which",
      "gate::acts_on_user_system",
      "gate::would_follow_documented_procedure",
      "gate::prose_suffices",
    ]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Which of these skills, if any, is the right one to load to help with the user's latest request?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
      },
    });
    expect(body?.questions["gate::prose_suffices"]).toEqual({
      type: "noul",
      instructions:
        "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
    });
  });

  test("fits の最大値が閾値未満なら no_fit", async () => {
    const { fetchImpl } = queuedFetch([
      call1(
        [0.9, 0.9, 0.1],
        {
          "mgzl:commiting-to-git": 0.5,
          "reviewview:reviewview-prepare": 0.3,
          "fading-memory:remember": 0.15,
          "superpowers:writing-plans": 0.05,
        },
        "mgzl:commiting-to-git",
      ),
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.4,
            probabilities: {
              "mgzl:commiting-to-git": 0.6,
              "reviewview:reviewview-prepare": 0.3,
              "fading-memory:remember": 0.1,
            },
          },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.2 },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.1 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.05 },
        },
      },
    ]);

    const result = await suggest("Slack にこの結果を投稿して", ROSTER, { ...OPTIONS, fetchImpl });
    expect(result.outcome).toBe("no_fit");
    expect(result.winner).toBeNull();
    expect(result.shortlist).toHaveLength(SHORTLIST);
    expect(Math.max(...result.shortlist.map((item) => item.fits ?? 0))).toBeLessThan(FITS_THRESHOLD);
  });

  test("fits が閾値以上なら Call 2 の choice を勝者にする", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      call1(
        [0.9, 0.8, 0.1],
        {
          "mgzl:commiting-to-git": 0.2,
          "reviewview:reviewview-prepare": 0.5,
          "fading-memory:remember": 0.2,
          "superpowers:writing-plans": 0.1,
        },
        "reviewview:reviewview-prepare",
      ),
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "reviewview:reviewview-prepare",
            confidence: 0.87,
            probabilities: {
              "reviewview:reviewview-prepare": 0.8,
              "mgzl:commiting-to-git": 0.15,
              "fading-memory:remember": 0.05,
            },
          },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.91 },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.12 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.04 },
        },
      },
    ]);

    const result = await suggest(
      "このブランチのレビュー結果をトリアージに回して",
      ROSTER,
      { ...OPTIONS, fetchImpl },
    );

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("reviewview:reviewview-prepare");
    expect(result.rerankConfidence).toBe(0.87);
    expect(result.shortlist.map((item) => item.name)).toEqual([
      "reviewview:reviewview-prepare",
      "mgzl:commiting-to-git",
      "fading-memory:remember",
    ]);
    expect(result.shortlist[0]?.wideProbability).toBe(0.5);
    expect(result.shortlist[0]?.rerankProbability).toBe(0.8);
    expect(result.shortlist[0]?.fits).toBe(0.91);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const body = bodies[1];
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.",
      criteria: {
        "reviewview:reviewview-prepare":
          "レビュー結果を人間にトリアージ依頼する — トリアージ依頼の本文。",
        "mgzl:commiting-to-git":
          "差分を分析しコミットメッセージを生成してコミットする — コミット手順の本文。",
        "fading-memory:remember": "セッションの内容から記憶を作成する — 記憶作成の本文。",
      },
    });
    expect(body?.questions["fits::reviewview:reviewview-prepare"]).toEqual({
      type: "noul",
      instructions:
        "Does the skill 'reviewview:reviewview-prepare' do the specific thing the user's request asks for? It is described as: レビュー結果を人間にトリアージ依頼する",
    });
  });

  test("which の答えが欠けていたら例外にする", async () => {
    const { fetchImpl } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          "gate::acts_on_user_system": { type: "noul", noul: 0.9 },
          "gate::would_follow_documented_procedure": { type: "noul", noul: 0.9 },
          "gate::prose_suffices": { type: "noul", noul: 0.1 },
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      "Jev did not answer the 'which' choice question",
    );
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe hooks/lib/pipeline.test.ts`
Expected: FAIL（`Cannot find module './pipeline.ts'`）

- [ ] **Step 3: 最小の実装を書く**

`typesafe/hooks/lib/pipeline.ts`:

```ts
import {
  type Answer,
  askSystemOne,
  type ChoiceAnswer,
  type JevOptions,
  type Question,
} from "./jev.ts";
import type { RosterEntry } from "./roster.ts";

/** Call 1 から Call 2 に渡す候補数 */
export const SHORTLIST = 3;
/** Call 2 の criteria に入れる SKILL.md 冒頭の文字数 */
export const EXCERPT_CHARS = 700;
/** gate 3 問の平均。これ未満なら提案しない */
export const GATE_THRESHOLD = 0.3;
/** fits の最大値。これ未満ならショートリストごと破棄する */
export const FITS_THRESHOLD = 0.3;

export type Outcome = "suggested" | "gate_quiet" | "no_fit";

export type GateScores = {
  acts_on_user_system: number;
  would_follow_documented_procedure: number;
  prose_suffices: number;
  mean: number;
};

export type ShortlistItem = {
  name: string;
  wideProbability: number;
  rerankProbability?: number;
  fits?: number;
};

export type SuggestResult = {
  outcome: Outcome;
  winner: string | null;
  gate: GateScores;
  shortlist: ShortlistItem[];
  rerankConfidence?: number;
  elapsedMs: number;
};

const WIDE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?";
const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.";
const GATE_ACTS =
  "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?";
const GATE_PROCEDURE =
  "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?";
const GATE_PROSE =
  "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?";

function noulOf(answers: Record<string, Answer>, key: string): number {
  const answer = answers[key];
  return answer !== undefined && answer.type === "noul" ? answer.noul : 0;
}

function choiceOf(answers: Record<string, Answer>, key: string): ChoiceAnswer | undefined {
  const answer = answers[key];
  return answer !== undefined && answer.type === "choice" ? answer : undefined;
}

/**
 * Call 1 の 2 コール構成。全件を description だけで浅く読み、
 * 同時に「そもそもスキルが要るターンか」を Noul 3 問で測る。
 */
function wideQuestions(roster: readonly RosterEntry[]): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of roster) criteria[entry.name] = entry.description;
  return {
    which: { type: "choice", instructions: WIDE_INSTRUCTIONS, criteria },
    "gate::acts_on_user_system": { type: "noul", instructions: GATE_ACTS },
    "gate::would_follow_documented_procedure": { type: "noul", instructions: GATE_PROCEDURE },
    "gate::prose_suffices": { type: "noul", instructions: GATE_PROSE },
  };
}

function rerankQuestions(candidates: readonly RosterEntry[]): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of candidates) {
    criteria[entry.name] = `${entry.description} — ${entry.body.slice(0, EXCERPT_CHARS)}`;
  }
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: RERANK_INSTRUCTIONS, criteria },
  };
  for (const entry of candidates) {
    questions[`fits::${entry.name}`] = {
      type: "noul",
      instructions: `Does the skill '${entry.name}' do the specific thing the user's request asks for? It is described as: ${entry.description}`,
    };
  }
  return questions;
}

export async function suggest(
  prompt: string,
  roster: readonly RosterEntry[],
  options: JevOptions,
): Promise<SuggestResult> {
  const startedAt = Date.now();
  const state = { request: prompt, recent_context: "" };

  const wide = await askSystemOne(state, wideQuestions(roster), options);
  const wideWhich = choiceOf(wide.answers, "which");
  if (wideWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question");
  }

  const acts = noulOf(wide.answers, "gate::acts_on_user_system");
  const procedure = noulOf(wide.answers, "gate::would_follow_documented_procedure");
  const prose = noulOf(wide.answers, "gate::prose_suffices");
  // prose_suffices だけは「文章で足りる」ほど提案が不要になるため反転して平均に入れる
  const gate: GateScores = {
    acts_on_user_system: acts,
    would_follow_documented_procedure: procedure,
    prose_suffices: prose,
    mean: (acts + procedure + (1 - prose)) / 3,
  };

  const byName = new Map(roster.map((entry) => [entry.name, entry]));
  const candidates = Object.entries(wideWhich.probabilities)
    .sort(([, left], [, right]) => right - left)
    .flatMap(([name, probability]) => {
      const entry = byName.get(name);
      return entry === undefined ? [] : [{ entry, probability }];
    })
    .slice(0, SHORTLIST);

  if (gate.mean < GATE_THRESHOLD) {
    // Call 2 は呼ばないが、gate が黙らせた依頼でも Call 1 の上位候補は評価の材料として残す
    return {
      outcome: "gate_quiet",
      winner: null,
      gate,
      shortlist: candidates.map(({ entry, probability }) => ({
        name: entry.name,
        wideProbability: probability,
      })),
      elapsedMs: Date.now() - startedAt,
    };
  }

  const rerank = await askSystemOne(
    state,
    rerankQuestions(candidates.map((candidate) => candidate.entry)),
    options,
  );
  const rerankWhich = choiceOf(rerank.answers, "which");
  if (rerankWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question");
  }

  const shortlist: ShortlistItem[] = candidates.map(({ entry, probability }) => ({
    name: entry.name,
    wideProbability: probability,
    rerankProbability: rerankWhich.probabilities[entry.name],
    fits: noulOf(rerank.answers, `fits::${entry.name}`),
  }));

  const maxFits = shortlist.reduce((max, item) => Math.max(max, item.fits ?? 0), 0);
  const elapsedMs = Date.now() - startedAt;
  if (maxFits < FITS_THRESHOLD) {
    return { outcome: "no_fit", winner: null, gate, shortlist, elapsedMs };
  }
  return {
    outcome: "suggested",
    winner: rerankWhich.choice,
    gate,
    shortlist,
    rerankConfidence: rerankWhich.confidence,
    elapsedMs,
  };
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe hooks/lib/pipeline.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/hooks/lib/pipeline.ts typesafe/hooks/lib/pipeline.test.ts
```

```bash
git commit -m "feat: typesafeプラグインの2コールパイプラインを追加"
```

---

### Task 5: 提案ログ `lib/log.ts`

**Files:**
- Create: `typesafe/hooks/lib/log.ts`
- Create: `typesafe/hooks/lib/log.test.ts`

**Interfaces:**
- Consumes: `pipeline.ts` の `Outcome` / `GateScores` / `ShortlistItem`
- Produces:
  - 型 `LogOutcome = Outcome | "skipped" | "error"`
  - 型 `LogRecord = { ts: string; session_id: string; cwd: string; prompt: string; outcome: LogOutcome; winner: string | null; gate: GateScores | null; shortlist: ShortlistItem[]; rerankConfidence?: number; elapsedMs: number; rosterSize: number; error?: string }`
  - 関数 `append(record: Omit<LogRecord, "ts">, dataDir?: string): void`
  - 定数 `LOG_FILE_NAME = "suggestions.jsonl"`

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/log.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { append, LOG_FILE_NAME, type LogRecord } from "./log.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-log-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BASE: Omit<LogRecord, "ts"> = {
  session_id: "sess-1",
  cwd: "/Users/otto/workspace/mgzl-claude-code-plugin",
  prompt: "この変更をコミットして",
  outcome: "suggested",
  winner: "mgzl:commiting-to-git",
  gate: {
    acts_on_user_system: 0.9,
    would_follow_documented_procedure: 0.8,
    prose_suffices: 0.1,
    mean: 0.8666666666666667,
  },
  shortlist: [{ name: "mgzl:commiting-to-git", wideProbability: 0.7, rerankProbability: 0.9, fits: 0.95 }],
  rerankConfidence: 0.88,
  elapsedMs: 412,
  rosterSize: 48,
  error: undefined,
};

describe("append", () => {
  test("存在しないディレクトリを作って 1 行 1 JSON で追記する", () => {
    const dataDir = join(root, "fresh", "nested");
    append(BASE, dataDir);
    append({ ...BASE, outcome: "gate_quiet", winner: null }, dataDir);

    const lines = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(typeof first.ts).toBe("string");
    expect(new Date(first.ts).toISOString()).toBe(first.ts);
    expect(first.prompt).toBe("この変更をコミットして");
    expect(first.outcome).toBe("suggested");
    expect(first.winner).toBe("mgzl:commiting-to-git");
    expect(first.rosterSize).toBe(48);
    expect(JSON.parse(lines[1] ?? "{}").outcome).toBe("gate_quiet");
  });

  test("dataDir が未指定なら何も書かない", () => {
    expect(() => append(BASE, undefined)).not.toThrow();
  });

  test("書き込みに失敗しても例外を投げない", () => {
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "ファイルなのでディレクトリを作れない");
    expect(() => append(BASE, join(blocker, "under"))).not.toThrow();
  });

  test("error のときはメッセージを載せる", () => {
    const dataDir = join(root, "errors");
    append(
      {
        ...BASE,
        outcome: "error",
        winner: null,
        gate: null,
        shortlist: [],
        rerankConfidence: undefined,
        error: "TypeSafe System One returned 500",
      },
      dataDir,
    );
    const line = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd();
    expect(JSON.parse(line).error).toBe("TypeSafe System One returned 500");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe hooks/lib/log.test.ts`
Expected: FAIL（`Cannot find module './log.ts'`）

- [ ] **Step 3: 最小の実装を書く**

`typesafe/hooks/lib/log.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GateScores, Outcome, ShortlistItem } from "./pipeline.ts";

/** pipeline の 3 経路に、入口で打ち切った skipped と失敗した error を足したもの */
export type LogOutcome = Outcome | "skipped" | "error";

export type LogRecord = {
  /** ISO 8601 */
  ts: string;
  session_id: string;
  cwd: string;
  /** 依頼文の全文。評価セットへそのまま転記できるようにする */
  prompt: string;
  outcome: LogOutcome;
  winner: string | null;
  gate: GateScores | null;
  shortlist: ShortlistItem[];
  rerankConfidence?: number;
  elapsedMs: number;
  rosterSize: number;
  error?: string;
};

export const LOG_FILE_NAME = "suggestions.jsonl";

/**
 * 提案の記録を 1 行 1 JSON で追記する。dataDir 未指定なら何もしない。
 * 書き込み失敗は握りつぶす。ログの都合で hook を落とさないため。
 */
export function append(record: Omit<LogRecord, "ts">, dataDir?: string): void {
  const dir = dataDir ?? process.env["CLAUDE_PLUGIN_DATA"];
  if (dir === undefined || dir === "") return;
  try {
    mkdirSync(dir, { recursive: true });
    const line: LogRecord = { ts: new Date().toISOString(), ...record };
    appendFileSync(join(dir, LOG_FILE_NAME), `${JSON.stringify(line)}\n`);
  } catch {
    return;
  }
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe hooks/lib/log.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/hooks/lib/log.ts typesafe/hooks/lib/log.test.ts
```

```bash
git commit -m "feat: typesafeプラグインの提案ログ出力を追加"
```

---

### Task 6: 入口 `suggest-skill.ts` と起動テスト

**Files:**
- Create: `typesafe/hooks/suggest-skill.ts`
- Create: `typesafe/hooks/suggest-skill.test.ts`

**Interfaces:**
- Consumes: `lib/roster.ts` の `discover(cwd, options?)`、`lib/pipeline.ts` の `suggest(prompt, roster, options)` と `SuggestResult`、`lib/log.ts` の `append(record, dataDir?)`
- Produces: 実行可能なフック。stdout は `{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<skill_relevance>…</skill_relevance>" } }` の 1 行、または無出力。

注入する文面は仕様書のまま:

- 提案あり: `<skill_relevance>Relevant to the current request: <name>. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>`
- 提案なし: `<skill_relevance>No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.</skill_relevance>`

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/suggest-skill.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "suggest-skill.ts");

type RunResult = { stdout: string; stderr: string; exitCode: number };

/** TYPESAFE_* を明示的に組み立てた環境で hook を起動する */
async function runHook(
  payload: Record<string, unknown>,
  extraEnv: Record<string, string>,
): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TYPESAFE_")) continue;
    if (value !== undefined) env[key] = value;
  }
  const proc = Bun.spawn(["bun", "run", HOOK], {
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, ...extraEnv },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** 到達できないポートを指すので、ここへ実際に出れば必ず失敗する */
const UNREACHABLE = { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: "http://127.0.0.1:9" };

describe("suggest-skill フック", () => {
  test("TYPESAFE_API_KEY 未設定なら無出力で exit 0", async () => {
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s1" },
      {},
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("prompt が / で始まるなら無出力で exit 0", async () => {
    const result = await runHook(
      { prompt: "/mgzl:commiting-to-git", cwd: process.cwd(), session_id: "s2" },
      UNREACHABLE,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("prompt が空なら無出力で exit 0", async () => {
    const result = await runHook({ prompt: "", cwd: process.cwd(), session_id: "s3" }, UNREACHABLE);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("API に到達できなくても無出力で exit 0（フェイルオープン）", async () => {
    const result = await runHook(
      { prompt: "この変更をコミットして", cwd: process.cwd(), session_id: "s4" },
      UNREACHABLE,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("stdin が壊れた JSON でも無出力で exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", HOOK], {
      stdin: Buffer.from("{ broken"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toBe("");
    expect(await proc.exited).toBe(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe hooks/suggest-skill.test.ts`
Expected: FAIL（`suggest-skill.ts` が存在せず bun がモジュール解決に失敗し、exit code が 0 にならない）

- [ ] **Step 3: 最小の実装を書く**

`typesafe/hooks/suggest-skill.ts`:

```ts
import { append } from "./lib/log.ts";
import { type SuggestResult, suggest } from "./lib/pipeline.ts";
import { discover } from "./lib/roster.ts";

const SUGGESTED_PREFIX = "Relevant to the current request: ";
const SUGGESTED_SUFFIX =
  ". Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.";
const NO_SUGGESTION =
  "No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.";

type Payload = { prompt: string; cwd: string; sessionId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function parsePayload(raw: string): Payload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const cwd = readString(parsed, "cwd");
  return {
    prompt: readString(parsed, "prompt"),
    cwd: cwd === "" ? process.cwd() : cwd,
    sessionId: readString(parsed, "session_id"),
  };
}

function additionalContext(result: SuggestResult): string | undefined {
  if (result.outcome === "suggested" && result.winner !== null) {
    return `<skill_relevance>${SUGGESTED_PREFIX}${result.winner}${SUGGESTED_SUFFIX}</skill_relevance>`;
  }
  if (result.outcome === "gate_quiet" || result.outcome === "no_fit") {
    return `<skill_relevance>${NO_SUGGESTION}</skill_relevance>`;
  }
  return undefined;
}

function emit(context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
}

function logSkipped(payload: Payload | undefined, rosterSize: number): void {
  append({
    session_id: payload?.sessionId ?? "",
    cwd: payload?.cwd ?? "",
    prompt: payload?.prompt ?? "",
    outcome: "skipped",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize,
  });
}

async function main(): Promise<void> {
  const payload = parsePayload(await Bun.stdin.text());
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  // 明示的なスキル呼び出し（/ 始まり）には提案が不要で、キー未設定なら機能そのものが無効
  if (payload === undefined) return;
  if (payload.prompt === "" || payload.prompt.startsWith("/") || apiKey === "") {
    logSkipped(payload, 0);
    return;
  }

  const roster = discover(payload.cwd);
  if (roster.length === 0) {
    logSkipped(payload, 0);
    return;
  }

  const result = await suggest(payload.prompt, roster, { apiKey });
  const context = additionalContext(result);
  if (context !== undefined) emit(context);

  append({
    session_id: payload.sessionId,
    cwd: payload.cwd,
    prompt: payload.prompt,
    outcome: result.outcome,
    winner: result.winner,
    gate: result.gate,
    shortlist: result.shortlist,
    rerankConfidence: result.rerankConfidence,
    elapsedMs: result.elapsedMs,
    rosterSize: roster.length,
  });
}

try {
  await main();
} catch (e) {
  // 提案の失敗でユーザーのターンを止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`typesafe suggest-skill: ${message}\n`);
  append({
    session_id: "",
    cwd: process.cwd(),
    prompt: "",
    outcome: "error",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize: 0,
    error: message,
  });
}
process.exit(0);
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe hooks/suggest-skill.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミットする**

```bash
git add typesafe/hooks/suggest-skill.ts typesafe/hooks/suggest-skill.test.ts
```

```bash
git commit -m "feat: typesafeプラグインのUserPromptSubmitフック入口を追加"
```

---

### Task 7: 評価 `eval/golden.json` と `eval/run.ts`

**Files:**
- Create: `typesafe/eval/golden.json`
- Create: `typesafe/eval/run.ts`
- Create: `typesafe/eval/run.test.ts`

**Interfaces:**
- Consumes: `../hooks/lib/roster.ts` の `discover(cwd, options?)`、`../hooks/lib/pipeline.ts` の `suggest(prompt, roster, options)`
- Produces:
  - 型 `GoldenCase = { request: string; expected: string | null }`
  - 型 `EvalRow = { request: string; expected: string | null; winner: string | null; gateMean: number; maxFits: number }`
  - 関数 `buildReport(rows: readonly EvalRow[]): string`
  - 関数 `parseArgs(argv: readonly string[]): { cwd: string; golden: string; concurrency: number }`

`golden.json` の 30 件はこのマシンで実際に有効なスキル名だけを使う（`~/.claude/settings.json` と `.claude/settings.local.json` の `enabledPlugins` が true のプラグイン → `installed_plugins.json` の `installPath` → `skills/*/SKILL.md` の frontmatter `name` で確認済み）。

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/eval/run.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildReport, type EvalRow, type GoldenCase, parseArgs } from "./run.ts";

const ROWS: EvalRow[] = [
  {
    request: "今の変更をコミットして",
    expected: "mgzl:commiting-to-git",
    winner: "mgzl:commiting-to-git",
    gateMean: 0.82,
    maxFits: 0.91,
  },
  {
    request: "このプロジェクトの AutoMemory を棚卸しして",
    expected: "mgzl:audit-memory",
    winner: "fading-memory:maintain",
    gateMean: 0.71,
    maxFits: 0.55,
  },
  {
    request: "モナドとは何ですか",
    expected: null,
    winner: null,
    gateMean: 0.12,
    maxFits: 0,
  },
  {
    request: "Slack のチャンネルにこの結果を投稿して",
    expected: null,
    winner: "mgzl:create-issue",
    gateMean: 0.64,
    maxFits: 0.41,
  },
];

describe("buildReport", () => {
  test("件数と 2 つの誤り率を key=value で出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain("total=4");
    expect(report).toContain("with_skill=2");
    expect(report).toContain("without_skill=2");
    expect(report).toContain("wrong_suggestion_rate=0.500");
    expect(report).toContain("unneeded_suggestion_rate=0.500");
  });

  test("勝者の fits を 0.1 刻みの帯にして件数と正解率を出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain("band=0.4-0.5 count=1 accuracy=0.000");
    expect(report).toContain("band=0.5-0.6 count=1 accuracy=0.000");
    expect(report).toContain("band=0.9-1.0 count=1 accuracy=1.000");
    expect(report).not.toContain("band=0.0-0.1");
  });

  test("不一致ケースを一覧で出す", () => {
    const report = buildReport(ROWS);
    expect(report).toContain(
      'mismatch request="このプロジェクトの AutoMemory を棚卸しして" expected=mgzl:audit-memory winner=fading-memory:maintain gate=0.71 fits=0.55',
    );
    expect(report).toContain(
      'mismatch request="Slack のチャンネルにこの結果を投稿して" expected=null winner=mgzl:create-issue gate=0.64 fits=0.41',
    );
  });

  test("該当ありで何も提案しなかった場合も誤りとして数える", () => {
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        gateMean: 0.2,
        maxFits: 0,
      },
    ]);
    expect(report).toContain("wrong_suggestion_rate=1.000");
    expect(report).toContain('mismatch request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.20 fits=0.00');
  });

  test("request は先頭 60 文字に切り詰める", () => {
    const long = "あ".repeat(80);
    const report = buildReport([
      { request: long, expected: "mgzl:commiting-to-git", winner: null, gateMean: 0.2, maxFits: 0 },
    ]);
    expect(report).toContain(`mismatch request="${"あ".repeat(60)}"`);
    expect(report).not.toContain("あ".repeat(61));
  });
});

describe("parseArgs", () => {
  test("--cwd を必須にし、golden と concurrency に既定値を入れる", () => {
    const args = parseArgs(["--cwd", "/Users/otto/workspace/mgzl-claude-code-plugin"]);
    expect(args.cwd).toBe("/Users/otto/workspace/mgzl-claude-code-plugin");
    expect(args.golden).toBe(join(import.meta.dir, "golden.json"));
    expect(args.concurrency).toBe(4);
  });

  test("--golden と --concurrency を受け取る", () => {
    const args = parseArgs(["--cwd", "/x", "--golden", "/y/g.json", "--concurrency", "8"]);
    expect(args.golden).toBe("/y/g.json");
    expect(args.concurrency).toBe(8);
  });

  test("--cwd が無ければ例外にする", () => {
    expect(() => parseArgs([])).toThrow("--cwd is required");
  });
});

describe("golden.json", () => {
  test("30 件で、該当あり 20 件・該当なし 10 件", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    expect(Array.isArray(parsed)).toBe(true);
    const cases: GoldenCase[] = Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "object" &&
          item !== null &&
          "request" in item &&
          typeof item.request === "string" &&
          "expected" in item &&
          (typeof item.expected === "string" || item.expected === null)
            ? [{ request: item.request, expected: item.expected }]
            : [],
        )
      : [];
    expect(cases).toHaveLength(30);
    expect(cases.filter((c) => c.expected !== null)).toHaveLength(20);
    expect(cases.filter((c) => c.expected === null)).toHaveLength(10);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test --cwd typesafe eval/run.test.ts`
Expected: FAIL（`Cannot find module './run.ts'`）

- [ ] **Step 3: ゴールデンセットを書く**

`typesafe/eval/golden.json`:

```json
[
  { "request": "今の変更をコミットして", "expected": "mgzl:commiting-to-git" },
  { "request": "ステージ済みの差分だけコミットメッセージを作ってコミットしてほしい", "expected": "mgzl:commiting-to-git" },
  { "request": "このプロジェクトの AutoMemory を棚卸しして", "expected": "mgzl:audit-memory" },
  { "request": "さっき見つかった ja-lint の不具合を mgzl-claude-code-plugin の issue に起票して", "expected": "mgzl:create-issue" },
  { "request": "フックが二重に発火するバグの根本原因を突き止めて", "expected": "mgzl:investigate-bug" },
  { "request": "このリポジトリのフック構成を、コンテキストが溢れないように区切って調査して", "expected": "mgzl:investigate-budgeted" },
  { "request": "ai_instructions.md を読み込んでその指示を実行して", "expected": "mgzl:load-ai-instructions" },
  { "request": "TYPESAFE_API_KEY をコミットしない方針にしたことを覚えておいて", "expected": "fading-memory:remember" },
  { "request": "溜まっている記憶をスコア順に一覧で見せて", "expected": "fading-memory:list" },
  { "request": "記憶をコードの現状と突き合わせてメンテナンスして", "expected": "fading-memory:maintain" },
  { "request": "このブランチのレビュー結果を入れて人間にトリアージを依頼して", "expected": "reviewview:reviewview-prepare" },
  { "request": "トリアージ結果を取り込んで概要を見せて", "expected": "reviewview:reviewview-collect" },
  { "request": "この設計書から実装計画を書いて", "expected": "superpowers:writing-plans" },
  { "request": "新しいフックの機能を作りたいので、まず要件と設計を一緒に詰めたい", "expected": "superpowers:brainstorming" },
  { "request": "このパーサをテスト駆動で実装して", "expected": "superpowers:test-driven-development" },
  { "request": "テストが落ちる原因が分からないので順を追って切り分けてほしい", "expected": "superpowers:systematic-debugging" },
  { "request": "今の作業ツリーから隔離したいので作業用の worktree を用意して", "expected": "superpowers:using-git-worktrees" },
  { "request": "新しいスキルを作りたいので雛形から作って", "expected": "skill-creator:skill-creator" },
  { "request": "このリポジトリの CLAUDE.md を監査して品質を上げて", "expected": "claude-md-management:claude-md-improver" },
  { "request": "この Figma のデザインを Vue のコンポーネントとして実装して", "expected": "figma:figma-design-to-code" },
  { "request": "今日の東京の天気を教えて", "expected": null },
  { "request": "夕飯の献立を考えて", "expected": null },
  { "request": "モナドとは何ですか", "expected": null },
  { "request": "TypeScript の satisfies 演算子と as の違いを説明して", "expected": null },
  { "request": "HTTP/2 と HTTP/3 の違いをざっくり教えて", "expected": null },
  { "request": "この正規表現が何にマッチするのか読み解いて説明して", "expected": null },
  { "request": "Mastodon にこの文章を投稿して", "expected": null },
  { "request": "Notion のこのページを最新の内容に更新して", "expected": null },
  { "request": "Jira のチケットのステータスを進めて", "expected": null },
  { "request": "Slack のチャンネルにこの結果を投稿して", "expected": null }
]
```

- [ ] **Step 4: 評価スクリプトを書く**

`typesafe/eval/run.ts`:

```ts
import { join } from "node:path";
import { suggest } from "../hooks/lib/pipeline.ts";
import { discover } from "../hooks/lib/roster.ts";

export type GoldenCase = { request: string; expected: string | null };

export type EvalRow = {
  request: string;
  expected: string | null;
  winner: string | null;
  /** gate 3 問の平均 */
  gateMean: number;
  /** ショートリスト内の fits の最大値。提案なしのときは 0 */
  maxFits: number;
};

export type Args = { cwd: string; golden: string; concurrency: number };

const BAND_COUNT = 10;
const REQUEST_HEAD = 60;

export function parseArgs(argv: readonly string[]): Args {
  let cwd: string | undefined;
  let golden = join(import.meta.dir, "golden.json");
  let concurrency = 4;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (flag === "--cwd") cwd = value;
    if (flag === "--golden") golden = value;
    if (flag === "--concurrency") concurrency = Number.parseInt(value, 10);
  }
  if (cwd === undefined) throw new Error("--cwd is required");
  return { cwd, golden, concurrency };
}

function isCorrect(row: EvalRow): boolean {
  return row.winner === row.expected;
}

function bandIndex(fits: number): number {
  return Math.min(Math.floor(fits * BAND_COUNT), BAND_COUNT - 1);
}

function bandLabel(index: number): string {
  return `${(index / BAND_COUNT).toFixed(1)}-${((index + 1) / BAND_COUNT).toFixed(1)}`;
}

function rate(hits: number, total: number): string {
  return total === 0 ? "0.000" : (hits / total).toFixed(3);
}

/** 集計結果を key=value の簡素形式で組み立てる */
export function buildReport(rows: readonly EvalRow[]): string {
  const withSkill = rows.filter((row) => row.expected !== null);
  const withoutSkill = rows.filter((row) => row.expected === null);
  const wrong = withSkill.filter((row) => row.winner !== row.expected);
  const unneeded = withoutSkill.filter((row) => row.winner !== null);

  const lines: string[] = [
    `total=${rows.length}`,
    `with_skill=${withSkill.length}`,
    `without_skill=${withoutSkill.length}`,
    `wrong_suggestion_rate=${rate(wrong.length, withSkill.length)}`,
    `unneeded_suggestion_rate=${rate(unneeded.length, withoutSkill.length)}`,
  ];

  const suggested = rows.filter((row) => row.winner !== null);
  for (let index = 0; index < BAND_COUNT; index++) {
    const inBand = suggested.filter((row) => bandIndex(row.maxFits) === index);
    if (inBand.length === 0) continue;
    const correct = inBand.filter(isCorrect);
    lines.push(
      `band=${bandLabel(index)} count=${inBand.length} accuracy=${rate(correct.length, inBand.length)}`,
    );
  }

  for (const row of rows) {
    if (isCorrect(row)) continue;
    lines.push(
      `mismatch request="${row.request.slice(0, REQUEST_HEAD)}" expected=${row.expected ?? "null"} winner=${row.winner ?? "null"} gate=${row.gateMean.toFixed(2)} fits=${row.maxFits.toFixed(2)}`,
    );
  }

  return lines.join("\n");
}

function readGolden(parsed: unknown): GoldenCase[] {
  if (!Array.isArray(parsed)) throw new Error("golden must be an array");
  return parsed.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    if (!("request" in item) || typeof item.request !== "string") return [];
    if (!("expected" in item)) return [];
    const expected = item.expected;
    if (typeof expected !== "string" && expected !== null) return [];
    return [{ request: item.request, expected }];
  });
}

/** 上限 concurrency の単純なワーカープールで評価する */
async function runAll(
  cases: readonly GoldenCase[],
  args: Args,
): Promise<{ rows: EvalRow[]; rosterSize: number }> {
  const apiKey = process.env["TYPESAFE_API_KEY"];
  if (apiKey === undefined || apiKey === "") throw new Error("TYPESAFE_API_KEY is required");
  const roster = discover(args.cwd);
  if (roster.length === 0) throw new Error(`roster is empty for cwd ${args.cwd}`);

  const rows: EvalRow[] = new Array(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = cases[index];
      if (item === undefined) return;
      const result = await suggest(item.request, roster, { apiKey });
      rows[index] = {
        request: item.request,
        expected: item.expected,
        winner: result.winner,
        gateMean: result.gate.mean,
        maxFits: result.shortlist.reduce((max, entry) => Math.max(max, entry.fits ?? 0), 0),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, () => worker()),
  );
  return { rows, rosterSize: roster.length };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const cases = readGolden(JSON.parse(await Bun.file(args.golden).text()));
  const { rows, rosterSize } = await runAll(cases, args);
  console.log(buildReport(rows));
  console.log(`roster_size=${rosterSize}`);
}
```

- [ ] **Step 5: テストを実行して通過を確認する**

Run: `bun test --cwd typesafe eval/run.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 6: 実データで 1 回動かして出力を目で確認する**

Run: `TYPESAFE_API_KEY=<実キー> bun run typesafe/eval/run.ts --cwd /Users/otto/workspace/mgzl-claude-code-plugin`
Expected: `total=30` / `with_skill=20` / `without_skill=10` と 2 つの誤り率、帯ごとの行、不一致の一覧が出る。キーが手元に無い場合はこの手順を飛ばし、README の「評価の実行」に未実施であることを書かない（実行自体は利用者の手元で行う想定）。

- [ ] **Step 7: コミットする**

```bash
git add typesafe/eval/golden.json typesafe/eval/run.ts typesafe/eval/run.test.ts
```

```bash
git commit -m "feat: typesafeプラグインの評価スクリプトとゴールデンセットを追加"
```

---

### Task 8: README

**Files:**
- Create: `typesafe/README.md`

**Interfaces:**
- Consumes: Task 1〜7 のすべて（環境変数名、ログの形式、評価スクリプトの引数、テストコマンド）
- Produces: なし（最終タスク）

このタスクは文書なのでテストを書かず、全体のテスト通過と内容チェックで検証する。

- [ ] **Step 1: README を書く**

`typesafe/README.md`:

````markdown
# typesafe

`UserPromptSubmit` フックで TypeSafe の System One モデル Jev にスキル選択を問い合わせ、そのターンに関係するスキル 1 件を提案として注入するプラグインである。

## 何をするか

ユーザーが 1 ターン送るたびに、次の 2 リクエストを Jev に投げる。

1. Call 1: roster 全件を description だけで浅く読む Choice 1 問と、「そもそもスキルが要るターンか」を測る Noul 3 問（`gate::acts_on_user_system` / `gate::would_follow_documented_procedure` / `gate::prose_suffices`）。3 問の平均が `0.30` 未満ならここで打ち切る。
2. Call 2: Call 1 の上位 3 件だけを、description 全文 + SKILL.md 冒頭 700 文字で深く読む Choice 1 問と、候補ごとの `fits::<name>` Noul。`fits` の最大値が `0.30` 未満なら提案しない。

結果は `additionalContext` として 1 ブロックだけ注入する。roster 本文には手を加えない。

提案あり:

```
<skill_relevance>Relevant to the current request: mgzl:commiting-to-git. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>
```

提案なし:

```
<skill_relevance>No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.</skill_relevance>
```

提案は「合わなければ無視してよい」文面に留めてある。強く押すと誤った提案にも従ってしまい、誤った提案は提案なしより悪いためである。提案が無いターンでも「該当なし」の 1 文を送る。何も送らないと、スキル一覧側の「迷ったら読み込め」という指示が野放しになる。

## 環境変数

- `TYPESAFE_API_KEY`（必須）: 未設定ならフックは何も出力せず終了する。機能を無効化したいときはこれを設定しない
- `TYPESAFE_BASE_URL`（任意、既定 `https://api.typesafe.ai`）
- `TYPESAFE_SKILL_MODEL`（任意、既定 `jev-latest`）
- `CLAUDE_PLUGIN_DATA`（任意）: 提案ログの出力先。未設定ならログを書かない

## roster の発見ルール

候補スキルはフック実行時に毎回ファイルシステムから発見する。キャッシュも手書きの一覧も持たない。

1. `enabledPlugins` を `~/.claude/settings.json` → `<cwd>/.claude/settings.json` → `<cwd>/.claude/settings.local.json` の順に読み、後勝ちでマージする（`false` は無効化）
2. 有効なキー `<plugin>@<marketplace>` ごとに `~/.claude/plugins/installed_plugins.json` の `plugins[key]` を引き、`scope === "user"` または `projectPath === <cwd>` の先頭エントリの `installPath` を採用する
3. `installPath/skills/*/SKILL.md` を `<plugin>:<name>` として、`~/.claude/skills/*/SKILL.md` と `<cwd>/.claude/skills/*/SKILL.md` をプレフィックスなしで集める。`name` はフロントマターの `name`、無ければディレクトリ名
4. フロントマターに `description` が無いもの、`disable-model-invocation: true` のものは除外する
5. 同名は先に見つかったものを残す。255 件を超えたら先頭 255 件で打ち切り、stderr に警告を出す

フロントマターの解析は外部依存なしの簡易パーサで、`---` で囲まれた先頭ブロックを行単位で `key: value` として読む。`name` / `description` / `disable-model-invocation` だけを見る。

### 既知の制約

- ディスクに無い組み込みスキル（code-review、simplify 等）は roster に入らない
- `enabledPlugins` と `installed_plugins.json` の解決は Claude Code の内部仕様の再現であり、仕様変更で発見漏れが起きうる
- 依頼文はターンごとに TypeSafe の API に送信される。機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を設定しないことで無効化できる
- Jev は指示を字義通りに読み、state 内の敵対的な文に引きずられうる。提案は「無視してよい」文面に留め、自動実行には使わない

## フェイルオープンと性能

キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで、stdout に何も出さず exit 0 で終わる。1 コールのタイムアウトは 3 秒、2 コール合計で最悪 6 秒で、`hooks.json` の `timeout` 10 秒はその外側の保険である。通常時は bun 起動 + 数十ファイルの読み込み + 2 コール（各 0.1〜0.3 秒）で 1 秒未満を見込む。

## ログ

`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions.jsonl` に 1 行 1 JSON で追記する。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`prompt`（全文）、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`rerankConfidence`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。

`prompt` はそのまま `eval/golden.json` の `request` に転記できる。

## 評価

```
bun run typesafe/eval/run.ts --cwd <project> [--golden <path>] [--concurrency 4]
```

フックと同じ `roster.discover` と `pipeline.suggest` を使う。出力は key=value の簡素形式で、次を出す。

- `total` / `with_skill` / `without_skill`
- `wrong_suggestion_rate`: 該当ありのうち `winner !== expected` の割合（`winner === null` も誤り）
- `unneeded_suggestion_rate`: 該当なしのうち `winner !== null` の割合
- `band=<下限>-<上限> count=<件数> accuracy=<正解率>`: 勝者の `fits` を 0.1 刻みにした帯ごとの件数と正解率
- `mismatch request="<先頭 60 文字>" expected=… winner=… gate=… fits=…`: 不一致ケースの一覧

`golden.json` は該当あり 20 件・該当なし 10 件の手書き 30 件から始める。該当なしには「日常的な依頼」「技術的だがスキル不要な質問」「roster に無い対象の名指し」を必ず含める。後者は当てずっぽうを罰するために重要である。

### 閾値を調整する手順

1. `bun run typesafe/eval/run.ts --cwd <project>` を実行し、2 つの誤り率を記録する
2. `band=` の行を見る。帯ごとに `accuracy` が変わらなければ、このタスクでは閾値運用が成立しない。その場合は `FITS_THRESHOLD` をいじらず、提案として出すところまでに留める
3. 帯ごとに差があるなら、`hooks/lib/pipeline.ts` の `GATE_THRESHOLD` / `FITS_THRESHOLD` / `SHORTLIST` / `EXCERPT_CHARS` を 1 つずつ変えて 1 と 2 を繰り返す
4. `mismatch` の行を読み、誤りが「gate で落ちた」のか「ショートリストに入らなかった」のか「rerank で負けた」のかを切り分ける。`gate` の値が低いなら `GATE_THRESHOLD`、`fits` が低いなら description の書き方を疑う
5. 改善だけでなく破壊（提案のせいで誤ったケース）も数える。ネットで得かを必ず両方向から見る

## テスト

Run: `bun test --cwd typesafe`
````

- [ ] **Step 2: 全体のテストを実行して通過を確認する**

Run: `bun test --cwd typesafe`
Expected: PASS（Task 1〜7 のテストすべて）

- [ ] **Step 3: README の内容を確認する**

README に次がすべて書かれていることを確認する。

- 何をするフックか、注入される文面の例（提案あり・提案なしの両方）
- 環境変数 4 つ（`TYPESAFE_API_KEY` / `TYPESAFE_BASE_URL` / `TYPESAFE_SKILL_MODEL` / `CLAUDE_PLUGIN_DATA`）
- roster の発見ルール 5 項目と既知の制約 4 項目
- ログの場所と全フィールド
- 評価スクリプトの使い方と閾値調整の手順
- テストの実行方法

- [ ] **Step 4: コミットする**

```bash
git add typesafe/README.md
```

```bash
git commit -m "docs: typesafeプラグインのREADMEを追加"
```

---

## Self-Review

1. 仕様カバレッジ: 全 14 節を照合し、1〜3 節は Task 1、4 節は Task 1、5 節は Task 6、6 節は Task 3、7 節は Task 2、8 節は Task 4、9 節は Task 5、10 節は Task 7、11 節は各タスクのテスト手順、12 節は Task 6 のフェイルオープン経路と Task 8 の README、13〜14 節は Task 8 に対応することを確認した。仕様の 11 節にない `log.test.ts` と `manifest.test.ts` は、各タスクを TDD で閉じるために追加した（不足の補いであり欠落ではない）。
2. プレースホルダ: 「TBD」「適切なエラー処理」「Task N と同様」等の記述が無いことを確認した。当初 Task 1 と Task 8 にテストコードの無いステップがあったため、Task 1 にはマニフェスト整合テストを追加し、Task 8 は文書タスクである旨とテストの代わりに全体テスト実行と内容チェックで検証することを明記した。
3. 型整合: `discover(cwd, options?)` / `suggest(prompt, roster, options)` / `askSystemOne(state, questions, options)` / `append(record, dataDir?)` / `buildReport(rows)` / `parseArgs(argv)` の名前と引数が定義元と利用箇所で一致することを確認した。`SuggestResult.shortlist` の要素名（`wideProbability` / `rerankProbability` / `fits`）が Task 4・Task 5・Task 7 で揃っていなかった（Task 7 で `probability` と書いていた）ため `ShortlistItem` の定義に合わせて修正し、`Outcome` にログ専用の `skipped` / `error` を混ぜていた箇所を `LogOutcome` へ分離した。あわせて `eval/run.ts` で `discover` を 2 回呼んでいた重複を `runAll` の戻り値 `{ rows, rosterSize }` に畳んだ。
