# fading-memory プラグイン実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セッションから自動抽出され、参照されなければ朽ちる memory 機能を提供する Claude Code プラグイン fading-memory を実装する。

**Architecture:** 正データは各記憶データの Markdown（frontmatter 付き）のみに置き、目次・state はスクリプトが再生成できる派生物とする。SessionStart フックが「期限切れ削除 → 目次生成 → コンテキスト注入」、SessionEnd フックがデタッチしたワーカー経由で軽量モデルの headless 呼び出しを行い「記憶抽出 + 役立ち判定」を反映する。再構成は手動スキル `/fading-memory:maintain` のみ（初版）。

**Tech Stack:** TypeScript + bun（外部依存なし。frontmatter は自前の最小パーサ）。テストは `bun test`。

**Spec:** `docs/superpowers/specs/2026-08-26-fading-memory-design.md`

## Global Constraints

- スクリプトは TypeScript + bun。`.ts` の実行は必ず `bun run` を使う
- `plugin.json` に `version` フィールドを追加しない
- TypeScript で `!` / `as` / `any` を使わない（使う場合は理由コメント必須）。tsconfig は strict + `noUncheckedIndexedAccess` 有効
- コメントは「コードから読み取れない実装の理由」のみ書く
- 定数の正: 基本TTL=30日、スコア単価=7日、上限=120日、trash保持=30日、headless モデル=sonnet（すべて `fading-memory/hooks/lib/config.ts` に集約）
- データ配置の正: `~/.claude/fading-memory/<プロジェクトスラッグ>/`（スラッグはプロジェクト絶対パスの `/` と `.` を `-` に置換）
- フックは絶対にセッションを壊さない: エラーは `error.log` に記録して正常終了する
- 環境変数 `FADING_MEMORY_WORKER=1` が立っているセッションでは両フックとも何もしない（headless 抽出セッションの無限連鎖防止）
- コミットは Conventional Commits 形式・日本語1行
- テスト実行はリポジトリルートで `bun test fading-memory` を使う

## ファイル構成（最終形）

```
fading-memory/
├── .claude-plugin/plugin.json          # プラグインメタデータ
├── README.md                           # 概要（1画面程度）
├── hooks/
│   ├── hooks.json                      # SessionStart / SessionEnd の結線
│   ├── session-start.ts                # エントリ: 掃除 → 目次 → 注入
│   ├── session-end.ts                  # エントリ: ワーカーをデタッチ起動
│   ├── session-end-worker.ts           # headless 呼び出しと結果反映
│   └── lib/
│       ├── config.ts                   # 動作定数
│       ├── paths.ts                    # データディレクトリのパス導出
│       ├── frontmatter.ts              # 記憶データの parse / serialize
│       ├── expiry.ts                   # 有効期限計算（B' 式）
│       ├── maintenance.ts              # 読み込み・期限切れ移動・trash 掃除
│       ├── index-gen.ts                # 目次の並び順とレンダリング
│       ├── extraction.ts               # 抽出結果 JSON の検証・反映・プロンプト
│       ├── log.ts                      # error.log への追記
│       └── *.test.ts                   # 各モジュールのユニットテスト
└── skills/
    └── maintain/
        ├── SKILL.md                    # 再構成スキル
        └── scripts/
            ├── list-memories.ts        # 検証優先順で記憶を一覧
            ├── trash-memory.ts         # 指定 slug を trash へ移動
            └── finalize.ts             # 目次再生成 + state.json 更新
```

---

### Task 1: プラグイン骨格と paths / config

**Files:**
- Create: `fading-memory/.claude-plugin/plugin.json`
- Create: `fading-memory/README.md`
- Create: `fading-memory/hooks/lib/config.ts`
- Create: `fading-memory/hooks/lib/paths.ts`
- Modify: `.claude-plugin/marketplace.json`
- Test: `fading-memory/hooks/lib/paths.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `config: { baseTtlDays: 30; perScoreDays: 7; maxExtensionDays: 120; trashRetentionDays: 30; headlessModel: "sonnet" }`
  - `projectSlug(projectDir: string): string`
  - `dataPaths(projectDir: string, home?: string): DataPaths`
  - `interface DataPaths { root: string; memoriesDir: string; trashDir: string; indexFile: string; stateFile: string; errorLog: string }`

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/paths.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { dataPaths, projectSlug } from "./paths.ts";

describe("projectSlug", () => {
  test("パス区切りとドットを - に置換する", () => {
    expect(projectSlug("/Users/otto/work.space/foo")).toBe("-Users-otto-work-space-foo");
  });
});

describe("dataPaths", () => {
  test("home 配下の .claude/fading-memory/<slug>/ を指す", () => {
    const p = dataPaths("/proj/a", "/home/u");
    expect(p.root).toBe("/home/u/.claude/fading-memory/-proj-a");
    expect(p.memoriesDir).toBe("/home/u/.claude/fading-memory/-proj-a/memories");
    expect(p.trashDir).toBe("/home/u/.claude/fading-memory/-proj-a/trash");
    expect(p.indexFile).toBe("/home/u/.claude/fading-memory/-proj-a/INDEX.md");
    expect(p.stateFile).toBe("/home/u/.claude/fading-memory/-proj-a/state.json");
    expect(p.errorLog).toBe("/home/u/.claude/fading-memory/-proj-a/error.log");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`paths.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/config.ts`:

```ts
/** fading-memory の動作定数。寿命計算・trash 保持・headless モデルをここに集約する */
export const config = {
  baseTtlDays: 30,
  perScoreDays: 7,
  maxExtensionDays: 120,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
} as const;
// as const は定数オブジェクトのリテラル型固定のためで、型の偽装ではない

export type FadingMemoryConfig = typeof config;
```

`fading-memory/hooks/lib/paths.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/** 記憶データ一式が置かれるディレクトリ群 */
export interface DataPaths {
  root: string;
  memoriesDir: string;
  trashDir: string;
  indexFile: string;
  stateFile: string;
  errorLog: string;
}

/** プロジェクト絶対パスからデータディレクトリ名を導出する（組み込み memory と同じ置換規則） */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[/.]/g, "-");
}

export function dataPaths(projectDir: string, home: string = homedir()): DataPaths {
  const root = join(home, ".claude", "fading-memory", projectSlug(projectDir));
  return {
    root,
    memoriesDir: join(root, "memories"),
    trashDir: join(root, "trash"),
    indexFile: join(root, "INDEX.md"),
    stateFile: join(root, "state.json"),
    errorLog: join(root, "error.log"),
  };
}
```

`fading-memory/.claude-plugin/plugin.json`:

```json
{
  "name": "fading-memory",
  "description": "セッションから自動で記憶を抽出し、参照されない記憶は有効期限で朽ちていく memory 機能を提供する",
  "author": {
    "name": "otto"
  }
}
```

`fading-memory/README.md`:

```markdown
# fading-memory

