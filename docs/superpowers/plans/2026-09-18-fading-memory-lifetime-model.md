# fading-memory 寿命モデル再設計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fading-memory の有効期限を「直近参照（無ければ作成）を起点に、出自別の基本 TTL + score × 7 日」という起点 1 つの式に置き換え、期限切れによる削除を廃止して index.md に載せないだけにする。

**Architecture:** frontmatter に `origin: auto | manual` を追加し、`applyExtraction` の引数で出自を受け取る。`expiresAt` は `anchor + (baseTtlDays[origin] + score × perScoreDays)` の一本式にし、上限を撤廃する。`expireMemories` を削除し、`renderIndex(memories, now)` の中だけで `expiresAt > now` の絞り込みを行う。`loadMemories` は全件を返し続けるので、重複チェック・更新・加点は退色済みの記憶も対象になる。

**Tech Stack:** TypeScript / Bun（`bun test` / `bun run`）。外部依存なし。

**Spec:** `docs/superpowers/specs/2026-09-18-fading-memory-lifetime-model-design.md`

## Global Constraints

- 実装コードは TypeScript。`!`（non-null assertion）・`as`・`any` を極力使わない。使う場合は必要な理由をコメントで残す
- コードコメントは日本語で「コードから読み取れない実装の理由」のみを書く。「変更禁止」のような注意書きは書かない
- テストは `bun test <絶対パス>` で、変更したファイルのテストだけを個別に実行する。全体テスト・全体型チェックは実行しない
- 各 Task の最後はコミットではなく「変更ファイル一覧を確認する」。このリポジトリではコミットは人間が明示的に指示する
- Bash は 1 コマンド 1 目的。`&&` や `;` で連結しない。`cd` を使わない
- 定数は設計書どおり: `baseTtlDays: { auto: 15, manual: 30 }`、`perScoreDays: 7`、`trashRetentionDays: 30`。`maxExtensionDays` は削除する
- `origin` の値は `"auto"` と `"manual"` の 2 つだけ。欠落・未知の値は `"auto"` として読む
- `loadMemories` の返り値は絞り込まない。絞り込みは `renderIndex` の中だけ
- 記憶ファイルの実データ（`~/.claude/fading-memory/` 配下）は一切書き換えない。テストは `mkdtempSync` の一時ディレクトリで行う

## ファイル構成

| ファイル | 責務 | 扱い |
|---|---|---|
| `fading-memory/hooks/lib/frontmatter.ts` | `MemoryOrigin` 型と `origin` フィールドの parse / serialize | 変更 |
| `fading-memory/hooks/lib/config.ts` | `baseTtlDays` を出自別のオブジェクトへ変更、`maxExtensionDays` 削除 | 変更 |
| `fading-memory/hooks/lib/expiry.ts` | 起点 1 つ・上限なしの新式 | 変更 |
| `fading-memory/hooks/lib/extraction.ts` | `applyExtraction` に `origin` 引数を追加 | 変更 |
| `fading-memory/hooks/lib/maintenance.ts` | `expireMemories` を削除 | 変更 |
| `fading-memory/hooks/lib/index-gen.ts` | `renderIndex(memories, now)` で有効期限内だけを載せる | 変更 |
| `fading-memory/hooks/session-start.ts` | `expireMemories` 呼び出しの削除、`renderIndex` へ `now` を渡す | 変更 |
| `fading-memory/hooks/session-end-worker.ts` | `applyExtraction` に `"auto"` を渡す | 変更 |
| `fading-memory/skills/remember/scripts/save-memories.ts` | `applyExtraction` に `"manual"` を渡す、`renderIndex` へ `now` を渡す | 変更 |
| `fading-memory/skills/maintain/scripts/finalize.ts` | `renderIndex` へ `now` を渡す | 変更 |
| `fading-memory/skills/list/scripts/list-memories.ts` | 出力行に `origin=` を追加 | 変更 |
| `fading-memory/skills/list/SKILL.md` | 出力キーと退色の説明を更新 | 変更 |
| `fading-memory/README.md` | SessionStart の流れと寿命の式を更新 | 変更 |
| `fading-memory/agents/memory-verifier.md` | frontmatter テンプレ説明に `origin` を追記 | 変更 |
| 上記に対応する `hooks/lib/*.test.ts` | テスト | 変更 |

---

### Task 1: frontmatter に `origin` を追加する

**Files:**
- Modify: `fading-memory/hooks/lib/frontmatter.ts`
- Test: `fading-memory/hooks/lib/frontmatter.test.ts`
- Modify（型追従のみ）: `fading-memory/hooks/lib/expiry.test.ts`、`index-gen.test.ts`、`ranking.test.ts`、`maintenance.test.ts`、`extraction.test.ts`

**Interfaces:**
- Produces: `export type MemoryOrigin = "auto" | "manual"`、`MemoryMeta.origin: MemoryOrigin`。以降の Task はこの型と `meta.origin` を使う

- [ ] **Step 1: frontmatter.test.ts に origin のテストを追加する**

`doc` の meta に `origin: "manual"` を足し、`describe` の末尾に 2 ケースを追加する。

```ts
const doc: MemoryDoc = {
  meta: {
    title: "API クライアントの再試行規約: 3回まで",
    created: "2026-08-26T10:00:00.000Z",
    updated: "2026-08-26T10:00:00.000Z",
    lastReferenced: null,
    score: 0,
    permanent: false,
    origin: "manual",
    related: ["other-slug", "another"],
  },
  body: "本文1行目\n\n本文3行目",
};
```

```ts
  test("origin を持たない旧形式は auto として読む", () => {
    const legacy = serializeMemory(doc).replace("origin: manual\n", "");
    expect(parseMemory(legacy)?.meta.origin).toBe("auto");
  });

  test("未知の origin は auto として読む", () => {
    const broken = serializeMemory(doc).replace("origin: manual", "origin: unknown");
    expect(parseMemory(broken)?.meta.origin).toBe("auto");
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/frontmatter.test.ts`
Expected: FAIL。ラウンドトリップで `origin` が失われて `toEqual` が不一致、新規 2 ケースは `undefined` で失敗

- [ ] **Step 3: frontmatter.ts を実装する**

`MemoryMeta` の直前に型を追加し、フィールドを足す。

```ts
/** 記憶の出自。auto は SessionEnd の自動抽出、manual は remember スキルによる明示的な保存 */
export type MemoryOrigin = "auto" | "manual";

/** 記憶データの frontmatter。正データはこの構造の .md ファイルのみ */
export interface MemoryMeta {
  title: string;
  created: string;
  updated: string;
  lastReferenced: string | null;
  score: number;
  permanent: boolean;
  origin: MemoryOrigin;
  related: string[];
}
```

`parseMemory` の `lastReferenced` 算出の直後に追加し、返り値に含める。

```ts
  // origin を持たない旧ファイルと未知の値は auto として読む（この機能の導入前はすべて自動抽出だった）
  const origin: MemoryOrigin = raw["origin"] === "manual" ? "manual" : "auto";

  return {
    meta: {
      title,
      created,
      updated,
      lastReferenced,
      score,
      permanent: raw["permanent"] === "true",
      origin,
      related,
    },
    body,
  };
```

`serializeMemory` の `permanent` 行の直後に追加する。

```ts
    `permanent: ${m.permanent}`,
    `origin: ${m.origin}`,
    `related: [${m.related.join(", ")}]`,
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/frontmatter.test.ts`
Expected: PASS（8 ケース）

- [ ] **Step 5: 他のテストのフィクスチャに `origin: "auto"` を足す**

`MemoryMeta` を組み立てている 5 ファイルの `permanent` 行の直後に `origin: "auto",` を追加する。

- `expiry.test.ts` の `meta()`:
  ```ts
    permanent: false,
    origin: "auto",
    related: [],
  ```
- `index-gen.test.ts` の `mem()`、`ranking.test.ts` の `mem()`: 同じ位置に `origin: "auto",`
- `maintenance.test.ts` の `writeMemory()`:
  ```ts
        permanent,
        origin: "auto",
        related: [],
  ```
- `extraction.test.ts` の `setup()`:
  ```ts
        permanent: false,
        origin: "auto",
        related: [],
  ```