セッションから自動で記憶を抽出し、参照されなければ朽ちていく memory 機能を提供するプラグイン。

- 設計書: `docs/superpowers/specs/2026-08-26-fading-memory-design.md`
- データ配置: `~/.claude/fading-memory/<プロジェクトスラッグ>/`
- SessionStart: 期限切れ削除 → 目次生成 → コンテキスト注入
- SessionEnd: 軽量モデルで記憶抽出 + 役立ち判定（バックグラウンド）
- `/fading-memory:maintain`: 記憶の再構成（手動）
```

`.claude-plugin/marketplace.json` の `plugins` 配列末尾に追記:

```json
    {
      "name": "fading-memory",
      "source": "./fading-memory",
      "description": "セッションから自動で記憶を抽出し、参照されない記憶は有効期限で朽ちていく memory 機能を提供する"
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory .claude-plugin/marketplace.json
git commit -m "feat: fading-memoryプラグインの骨格とパス導出を追加"
```

---

### Task 2: frontmatter の parse / serialize

**Files:**
- Create: `fading-memory/hooks/lib/frontmatter.ts`
- Test: `fading-memory/hooks/lib/frontmatter.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface MemoryMeta { title: string; created: string; updated: string; lastReferenced: string | null; score: number; permanent: boolean; related: string[] }`
  - `interface MemoryDoc { meta: MemoryMeta; body: string }`
  - `parseMemory(text: string): MemoryDoc | null`（不正な入力は null）
  - `serializeMemory(doc: MemoryDoc): string`

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/frontmatter.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseMemory, serializeMemory, type MemoryDoc } from "./frontmatter.ts";

const doc: MemoryDoc = {
  meta: {
    title: "API クライアントの再試行規約: 3回まで",
    created: "2026-08-26T10:00:00.000Z",
    updated: "2026-08-26T10:00:00.000Z",
    lastReferenced: null,
    score: 0,
    permanent: false,
    related: ["other-slug", "another"],
  },
  body: "本文1行目\n\n本文3行目",
};

describe("serializeMemory / parseMemory", () => {
  test("ラウンドトリップで内容が保存される", () => {
    expect(parseMemory(serializeMemory(doc))).toEqual(doc);
  });

  test("lastReferenced と related が空でも往復できる", () => {
    const d: MemoryDoc = {
      meta: { ...doc.meta, lastReferenced: "2026-09-01T00:00:00.000Z", related: [] },
      body: "x",
    };
    expect(parseMemory(serializeMemory(d))).toEqual(d);
  });

  test("frontmatter が無いテキストは null", () => {
    expect(parseMemory("ただの本文")).toBeNull();
  });

  test("閉じ --- が無いテキストは null", () => {
    expect(parseMemory("---\ntitle: x\n本文")).toBeNull();
  });

  test("必須キー欠落は null", () => {
    expect(parseMemory("---\ntitle: x\n---\n本文")).toBeNull();
  });

  test("score が数値でない場合は null", () => {
    const broken = serializeMemory(doc).replace("score: 0", "score: abc");
    expect(parseMemory(broken)).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`frontmatter.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/frontmatter.ts`:

```ts
/** 記憶データの frontmatter。正データはこの構造の .md ファイルのみ */
export interface MemoryMeta {
  title: string;
  created: string;
  updated: string;
  lastReferenced: string | null;
  score: number;
  permanent: boolean;
  related: string[];
}

export interface MemoryDoc {
  meta: MemoryMeta;
  body: string;
}

// 外部依存を持たないため YAML 全般ではなく本プラグインが書く形式だけを解釈する
function parseRelated(value: string): string[] | null {
  const m = value.match(/^\[(.*)\]$/);
  if (m === null || m[1] === undefined) return null;
  if (m[1].trim() === "") return [];
  return m[1].split(",").map((s) => s.trim());
}

export function parseMemory(text: string): MemoryDoc | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const head = text.slice(4, end);
  const body = text.slice(end + 5).replace(/^\n/, "").trimEnd();

  const raw: Record<string, string> = {};
  for (const line of head.split("\n")) {
    if (line.trim() === "") continue;
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (m === null || m[1] === undefined || m[2] === undefined) return null;
    raw[m[1]] = m[2];
  }

  const title = raw["title"];
  const created = raw["created"];
  const updated = raw["updated"];
  if (title === undefined || created === undefined || updated === undefined) return null;

  const score = Number(raw["score"] ?? "0");
  if (!Number.isFinite(score)) return null;

  const related = parseRelated(raw["related"] ?? "[]");
  if (related === null) return null;

  const lastRefRaw = raw["lastReferenced"];
  const lastReferenced = lastRefRaw === undefined || lastRefRaw === "null" ? null : lastRefRaw;

  return {
    meta: {
      title,
      created,
      updated,
      lastReferenced,
      score,
      permanent: raw["permanent"] === "true",
      related,
    },
    body,
  };
}