- [ ] **Step 6: 追従した 5 ファイルのテストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/expiry.test.ts`
Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/index-gen.test.ts`
Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/ranking.test.ts`
Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/maintenance.test.ts`
Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/extraction.test.ts`
Expected: すべて PASS（挙動は変わっていないため）

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: `frontmatter.ts` と 6 つの `*.test.ts` だけが変更されている

---

### Task 2: 寿命の式を起点 1 つ・上限なしに置き換える

**Files:**
- Modify: `fading-memory/hooks/lib/config.ts`
- Modify: `fading-memory/hooks/lib/expiry.ts`
- Test: `fading-memory/hooks/lib/expiry.test.ts`

**Interfaces:**
- Consumes: `MemoryMeta.origin`（Task 1）
- Produces: `config.baseTtlDays: { auto: 15, manual: 30 }`。`expiresAt(meta, cfg)` / `remainingDays(meta, now, cfg)` の署名は変えない

- [ ] **Step 1: expiry.test.ts を新式に書き直す**

`describe("expiresAt")` と `describe("remainingDays")` を丸ごと次に置き換える（`meta()` ヘルパーはそのまま）。

```ts
describe("expiresAt", () => {
  test("auto の score 0 は created + 15日", () => {
    expect(expiresAt(meta({}))).toBe(createdMs + 15 * DAY);
  });

  test("manual の score 0 は created + 30日", () => {
    expect(expiresAt(meta({ origin: "manual" }))).toBe(createdMs + 30 * DAY);
  });

  test("score 1 につき 7 日延長される", () => {
    expect(expiresAt(meta({ score: 3 }))).toBe(createdMs + (15 + 21) * DAY);
  });

  test("延長に上限は無い", () => {
    expect(expiresAt(meta({ score: 100 }))).toBe(createdMs + (15 + 700) * DAY);
  });

  test("lastReferenced があればそれを起点にし、created は使わない", () => {
    const lastRef = new Date(createdMs + 200 * DAY).toISOString();
    expect(expiresAt(meta({ score: 2, lastReferenced: lastRef }))).toBe(
      createdMs + (200 + 15 + 14) * DAY,
    );
  });

  test("permanent は Infinity", () => {
    expect(expiresAt(meta({ permanent: true }))).toBe(Infinity);
  });
});