export function serializeMemory(doc: MemoryDoc): string {
  const m = doc.meta;
  return [
    "---",
    `title: ${m.title}`,
    `created: ${m.created}`,
    `updated: ${m.updated}`,
    `lastReferenced: ${m.lastReferenced ?? "null"}`,
    `score: ${m.score}`,
    `permanent: ${m.permanent}`,
    `related: [${m.related.join(", ")}]`,
    "---",
    "",
    doc.body.trimEnd(),
    "",
  ].join("\n");
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/hooks/lib/frontmatter.ts fading-memory/hooks/lib/frontmatter.test.ts
git commit -m "feat: 記憶データのfrontmatterパーサとシリアライザを追加"
```

---

### Task 3: 有効期限計算（B' 式）

**Files:**
- Create: `fading-memory/hooks/lib/expiry.ts`
- Test: `fading-memory/hooks/lib/expiry.test.ts`

**Interfaces:**
- Consumes: `MemoryMeta`（Task 2）、`config`（Task 1）
- Produces: `expiresAt(meta: MemoryMeta, cfg?: FadingMemoryConfig): number`（epoch ミリ秒。permanent は Infinity）

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/expiry.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { expiresAt } from "./expiry.ts";
import type { MemoryMeta } from "./frontmatter.ts";

const DAY = 24 * 60 * 60 * 1000;
const CREATED = "2026-01-01T00:00:00.000Z";
const createdMs = Date.parse(CREATED);

function meta(over: Partial<MemoryMeta>): MemoryMeta {
  return {
    title: "t",
    created: CREATED,
    updated: CREATED,
    lastReferenced: null,
    score: 0,
    permanent: false,
    related: [],
    ...over,
  };
}

describe("expiresAt", () => {
  test("score 0 は created + 基本TTL 30日", () => {
    expect(expiresAt(meta({}))).toBe(createdMs + 30 * DAY);
  });

  test("score 1 につき 7 日延長される", () => {
    expect(expiresAt(meta({ score: 3 }))).toBe(createdMs + (30 + 21) * DAY);
  });

  test("延長は上限 120 日で頭打ちになる", () => {
    expect(expiresAt(meta({ score: 100 }))).toBe(createdMs + 120 * DAY);
  });

  test("最終参照日 + 基本TTL が下限として効く", () => {
    const lastRef = new Date(createdMs + 200 * DAY).toISOString();
    expect(expiresAt(meta({ score: 100, lastReferenced: lastRef }))).toBe(
      createdMs + (200 + 30) * DAY,
    );
  });

  test("permanent は Infinity", () => {
    expect(expiresAt(meta({ permanent: true }))).toBe(Infinity);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`expiry.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/expiry.ts`:

```ts
import { config, type FadingMemoryConfig } from "./config.ts";
import type { MemoryMeta } from "./frontmatter.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 記憶データの有効期限（epoch ミリ秒）。
 * スコア線形延長（上限付き）と「直近参照 + 基本TTL」下限の max を取る B' 式。
 * 期限はファイルに保存せず、常にここで計算する（二重管理の防止）。
 */
export function expiresAt(meta: MemoryMeta, cfg: FadingMemoryConfig = config): number {
  if (meta.permanent) return Infinity;
  const created = Date.parse(meta.created);
  const lastRef = meta.lastReferenced === null ? created : Date.parse(meta.lastReferenced);
  const extensionDays = Math.min(
    cfg.baseTtlDays + meta.score * cfg.perScoreDays,
    cfg.maxExtensionDays,
  );
  return Math.max(created + extensionDays * DAY_MS, lastRef + cfg.baseTtlDays * DAY_MS);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/hooks/lib/expiry.ts fading-memory/hooks/lib/expiry.test.ts
git commit -m "feat: 有効期限計算を追加"
```

---

### Task 4: ストア操作（読み込み・期限切れ移動・trash 掃除）

**Files:**
- Create: `fading-memory/hooks/lib/maintenance.ts`
- Test: `fading-memory/hooks/lib/maintenance.test.ts`

**Interfaces:**
- Consumes: `DataPaths`（Task 1）、`parseMemory`（Task 2）、`expiresAt`（Task 3）
- Produces:
  - `interface LoadedMemory { slug: string; file: string; meta: MemoryMeta; body: string }`
  - `ensureDirs(paths: DataPaths): void`
  - `loadMemories(paths: DataPaths): { memories: LoadedMemory[]; malformed: string[] }`
  - `moveToTrash(paths: DataPaths, slug: string, now: number): void`（trash 内は `<epoch>__<slug>.md`）
  - `expireMemories(paths: DataPaths, now: number): string[]`（移動した slug を返す）
  - `purgeTrash(paths: DataPaths, now: number): string[]`（完全削除したファイル名を返す）

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/maintenance.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeMemory } from "./frontmatter.ts";
import { ensureDirs, expireMemories, loadMemories, purgeTrash } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-26T00:00:00.000Z");

function setup() {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  const paths = dataPaths("/proj", home);
  ensureDirs(paths);
  return paths;
}

function writeMemory(dir: string, slug: string, createdMs: number, permanent = false) {
  const iso = new Date(createdMs).toISOString();
  writeFileSync(
    join(dir, `${slug}.md`),
    serializeMemory({
      meta: {
        title: slug,
        created: iso,
        updated: iso,
        lastReferenced: null,
        score: 0,
        permanent,
        related: [],
      },
      body: "b",
    }),
  );
}

describe("loadMemories", () => {
  test("正常なファイルと不正なファイルを分けて返す", () => {
    const paths = setup();
    writeMemory(paths.memoriesDir, "good", NOW);
    writeFileSync(join(paths.memoriesDir, "bad.md"), "frontmatter なし");
    const { memories, malformed } = loadMemories(paths);
    expect(memories.map((m) => m.slug)).toEqual(["good"]);
    expect(malformed).toEqual(["bad.md"]);
  });
});

describe("expireMemories", () => {
  test("期限切れだけを trash へ移動する", () => {
    const paths = setup();
    writeMemory(paths.memoriesDir, "old", NOW - 31 * DAY);
    writeMemory(paths.memoriesDir, "fresh", NOW - 1 * DAY);
    writeMemory(paths.memoriesDir, "keep", NOW - 400 * DAY, true);
    expect(expireMemories(paths, NOW)).toEqual(["old"]);
    expect(loadMemories(paths).memories.map((m) => m.slug).sort()).toEqual(["fresh", "keep"]);
    expect(existsSync(join(paths.trashDir, `${NOW}__old.md`))).toBe(true);
  });
});

describe("purgeTrash", () => {
  test("保持期間を過ぎたファイルだけ完全削除する", () => {
    const paths = setup();
    writeFileSync(join(paths.trashDir, `${NOW - 31 * DAY}__a.md`), "x");
    writeFileSync(join(paths.trashDir, `${NOW - 1 * DAY}__b.md`), "x");
    writeFileSync(join(paths.trashDir, "manual.md"), "x");
    expect(purgeTrash(paths, NOW)).toEqual([`${NOW - 31 * DAY}__a.md`]);
    expect(readdirSync(paths.trashDir).sort()).toEqual([`${NOW - 1 * DAY}__b.md`, "manual.md"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`maintenance.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/maintenance.ts`:

```ts
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { expiresAt } from "./expiry.ts";
import { parseMemory, type MemoryMeta } from "./frontmatter.ts";
import type { DataPaths } from "./paths.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** データディレクトリから読み込まれた記憶データ1件 */
export interface LoadedMemory {
  slug: string;
  file: string;
  meta: MemoryMeta;
  body: string;
}

export function ensureDirs(paths: DataPaths): void {
  mkdirSync(paths.memoriesDir, { recursive: true });
  mkdirSync(paths.trashDir, { recursive: true });
}

/** 解析できないファイルは削除せず malformed として報告だけする（誤削除の防止） */
export function loadMemories(paths: DataPaths): {
  memories: LoadedMemory[];
  malformed: string[];
} {
  const memories: LoadedMemory[] = [];
  const malformed: string[] = [];
  for (const name of readdirSync(paths.memoriesDir).sort()) {
    if (!name.endsWith(".md")) continue;
    const file = join(paths.memoriesDir, name);
    const doc = parseMemory(readFileSync(file, "utf8"));
    if (doc === null) {
      malformed.push(name);
      continue;
    }
    memories.push({ slug: name.slice(0, -3), file, meta: doc.meta, body: doc.body });
  }
  return { memories, malformed };
}

/** trash 内のファイル名に移動時刻を埋め込み、保持期間の判定に使う */
export function moveToTrash(paths: DataPaths, slug: string, now: number): void {
  renameSync(join(paths.memoriesDir, `${slug}.md`), join(paths.trashDir, `${now}__${slug}.md`));
}

export function expireMemories(paths: DataPaths, now: number): string[] {
  const expired: string[] = [];
  for (const mem of loadMemories(paths).memories) {
    if (expiresAt(mem.meta) <= now) {
      moveToTrash(paths, mem.slug, now);
      expired.push(mem.slug);
    }
  }
  return expired;
}

/** 時刻プレフィックスの無いファイル（手動で置かれたもの）は削除対象にしない */
export function purgeTrash(paths: DataPaths, now: number): string[] {
  const purged: string[] = [];
  const limitMs = config.trashRetentionDays * DAY_MS;
  for (const name of readdirSync(paths.trashDir)) {
    const m = name.match(/^(\d+)__/);
    if (m === null || m[1] === undefined) continue;
    if (now - Number(m[1]) > limitMs) {
      unlinkSync(join(paths.trashDir, name));
      purged.push(name);
    }
  }
  return purged;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/hooks/lib/maintenance.ts fading-memory/hooks/lib/maintenance.test.ts
git commit -m "feat: 記憶データの読み込みと期限切れ移動とtrash掃除を追加"
```

---

### Task 5: 目次の生成

**Files:**
- Create: `fading-memory/hooks/lib/index-gen.ts`
- Test: `fading-memory/hooks/lib/index-gen.test.ts`

**Interfaces:**
- Consumes: `LoadedMemory`（Task 4）、`expiresAt`（Task 3）
- Produces:
  - `sortForIndex(memories: LoadedMemory[]): LoadedMemory[]`（有効期限の降順。permanent = Infinity が自然に先頭）
  - `renderIndex(memories: LoadedMemory[]): string`（INDEX.md の全文）

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/index-gen.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MemoryMeta } from "./frontmatter.ts";
import { renderIndex, sortForIndex } from "./index-gen.ts";
import type { LoadedMemory } from "./maintenance.ts";

function mem(slug: string, over: Partial<MemoryMeta>): LoadedMemory {
  return {
    slug,
    file: `/x/${slug}.md`,
    body: "b",
    meta: {
      title: `title of ${slug}`,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      lastReferenced: null,
      score: 0,
      permanent: false,
      related: [],
      ...over,
    },
  };
}

describe("sortForIndex", () => {
  test("permanent が先頭、以降は有効期限の降順", () => {
    const list = [mem("low", {}), mem("keep", { permanent: true }), mem("high", { score: 5 })];
    expect(sortForIndex(list).map((m) => m.slug)).toEqual(["keep", "high", "low"]);
  });
});

describe("renderIndex", () => {
  test("タイトルと相対パスのリストを出力する", () => {
    const text = renderIndex([mem("a", {})]);
    expect(text).toContain("- [title of a](memories/a.md)");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`index-gen.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/index-gen.ts`:

```ts
import { expiresAt } from "./expiry.ts";
import type { LoadedMemory } from "./maintenance.ts";

/** 目次の並び順: 有効期限の降順（= 重要度順）。permanent は Infinity なので自然に先頭に来る */
export function sortForIndex(memories: LoadedMemory[]): LoadedMemory[] {
  return [...memories].sort((a, b) => {
    const ea = expiresAt(a.meta);
    const eb = expiresAt(b.meta);
    if (ea === eb) return a.slug.localeCompare(b.slug);
    return eb - ea;
  });
}

export function renderIndex(memories: LoadedMemory[]): string {
  const lines = sortForIndex(memories).map(
    (m) => `- [${m.meta.title}](memories/${m.slug}.md)`,
  );
  return ["# fading-memory 目次", "", ...lines, ""].join("\n");
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/hooks/lib/index-gen.ts fading-memory/hooks/lib/index-gen.test.ts
git commit -m "feat: 目次の並び順とレンダリングを追加"
```

---

### Task 6: SessionStart フック

**Files:**
- Create: `fading-memory/hooks/lib/log.ts`
- Create: `fading-memory/hooks/session-start.ts`
- Create: `fading-memory/hooks/hooks.json`

**Interfaces:**
- Consumes: Task 1〜5 の全モジュール
- Produces:
  - `appendError(paths: DataPaths, message: string): void`
  - stdin: フック入力 JSON（`cwd` を使用）
  - stdout: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`（記憶が1件以上あるときのみ）

- [ ] **Step 1: log.ts を実装する**

`fading-memory/hooks/lib/log.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DataPaths } from "./paths.ts";

/** フックは失敗してもセッションを壊せないため、例外はここに記録して握りつぶす前提 */
export function appendError(paths: DataPaths, message: string): void {
  mkdirSync(dirname(paths.errorLog), { recursive: true });
  appendFileSync(paths.errorLog, `${new Date().toISOString()} ${message}\n`);
}
```

- [ ] **Step 2: session-start.ts を実装する**

`fading-memory/hooks/session-start.ts`:

```ts
import { writeFileSync } from "node:fs";
import { renderIndex } from "./lib/index-gen.ts";
import { appendError } from "./lib/log.ts";
import {
  ensureDirs,
  expireMemories,
  loadMemories,
  purgeTrash,
} from "./lib/maintenance.ts";
import { dataPaths } from "./lib/paths.ts";

function resolveProjectDir(input: unknown): string {
  if (typeof input === "object" && input !== null && "cwd" in input) {
    const cwd = (input as { cwd: unknown }).cwd;
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof cwd === "string") return cwd;
  }
  return process.cwd();
}

async function main(): Promise<void> {
  // headless 抽出セッションで自分のフックが再帰的に動くのを防ぐ
  if (process.env["FADING_MEMORY_WORKER"] === "1") return;

  const input: unknown = JSON.parse(await Bun.stdin.text());
  const projectDir = resolveProjectDir(input);
  const paths = dataPaths(projectDir);

  try {
    ensureDirs(paths);
    const now = Date.now();
    purgeTrash(paths, now);
    expireMemories(paths, now);

    const { memories, malformed } = loadMemories(paths);
    if (malformed.length > 0) {
      appendError(paths, `frontmatter を解析できないため除外: ${malformed.join(", ")}`);
    }

    const index = renderIndex(memories);
    writeFileSync(paths.indexFile, index);

    if (memories.length > 0) {
      const context = [
        "# fading-memory（プロジェクト記憶）",
        "過去のセッションから自動抽出された記憶の目次である。",
        `作業に関連しそうな項目があれば ${paths.memoriesDir}/<slug>.md を Read して活用すること。`,
        "",
        index,
      ].join("\n");
      console.log(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
        }),
      );
    }
  } catch (e) {
    try {
      appendError(paths, `session-start: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合も、セッションを壊さないことを優先して無視する
    }
  }
}

await main();
```

- [ ] **Step 3: hooks.json を作成する**

`fading-memory/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ts\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: 手動で動作確認する**

Run: `echo '{"cwd":"/tmp/claude/fading-e2e"}' | bun run fading-memory/hooks/session-start.ts`
Expected: 記憶が無いので stdout は空。`~/.claude/fading-memory/-tmp-claude-fading-e2e/INDEX.md` が生成される

続けて記憶を1件手で置いてから再実行:

Run: 上記データディレクトリの `memories/test-memory.md` に Task 2 の形式のファイルを作成（created は現在日時の ISO 文字列）し、同じコマンドを再実行
Expected: stdout に `additionalContext` を含む JSON が1行出力され、その中に `- [` で始まる目次行が含まれる

- [ ] **Step 5: 既存テストがすべて通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add fading-memory/hooks/session-start.ts fading-memory/hooks/hooks.json fading-memory/hooks/lib/log.ts
git commit -m "feat: SessionStartフックで期限切れ削除と目次注入を追加"
```

---

### Task 7: 抽出結果の検証と反映

**Files:**
- Create: `fading-memory/hooks/lib/extraction.ts`
- Test: `fading-memory/hooks/lib/extraction.test.ts`

**Interfaces:**
- Consumes: `DataPaths`（Task 1）、`parseMemory` / `serializeMemory`（Task 2）、`loadMemories`（Task 4）
- Produces:
  - `interface ExtractionResult { newMemories: { slug: string; title: string; body: string; related?: string[] }[]; updatedMemories: { slug: string; body: string; related?: string[] }[]; usefulMemorySlugs: string[] }`
  - `stripCodeFence(text: string): string`
  - `parseExtractionResult(text: string): ExtractionResult | null`（不正 JSON・不正 slug は null）
  - `applyExtraction(paths: DataPaths, result: ExtractionResult, nowIso: string): ApplyReport`
  - `interface ApplyReport { created: string[]; updated: string[]; scored: string[]; skipped: string[] }`
  - `buildExtractionPrompt(transcriptPath: string, catalog: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`fading-memory/hooks/lib/extraction.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyExtraction,
  parseExtractionResult,
  stripCodeFence,
} from "./extraction.ts";
import { parseMemory, serializeMemory } from "./frontmatter.ts";
import { ensureDirs } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";

const NOW_ISO = "2026-08-26T12:00:00.000Z";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "fading-"));
  const paths = dataPaths("/proj", home);
  ensureDirs(paths);
  writeFileSync(
    join(paths.memoriesDir, "foo.md"),
    serializeMemory({
      meta: {
        title: "foo",
        created: "2026-08-01T00:00:00.000Z",
        updated: "2026-08-01T00:00:00.000Z",
        lastReferenced: null,
        score: 0,
        permanent: false,
        related: [],
      },
      body: "old body",
    }),
  );
  return paths;
}

describe("stripCodeFence", () => {
  test("コードフェンスを剥がす", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseExtractionResult", () => {
  test("正しい JSON を受理する", () => {
    const r = parseExtractionResult(
      '{"newMemories":[{"slug":"new-one","title":"t","body":"b"}],"updatedMemories":[],"usefulMemorySlugs":["foo"]}',
    );
    expect(r?.newMemories[0]?.slug).toBe("new-one");
  });

  test("JSON でないテキストは null", () => {
    expect(parseExtractionResult("すみません、出力できません")).toBeNull();
  });

  test("kebab-case でない slug は null", () => {
    expect(
      parseExtractionResult(
        '{"newMemories":[{"slug":"Bad Slug","title":"t","body":"b"}],"updatedMemories":[],"usefulMemorySlugs":[]}',
      ),
    ).toBeNull();
  });
});

describe("applyExtraction", () => {
  test("新規作成・slug 衝突回避・更新・加点・未知 slug スキップ", () => {
    const paths = setup();
    const report = applyExtraction(
      paths,
      {
        newMemories: [{ slug: "foo", title: "衝突する新規", body: "nb" }],
        updatedMemories: [{ slug: "foo", body: "new body" }],
        usefulMemorySlugs: ["foo", "unknown"],
      },
      NOW_ISO,
    );
    expect(report.created).toEqual(["foo-2"]);
    expect(report.updated).toEqual(["foo"]);
    expect(report.scored).toEqual(["foo"]);
    expect(report.skipped).toEqual(["unknown"]);

    const created = parseMemory(readFileSync(join(paths.memoriesDir, "foo-2.md"), "utf8"));
    expect(created?.meta.created).toBe(NOW_ISO);
    expect(created?.meta.score).toBe(0);

    const updated = parseMemory(readFileSync(join(paths.memoriesDir, "foo.md"), "utf8"));
    expect(updated?.body).toBe("new body");
    expect(updated?.meta.updated).toBe(NOW_ISO);
    expect(updated?.meta.score).toBe(1);
    expect(updated?.meta.lastReferenced).toBe(NOW_ISO);
    expect(updated?.meta.created).toBe("2026-08-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `bun test fading-memory`
Expected: FAIL（`extraction.ts` が存在しない）

- [ ] **Step 3: 実装する**

`fading-memory/hooks/lib/extraction.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemory, serializeMemory } from "./frontmatter.ts";
import { loadMemories } from "./maintenance.ts";
import type { DataPaths } from "./paths.ts";

/** headless 抽出セッションが返すべき JSON の形 */
export interface ExtractionResult {
  newMemories: { slug: string; title: string; body: string; related?: string[] }[];
  updatedMemories: { slug: string; body: string; related?: string[] }[];
  usefulMemorySlugs: string[];
}

export interface ApplyReport {
  created: string[];
  updated: string[];
  scored: string[];
  skipped: string[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function stripCodeFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  const inner = m?.[1];
  return inner === undefined ? text.trim() : inner;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function parseExtractionResult(text: string): ExtractionResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  // as は unknown をキー参照可能にするためだけの絞り込みで、値は個別に検証する

  const news = obj["newMemories"];
  const updates = obj["updatedMemories"];
  const useful = obj["usefulMemorySlugs"];
  if (!Array.isArray(news) || !Array.isArray(updates) || !isStringArray(useful)) return null;

  const newMemories: ExtractionResult["newMemories"] = [];
  for (const n of news) {
    if (typeof n !== "object" || n === null) return null;
    const r = n as Record<string, unknown>;
    // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
    if (
      typeof r["slug"] !== "string" ||
      !SLUG_RE.test(r["slug"]) ||
      typeof r["title"] !== "string" ||
      typeof r["body"] !== "string" ||
      (r["related"] !== undefined && !isStringArray(r["related"]))
    ) {
      return null;
    }
    newMemories.push({
      slug: r["slug"],
      title: r["title"],
      body: r["body"],
      related: isStringArray(r["related"]) ? r["related"] : undefined,
    });
  }

  const updatedMemories: ExtractionResult["updatedMemories"] = [];
  for (const u of updates) {
    if (typeof u !== "object" || u === null) return null;
    const r = u as Record<string, unknown>;
    // as は object 確認済みの unknown をキー参照可能にするためで、値は下で個別に検証する
    if (
      typeof r["slug"] !== "string" ||
      !SLUG_RE.test(r["slug"]) ||
      typeof r["body"] !== "string" ||
      (r["related"] !== undefined && !isStringArray(r["related"]))
    ) {
      return null;
    }
    updatedMemories.push({
      slug: r["slug"],
      body: r["body"],
      related: isStringArray(r["related"]) ? r["related"] : undefined,
    });
  }

  return { newMemories, updatedMemories, usefulMemorySlugs: useful };
}

function uniqueSlug(existing: Set<string>, slug: string): string {
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

export function applyExtraction(
  paths: DataPaths,
  result: ExtractionResult,
  nowIso: string,
): ApplyReport {
  const report: ApplyReport = { created: [], updated: [], scored: [], skipped: [] };
  const existing = new Set(loadMemories(paths).memories.map((m) => m.slug));

  for (const n of result.newMemories) {
    const slug = uniqueSlug(existing, n.slug);
    existing.add(slug);
    writeFileSync(
      join(paths.memoriesDir, `${slug}.md`),
      serializeMemory({
        meta: {
          title: n.title,
          created: nowIso,
          updated: nowIso,
          lastReferenced: null,
          score: 0,
          permanent: false,
          related: n.related ?? [],
        },
        body: n.body,
      }),
    );
    report.created.push(slug);
  }

  for (const u of result.updatedMemories) {
    const file = join(paths.memoriesDir, `${u.slug}.md`);
    const doc = existing.has(u.slug) ? parseMemory(readFileSync(file, "utf8")) : null;
    if (doc === null) {
      report.skipped.push(u.slug);
      continue;
    }
    // 更新だけでは score / lastReferenced を変動させない（仕様）
    doc.body = u.body;
    doc.meta.updated = nowIso;
    if (u.related !== undefined) doc.meta.related = u.related;
    writeFileSync(file, serializeMemory(doc));
    report.updated.push(u.slug);
  }

  for (const slug of result.usefulMemorySlugs) {
    const file = join(paths.memoriesDir, `${slug}.md`);
    const doc = existing.has(slug) ? parseMemory(readFileSync(file, "utf8")) : null;
    if (doc === null) {
      report.skipped.push(slug);
      continue;
    }
    doc.meta.score += 1;
    doc.meta.lastReferenced = nowIso;
    writeFileSync(file, serializeMemory(doc));
    report.scored.push(slug);
  }

  return report;
}

export function buildExtractionPrompt(transcriptPath: string, catalog: string): string {
  return [
    `${transcriptPath} は直前に終了した Claude Code セッションのトランスクリプト（JSONL）である。Read で読み、記憶として保存すべき内容を JSON で出力せよ。`,
    "",
    "## 既存の記憶データ一覧（slug: title）",
    catalog === "" ? "（なし）" : catalog,
    "",
    "## 抽出ルール",
    "- セッションを跨いで再利用可能なナレッジのみを抽出する。一時的な作業情報（今回限りのエラーや途中経過）は含めない",
    "- 既存の記憶と同じ関心の内容は newMemories にせず、updatedMemories として既存 slug の内容を書き直す",
    "- slug は内容を要約した英語の kebab-case にする",
    "- title は「どのケースで役立つ何の情報か」を1行で書く",
    "- permanent の指定は行わない",
    "- usefulMemorySlugs には、このセッション中に実際に内容が読まれ、かつ作業の役に立った既存記憶の slug だけを入れる。読まれただけで役立っていないものは入れない",
    "- 該当が無い配列は空配列にする",
    "",
    "## 出力形式",
    "説明文やコードフェンスを付けず、次の形の JSON のみを出力する:",
    '{"newMemories":[{"slug":"...","title":"...","body":"...","related":[]}],"updatedMemories":[{"slug":"...","body":"...","related":[]}],"usefulMemorySlugs":["..."]}',
  ].join("\n");
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/hooks/lib/extraction.ts fading-memory/hooks/lib/extraction.test.ts
git commit -m "feat: 抽出結果JSONの検証と反映処理を追加"
```

---

### Task 8: SessionEnd フックとワーカー

**Files:**
- Create: `fading-memory/hooks/session-end.ts`
- Create: `fading-memory/hooks/session-end-worker.ts`
- Modify: `fading-memory/hooks/hooks.json`

**Interfaces:**
- Consumes: Task 1〜7 の全モジュール
- Produces:
  - `session-end.ts`: stdin のフック入力から `cwd` / `transcript_path` を取り、ワーカーをデタッチ起動して即終了
  - `session-end-worker.ts`: argv = `[projectDir, transcriptPath]`。headless 呼び出し → `applyExtraction`

- [ ] **Step 1: session-end.ts を実装する**

`fading-memory/hooks/session-end.ts`:

```ts
import { join } from "node:path";
import { appendError } from "./lib/log.ts";
import { ensureDirs } from "./lib/maintenance.ts";
import { dataPaths } from "./lib/paths.ts";

function readString(input: unknown, key: string): string | null {
  if (typeof input === "object" && input !== null && key in input) {
    const v = (input as Record<string, unknown>)[key];
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof v === "string") return v;
  }
  return null;
}

async function main(): Promise<void> {
  // headless 抽出セッションの SessionEnd から再度ワーカーが起動する連鎖を防ぐ
  if (process.env["FADING_MEMORY_WORKER"] === "1") return;

  const input: unknown = JSON.parse(await Bun.stdin.text());
  const projectDir = readString(input, "cwd") ?? process.cwd();
  const transcriptPath = readString(input, "transcript_path");
  if (transcriptPath === null) return;

  const paths = dataPaths(projectDir);
  try {
    ensureDirs(paths);
    // セッション終了をブロックしないため、抽出はデタッチした別プロセスに任せて即終了する
    const logFile = Bun.file(join(paths.root, "session-end.log"));
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        join(import.meta.dir, "session-end-worker.ts"),
        projectDir,
        transcriptPath,
      ],
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "ignore",
      stdout: logFile,
      stderr: logFile,
    });
    proc.unref();
  } catch (e) {
    try {
      appendError(paths, `session-end: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合も、セッションを壊さないことを優先して無視する
    }
  }
}

await main();
```

- [ ] **Step 2: session-end-worker.ts を実装する**

`fading-memory/hooks/session-end-worker.ts`:

```ts
import { config } from "./lib/config.ts";
import {
  applyExtraction,
  buildExtractionPrompt,
  parseExtractionResult,
} from "./lib/extraction.ts";
import { appendError } from "./lib/log.ts";
import { ensureDirs, loadMemories } from "./lib/maintenance.ts";
import { dataPaths } from "./lib/paths.ts";

const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const projectDir = process.argv[2];
  const transcriptPath = process.argv[3];
  if (projectDir === undefined || transcriptPath === undefined) {
    console.error("usage: session-end-worker.ts <projectDir> <transcriptPath>");
    process.exit(1);
  }

  const paths = dataPaths(projectDir);
  ensureDirs(paths);

  try {
    const { memories } = loadMemories(paths);
    const catalog = memories.map((m) => `- ${m.slug}: ${m.meta.title}`).join("\n");
    const prompt = buildExtractionPrompt(transcriptPath, catalog);

    const proc = Bun.spawn({
      cmd: [
        "claude",
        "-p",
        prompt,
        "--model",
        config.headlessModel,
        "--output-format",
        "json",
        "--allowedTools",
        "Read",
      ],
      cwd: projectDir,
      env: { ...process.env, FADING_MEMORY_WORKER: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const killTimer = setTimeout(() => proc.kill(), CLAUDE_TIMEOUT_MS);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(killTimer);

    if (exitCode !== 0) {
      appendError(paths, `worker: claude が exit ${exitCode}: ${stderr.slice(0, 500)}`);
      return;
    }

    // --output-format json は {"result": "<モデルの最終出力>"} 形式のラッパーを返す
    const wrapper: unknown = JSON.parse(stdout);
    const resultText =
      typeof wrapper === "object" && wrapper !== null && "result" in wrapper
        ? (wrapper as { result: unknown }).result
        : null;
    // as は in 演算子で存在確認済みのプロパティを取り出すためだけに使用
    if (typeof resultText !== "string") {
      appendError(paths, "worker: claude 出力に result 文字列が無い");
      return;
    }

    const result = parseExtractionResult(resultText);
    if (result === null) {
      appendError(paths, `worker: 抽出結果が不正なため破棄: ${resultText.slice(0, 500)}`);
      return;
    }

    const report = applyExtraction(paths, result, new Date().toISOString());
    console.log(JSON.stringify(report));
  } catch (e) {
    try {
      appendError(paths, `worker: ${String(e)}`);
    } catch {
      // ログ書き込みすら失敗した場合は諦める
    }
  }
}

await main();
```

- [ ] **Step 3: hooks.json に SessionEnd を追記する**

`fading-memory/hooks/hooks.json` を以下の全体に置き換える:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ts\"",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end.ts\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: 手動で動作確認する（claude 呼び出しなしの経路）**

Run: `echo '{"cwd":"/tmp/claude/fading-e2e"}' | bun run fading-memory/hooks/session-end.ts`
Expected: transcript_path が無いので即終了し、何も起きない（exit 0）

Run: `FADING_MEMORY_WORKER=1 bun run fading-memory/hooks/session-end.ts < /dev/null`
Expected: ガードにより stdin を読む前に即終了する（exit 0）

- [ ] **Step 5: 既存テストがすべて通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add fading-memory/hooks/session-end.ts fading-memory/hooks/session-end-worker.ts fading-memory/hooks/hooks.json
git commit -m "feat: SessionEndフックでバックグラウンド記憶抽出を追加"
```

---

### Task 9: maintain スキル

**Files:**
- Create: `fading-memory/skills/maintain/SKILL.md`
- Create: `fading-memory/skills/maintain/scripts/list-memories.ts`
- Create: `fading-memory/skills/maintain/scripts/trash-memory.ts`
- Create: `fading-memory/skills/maintain/scripts/finalize.ts`

**Interfaces:**
- Consumes: `dataPaths` / `loadMemories` / `moveToTrash` / `sortForIndex` / `renderIndex` / `expiresAt`（相対 import `../../../hooks/lib/*.ts`）
- Produces:
  - `list-memories.ts`: 検証優先順（有効期限の降順）で1件1行の key=value 出力
  - `trash-memory.ts <slug>`: 指定 slug を trash へ移動（permanent は拒否して exit 1）
  - `finalize.ts`: INDEX.md 再生成 + `state.json` の `lastMaintainedAt` 更新

- [ ] **Step 1: スクリプトを実装する**

`fading-memory/skills/maintain/scripts/list-memories.ts`:

```ts
import { expiresAt } from "../../../hooks/lib/expiry.ts";
import { sortForIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const paths = dataPaths(process.cwd());
ensureDirs(paths);
const { memories, malformed } = loadMemories(paths);

for (const m of sortForIndex(memories)) {
  const exp = expiresAt(m.meta);
  const expires = exp === Infinity ? "never" : new Date(exp).toISOString();
  console.log(
    `slug=${m.slug} permanent=${m.meta.permanent} expires=${expires} file=${m.file} title=${m.meta.title}`,
  );
}
for (const name of malformed) {
  console.log(`malformed=${name}`);
}
```

`fading-memory/skills/maintain/scripts/trash-memory.ts`:

```ts
import { loadMemories, moveToTrash } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const slug = process.argv[2];
if (slug === undefined) {
  console.error("usage: trash-memory.ts <slug>");
  process.exit(1);
}

const paths = dataPaths(process.cwd());
const mem = loadMemories(paths).memories.find((m) => m.slug === slug);
if (mem === undefined) {
  console.error(`error=not-found slug=${slug}`);
  process.exit(1);
}
if (mem.meta.permanent) {
  console.error(`error=permanent slug=${slug} 削除は行わずユーザーに報告すること`);
  process.exit(1);
}
moveToTrash(paths, slug, Date.now());
console.log(`trashed=${slug}`);
```

`fading-memory/skills/maintain/scripts/finalize.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { renderIndex } from "../../../hooks/lib/index-gen.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

const paths = dataPaths(process.cwd());
ensureDirs(paths);
writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories));

let state: Record<string, unknown> = {};
try {
  const parsed: unknown = JSON.parse(readFileSync(paths.stateFile, "utf8"));
  if (typeof parsed === "object" && parsed !== null) {
    state = parsed as Record<string, unknown>;
    // as は既存 state の任意キーを保持したまま上書きするためだけに使用
  }
} catch {
  // state.json が無い・壊れている場合は作り直す
}
state["lastMaintainedAt"] = new Date().toISOString();
writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log("finalized=true");
```

- [ ] **Step 2: SKILL.md を書く**

`fading-memory/skills/maintain/SKILL.md`:

````markdown
---
name: maintain
description: fading-memory の記憶データを再構成する。各記憶の内容をコードベースの現状と突き合わせて検証し、誤った記憶の削除・部分更新を行う。「記憶をメンテして」「記憶を再構成して」「fading-memory をメンテナンス」などの依頼時に使用する。
---

fading-memory の記憶データを再構成する。有効期限の遠いもの（= 重要度の高いもの）から順に、内容が今も正しいかを検証し、結果に応じて処置する。

## 制約

- この処理による読み取り・更新で frontmatter の `score` と `lastReferenced` を変更してはならない
- 記憶データの削除は必ず `trash-memory.ts` 経由で行う（直接ファイルを消さない）

## 手順

1. 記憶の一覧を検証優先順で取得する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/list-memories.ts"`
   - 出力は1件1行の key=value 形式（slug / permanent / expires / file / title）
   - `malformed=` の行があればユーザーに報告する（修復・削除はしない）
2. 各記憶データについて、出力順（有効期限の降順）に:
   - `file=` のパスを Read し、本文の内容をコードベースや設定の現状と突き合わせて検証する
   - **内容が正**: 何もしない
   - **内容が偽**: `bun run "${CLAUDE_SKILL_DIR}/scripts/trash-memory.ts" <slug>` で削除する。
     ただし `permanent=true` の記憶は削除せず、偽である根拠をユーザーに報告する
   - **部分的に正**: Edit で本文を修正し、frontmatter の `updated` を現在日時（ISO 8601）に更新する
3. すべて処理したら目次と state を更新する:
   `bun run "${CLAUDE_SKILL_DIR}/scripts/finalize.ts"`
4. ユーザーに結果を報告する: 検証件数、削除した slug と理由、更新した slug と変更点、permanent で偽と判定したもの
````

- [ ] **Step 3: 手動で動作確認する**

Run: `bun run fading-memory/skills/maintain/scripts/list-memories.ts`
Expected: このリポジトリ用のデータディレクトリが作成され、記憶が無ければ出力なしで exit 0

Run: `bun run fading-memory/skills/maintain/scripts/finalize.ts`
Expected: `finalized=true` が出力され、INDEX.md と state.json が生成される

Run: `bun run fading-memory/skills/maintain/scripts/trash-memory.ts no-such-slug`
Expected: `error=not-found slug=no-such-slug` で exit 1

- [ ] **Step 4: 既存テストがすべて通ることを確認する**

Run: `bun test fading-memory`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add fading-memory/skills
git commit -m "feat: 記憶を再構成するmaintainスキルを追加"
```

---

### Task 10: E2E 手動検証

**Files:**
- なし（検証のみ。問題が見つかった場合は該当タスクのファイルを修正する）

**Interfaces:**
- Consumes: Task 1〜9 の成果すべて
- Produces: 動作確認済みのプラグイン

- [ ] **Step 1: プラグインをローカルインストールする**

`/plugin` からこのリポジトリのマーケットプレイスを再読み込みし、fading-memory プラグインを有効化する（すでにマーケットプレイス登録済みの環境なら有効化のみ）。

- [ ] **Step 2: 記憶の生成を確認する**

テスト用の適当なプロジェクトで Claude Code セッションを開始し、再利用価値のある作業（例: 何かの仕様を調査して結論を出す）をして終了する。

Expected: `~/.claude/fading-memory/<スラッグ>/session-end.log` に ApplyReport の JSON が記録され、`memories/` に .md が生成される

- [ ] **Step 3: 目次の注入と役立ち判定を確認する**

同じプロジェクトで新しいセッションを開始し、前の記憶が関わる質問をして終了する。

Expected: セッション中の応答が記憶を活用している（目次が注入されている）。終了後、活用された記憶の `score` が +1 され `lastReferenced` が設定されている

- [ ] **Step 4: 失効と trash を確認する**

`memories/` のファイルの `created` を 60 日前の ISO 文字列に書き換え（score 0 なら期限切れになる）、新しいセッションを開始する。

Expected: ファイルが `trash/<epoch>__<slug>.md` へ移動し、INDEX.md から消えている

- [ ] **Step 5: maintain スキルを確認する**

記憶が残っている状態で `/fading-memory:maintain` を実行する。

Expected: 検証順（有効期限の降順）に処理され、結果の報告（検証件数・処置）が返る。`state.json` に `lastMaintainedAt` が入る

- [ ] **Step 6: ワーカーの無限連鎖がないことを確認する**

Step 2 実行後の `session-end.log` と `error.log` を確認する。

Expected: ワーカーが1回だけ動いた記録になっており、headless セッション由来の再帰起動の痕跡（多重の ApplyReport や連続する claude 呼び出し）がない

- [ ] **Step 7: 発見した問題の修正をコミットして完了**

```bash
git add -A
git commit -m "fix: E2E検証で見つかった問題を修正"
```

（問題が無ければこのコミットは不要）