describe("remainingDays", () => {
  test("permanent は Infinity", () => {
    expect(remainingDays(meta({ permanent: true }), createdMs)).toBe(Infinity);
  });

  test("期限ちょうどの時刻では 0", () => {
    expect(remainingDays(meta({}), createdMs + 15 * DAY)).toBe(0);
  });

  test("期限を過ぎていれば負値になる", () => {
    expect(remainingDays(meta({}), createdMs + 18 * DAY)).toBe(-3);
  });

  test("端数は切り上げる", () => {
    expect(remainingDays(meta({}), createdMs + 14.5 * DAY)).toBe(1);
  });

  test("score による延長が残り日数に反映される", () => {
    expect(remainingDays(meta({ score: 3 }), createdMs)).toBe(36);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/expiry.test.ts`
Expected: FAIL。基本 TTL が 30 日のままなので `expiresAt` 系と `remainingDays` 系の大半が不一致

- [ ] **Step 3: config.ts を変更する**

`baseTtlDays` をオブジェクトにし、`maxExtensionDays` を削除する。

```ts
/** fading-memory の動作定数。寿命計算・trash 保持・headless モデルをここに集約する */
export const config = {
  // 明示的に remember された記憶は自動抽出より長く index に残す
  baseTtlDays: { auto: 15, manual: 30 },
  perScoreDays: 7,
  trashRetentionDays: 30,
  headlessModel: "sonnet",
  // 抽出プロンプトへ埋め込む会話本文の上限。トランスクリプト全文（数 MB）を子に読ませると
  // 読み取りループだけでタイムアウトするため、ここで前処理側の予算を固定する
  transcriptMaxBytes: 200 * 1024,
} as const;
// as const は定数オブジェクトのリテラル型固定のためで、型の偽装ではない

export type FadingMemoryConfig = typeof config;
```

- [ ] **Step 4: expiry.ts の `expiresAt` を書き直す**

```ts
/**
 * 記憶データの有効期限（epoch ミリ秒）。index.md に載せる順位の基準でもある。
 * 起点は直近参照（無ければ作成）の 1 つだけで、そこから出自別の基本TTL + score 線形延長ぶん先を返す。
 * 期限はファイルに保存せず、常にここで計算する（二重管理の防止）。
 */
export function expiresAt(meta: MemoryMeta, cfg: FadingMemoryConfig = config): number {
  if (meta.permanent) return Infinity;
  const anchor = Date.parse(meta.lastReferenced ?? meta.created);
  const ttlDays = cfg.baseTtlDays[meta.origin] + meta.score * cfg.perScoreDays;
  return anchor + ttlDays * DAY_MS;
}
```

`remainingDays` は変更しない。

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/expiry.test.ts`
Expected: PASS（11 ケース）

- [ ] **Step 6: expiresAt に依存する既存テストが通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/ranking.test.ts`
Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/index-gen.test.ts`
Expected: PASS（並び順の相対関係は新式でも変わらない）

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: Task 1 の変更に加えて `config.ts`、`expiry.ts`、`expiry.test.ts` が変更されている

---

### Task 3: `applyExtraction` で出自を書き込む

**Files:**
- Modify: `fading-memory/hooks/lib/extraction.ts`
- Modify: `fading-memory/skills/remember/scripts/save-memories.ts`
- Modify: `fading-memory/hooks/session-end-worker.ts`
- Test: `fading-memory/hooks/lib/extraction.test.ts`

**Interfaces:**
- Consumes: `MemoryOrigin`（Task 1）
- Produces: `applyExtraction(paths: DataPaths, result: ExtractionResult, nowIso: string, origin: MemoryOrigin): ApplyReport`

- [ ] **Step 1: extraction.test.ts の `applyExtraction` テストを更新・追加する**

既存 2 ケースの `applyExtraction(...)` 呼び出しに第 4 引数 `"auto"` を足し、1 ケース目の `created` 検証に `origin` を加える。

```ts
    const created = parseMemory(readFileSync(join(paths.memoriesDir, "foo-2.md"), "utf8"));
    expect(created?.meta.created).toBe(NOW_ISO);
    expect(created?.meta.score).toBe(0);
    expect(created?.meta.origin).toBe("auto");
```

`describe("applyExtraction")` の末尾に追加する。

```ts
  test("manual で新規作成すると origin が manual になり、更新では既存の origin を維持する", () => {
    const paths = setup();
    applyExtraction(
      paths,
      {
        newMemories: [{ slug: "by-hand", title: "手動", body: "b" }],
        updatedMemories: [{ slug: "foo", body: "rewritten" }],
        usefulMemorySlugs: [],
      },
      NOW_ISO,
      "manual",
    );

    const created = parseMemory(readFileSync(join(paths.memoriesDir, "by-hand.md"), "utf8"));
    expect(created?.meta.origin).toBe("manual");

    const updated = parseMemory(readFileSync(join(paths.memoriesDir, "foo.md"), "utf8"));
    expect(updated?.body).toBe("rewritten");
    expect(updated?.meta.origin).toBe("auto");
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/extraction.test.ts`
Expected: FAIL。`by-hand.md` の `origin` が `"auto"` で `"manual"` にならない

- [ ] **Step 3: extraction.ts の `applyExtraction` に引数を追加する**

import に `MemoryOrigin` を足す。

```ts
import { parseMemory, serializeMemory, type MemoryOrigin } from "./frontmatter.ts";
```

署名と新規作成の meta を変更する。更新ブロックと加点ブロックは変更しない（parse した既存の `origin` がそのまま書き戻される）。

```ts
export function applyExtraction(
  paths: DataPaths,
  result: ExtractionResult,
  nowIso: string,
  origin: MemoryOrigin,
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
          origin,
          related: n.related ?? [],
        },
        body: n.body,
      }),
    );
    report.created.push(slug);
  }
```

- [ ] **Step 4: 呼び出し元 2 箇所に出自を渡す**

`skills/remember/scripts/save-memories.ts`:

```ts
const report = applyExtraction(paths, result, new Date().toISOString(), "manual");
```

`hooks/session-end-worker.ts`:

```ts
    const report = applyExtraction(paths, result, new Date().toISOString(), "auto");
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/extraction.test.ts`
Expected: PASS

- [ ] **Step 6: 呼び出し元がコンパイルエラーを起こさないことを確認する**

Run: `grep -rn "applyExtraction(" /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory --include=*.ts`
Expected: 定義 1 箇所、テスト内の呼び出し、`save-memories.ts`、`session-end-worker.ts` のすべてが 4 引数になっている

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: これまでの変更に加えて `extraction.ts`、`extraction.test.ts`、`save-memories.ts`、`session-end-worker.ts` が変更されている

---

### Task 4: 期限切れによる削除を廃止する

**Files:**
- Modify: `fading-memory/hooks/lib/maintenance.ts`
- Modify: `fading-memory/hooks/session-start.ts`
- Test: `fading-memory/hooks/lib/maintenance.test.ts`

**Interfaces:**
- Produces: `maintenance.ts` の export は `LoadedMemory`、`ensureDirs`、`loadMemories`、`moveToTrash`、`purgeTrash` のみになる

- [ ] **Step 1: maintenance.test.ts から `expireMemories` を取り除く**

import を次に変える。

```ts
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeMemory } from "./frontmatter.ts";
import { ensureDirs, loadMemories, purgeTrash } from "./maintenance.ts";
import { dataPaths } from "./paths.ts";
```

`writeMemory` の `permanent` 引数は `expireMemories` のテストだけが使っていたので削除する。

```ts
function writeMemory(dir: string, slug: string, createdMs: number) {
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
        permanent: false,
        origin: "auto",
        related: [],
      },
      body: "b",
    }),
  );
}
```

`describe("expireMemories", ...)` ブロックを丸ごと削除する。

- [ ] **Step 2: テストを実行して現状では通ることを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/maintenance.test.ts`
Expected: PASS（2 ケース）。削除対象の関数がまだ存在していても、テストがそれを参照しなくなったことを確認するのが目的

- [ ] **Step 3: maintenance.ts から `expireMemories` と不要な import を削除する**

`import { expiresAt } from "./expiry.ts";` を削除し、`expireMemories` 関数を丸ごと削除する。`DAY_MS` と `config` は `purgeTrash` が使うので残す。

- [ ] **Step 4: session-start.ts から呼び出しを削除する**

import を次に変える。

```ts
import { ensureDirs, loadMemories, purgeTrash } from "./lib/maintenance.ts";
```

`main()` 内の該当行を次に変える。

```ts
    ensureDirs(paths);
    const now = Date.now();
    purgeTrash(paths, now);
```

- [ ] **Step 5: テストと参照の残りを確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/maintenance.test.ts`
Expected: PASS

Run: `grep -rn "expireMemories" /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory`
Expected: 出力なし

- [ ] **Step 6: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: これまでの変更に加えて `maintenance.ts`、`maintenance.test.ts`、`session-start.ts` が変更されている

---

### Task 5: index.md を有効期限内の記憶だけに絞る

**Files:**
- Modify: `fading-memory/hooks/lib/index-gen.ts`
- Modify: `fading-memory/hooks/session-start.ts`
- Modify: `fading-memory/skills/maintain/scripts/finalize.ts`
- Modify: `fading-memory/skills/remember/scripts/save-memories.ts`
- Test: `fading-memory/hooks/lib/index-gen.test.ts`

**Interfaces:**
- Consumes: `expiresAt`（Task 2）
- Produces: `renderIndex(memories: LoadedMemory[], now: number): string`。`sortForIndex` は変更しない

- [ ] **Step 1: index-gen.test.ts を更新・追加する**

既存の `renderIndex` テストに `now` を渡し、絞り込みのケースを追加する。

```ts
const DAY = 24 * 60 * 60 * 1000;
const CREATED_MS = Date.parse("2026-01-01T00:00:00.000Z");

describe("renderIndex", () => {
  test("タイトルと相対パスのリストを出力する", () => {
    const text = renderIndex([mem("a", {})], CREATED_MS);
    expect(text).toContain("- [title of a](memories/a.md)");
  });

  test("有効期限を過ぎた記憶は載せず、permanent は常に載せる", () => {
    const now = CREATED_MS + 400 * DAY;
    const text = renderIndex([mem("faded", {}), mem("keep", { permanent: true })], now);
    expect(text).toContain("- [title of keep](memories/keep.md)");
    expect(text).not.toContain("faded");
  });

  test("期限ちょうどの記憶は載せない", () => {
    const now = CREATED_MS + 15 * DAY;
    expect(renderIndex([mem("edge", {})], now)).not.toContain("edge");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/index-gen.test.ts`
Expected: FAIL。`faded` と `edge` が出力に含まれる

- [ ] **Step 3: index-gen.ts の `renderIndex` を変更する**

```ts
/**
 * 目次に載せるのは有効期限内の記憶だけ。退色した記憶はファイルとして残り、
 * 更新または加点で起点が前進すれば再び載る。絞り込みはここだけで行い、loadMemories は全件を返す
 */
export function renderIndex(memories: LoadedMemory[], now: number): string {
  const visible = memories.filter((m) => expiresAt(m.meta) > now);
  const lines = sortForIndex(visible).map(
    (m) => `- [${m.meta.title}](memories/${m.slug}.md)`,
  );
  return ["# fading-memory 目次", "", ...lines, ""].join("\n");
}
```

- [ ] **Step 4: 呼び出し元 3 箇所に `now` を渡す**

`hooks/session-start.ts`（`now` は Task 4 で残した変数を使う）:

```ts
    const index = renderIndex(memories, now);
```

`skills/maintain/scripts/finalize.ts`:

```ts
const paths = dataPaths(process.cwd());
ensureDirs(paths);
writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories, Date.now()));
```

`skills/remember/scripts/save-memories.ts`:

```ts
writeFileSync(paths.indexFile, renderIndex(loadMemories(paths).memories, Date.now()));
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory/hooks/lib/index-gen.test.ts`
Expected: PASS（4 ケース）

- [ ] **Step 6: `renderIndex` の呼び出しがすべて 2 引数になっていることを確認する**

Run: `grep -rn "renderIndex(" /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory --include=*.ts`
Expected: 定義 1 箇所とテストを除き、`session-start.ts`、`finalize.ts`、`save-memories.ts` の 3 箇所が `now` または `Date.now()` を渡している

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: これまでの変更に加えて `index-gen.ts`、`index-gen.test.ts`、`finalize.ts` が変更され、`session-start.ts` と `save-memories.ts` は変更継続

---

### Task 6: list スキルとドキュメントを追従させる

**Files:**
- Modify: `fading-memory/skills/list/scripts/list-memories.ts`
- Modify: `fading-memory/skills/list/SKILL.md`
- Modify: `fading-memory/README.md`
- Modify: `fading-memory/agents/memory-verifier.md`

**Interfaces:**
- Consumes: `MemoryMeta.origin`（Task 1）

- [ ] **Step 1: list-memories.ts の出力行に `origin=` を追加する**

```ts
  console.log(
    `score=${m.meta.score} slug=${m.slug} remaining=${remaining} lastReferenced=${lastReferenced} permanent=${m.meta.permanent} origin=${m.meta.origin} title=${m.meta.title}`,
  );
```

- [ ] **Step 2: skills/list/SKILL.md の手順を更新する**

手順 1 の 3 行を次に置き換える（description は変更しない）。

```markdown
   - 1行目は `total=<件数>`。以降は1件1行の key=value 形式（score / slug / remaining / lastReferenced / permanent / origin / title）で score の降順に並ぶ
   - `remaining` は有効期限までの残り日数。`infinite` は permanent（期限なし）、負値は既に退色して index.md に載っていない記憶を意味する（ファイルは残っており、更新または加点されれば復帰する）
   - `origin` は記憶の出自。`auto` は SessionEnd の自動抽出、`manual` は remember スキルによる保存
```

手順 2 の忘却の見通しの行を次に置き換える。

```markdown
   - リストの後に1行、退色の見通しを添える。`remaining` が 7 以下の記憶があればその slug を挙げて「まもなく index.md から外れる」と伝え、1件も無ければ該当が無い旨を伝える
```

- [ ] **Step 3: README.md を更新する**

SessionStart の行を次に置き換える。

```markdown
- SessionStart: trash の掃除 → 目次生成（有効期限内の記憶のみ）→ コンテキスト注入
```

その直後（`SessionEnd:` 行の前）に寿命の説明を追加する。

```markdown
- 寿命: `expiresAt = (lastReferenced ?? created) + (baseTtlDays[origin] + score × 7日)`。基本 TTL は自動抽出 15 日・remember 30 日で、役立ったと判定されるたびに起点が前進し score が 1 増える。期限を過ぎた記憶は削除されず index.md に載らなくなるだけで、更新または加点で復帰する
```

- [ ] **Step 4: agents/memory-verifier.md の frontmatter テンプレ説明に `origin` を追記する**

```
permanent: <true|false>
origin: <auto|manual>
related: [<slug>, ...]
```

- [ ] **Step 5: 「削除」「trash へ移る」の残りが無いことを確認する**

Run: `grep -rn "期限切れ削除\|trash へ移る\|まもなく忘却" /Users/otto/workspace/mgzl-claude-code-plugin/fading-memory`
Expected: 出力なし

- [ ] **Step 6: 変更ファイル一覧を確認する**

Run: `git status --short`
Expected: これまでの変更に加えて `list-memories.ts`（list）、`skills/list/SKILL.md`、`README.md`、`agents/memory-verifier.md` が変更されている。`~/.claude/fading-memory/` 配下の実データには変更がない
