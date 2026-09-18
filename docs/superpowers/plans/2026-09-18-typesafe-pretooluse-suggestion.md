# typesafe PreToolUse スキル提案 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** typesafe プラグインを `PreToolUse`（matcher `Bash|Agent`）でも発火させ、Claude がこれから取る行為に対応するスキルを 1 件だけ提案できるようにする。

**Architecture:** 既存の `hooks/suggest-skill.ts` を stdin の `hook_event_name` で分岐させ、同じスクリプトを 2 イベントで使い回す。Jev への質問文（framing）を `pipeline.ts` の `Framing` 型で切り替え可能にし、`PROMPT_FRAMING`（既存挙動）と `TOOL_FRAMING`（行為向け）を用意する。request 文の組み立ては新規 `hooks/lib/request.ts` に切り出し、hook と eval で共有する。サブエージェント内での発火時は `agent_type` からエージェント定義ファイルを引いて Skill ツール保有を推定する。

**Tech Stack:** TypeScript / Bun（`bun test` / `bun run`）。外部依存なし。TypeSafe System One API（Jev）を `fetch` で直接呼ぶ。

**Spec:** `docs/superpowers/specs/2026-09-18-typesafe-pretooluse-suggestion-design.md`
前提設計書: `docs/superpowers/specs/2026-09-18-typesafe-skill-routing-design.md`

## Global Constraints

- 実装コードは TypeScript。`!`（non-null assertion）・`as`・`any` を極力使わない。使う場合は必要な理由をコメントで残す
- コードコメントは日本語で「コードから読み取れない実装の理由」のみを書く。「変更禁止」のような注意書きは書かない
- Jev に送る質問文・request 文・注入文は設計書どおり **英語のまま**。計画書やコメントの日本語に訳さない
- テストは `bun test <ファイルパス>` で、変更したファイルのテストだけを個別に実行する。全体テスト・全体型チェックは実行しない
- 各 Task の最後はコミットではなく「変更ファイル一覧を確認する」。このリポジトリではコミットは人間が明示的に指示する
- Bash は 1 コマンド 1 目的。`&&` や `;` で連結しない。`cd` を使わない
- 閾値定数は既存のまま: `SHORTLIST = 3`、`EXCERPT_CHARS = 700`、`GATE_THRESHOLD = 0.3`、`FITS_THRESHOLD = 0.3`
- 新規定数: `TOOL_INPUT_CHARS = 2000`
- フェイルオープン: どの経路でも stdout に何も出さず exit 0 で終わる

## ファイル構成

| ファイル | 責務 | 扱い |
|---|---|---|
| `typesafe/hooks/lib/request.ts` | ツール呼び出しから Jev の `state.request` 文を組み立てる | 新規 |
| `typesafe/hooks/lib/request.test.ts` | 同上のテスト | 新規 |
| `typesafe/hooks/lib/pipeline.ts` | 2 コールの組み立てと閾値判定。`Framing` による質問文の切り替え | 変更 |
| `typesafe/hooks/lib/roster.ts` | スキル発見に加え、`agentHasSkillTool` によるエージェント定義の解決 | 変更 |
| `typesafe/hooks/lib/log.ts` | `event` / `tool_name` / `agent_type` を追加 | 変更 |
| `typesafe/hooks/suggest-skill.ts` | `hook_event_name` による分岐と PreToolUse の注入 | 変更 |
| `typesafe/hooks/hooks.json` | `PreToolUse` エントリの追加 | 変更 |
| `typesafe/manifest.test.ts` | `hooks.json` の PreToolUse を検証 | 変更 |
| `typesafe/eval/run.ts` | ツール向けケースの評価と `event` 別内訳 | 変更 |
| `typesafe/eval/golden.json` | ツール向けケース 10 件を追加 | 変更 |
| `typesafe/README.md` | 2 つの発火点の説明 | 変更 |

---

## Task 0: PreToolUse hook の stdin を実機で採取する

このリポジトリのコードは一切変更しない調査タスク。Task 3（`agentHasSkillTool`）と Task 5（stdin の読み取り）の実装が、ここで採取した実物の形に依存する。

**Files:**
- 変更しない（設定ファイルの編集はユーザーが行う）

**Interfaces:**
- Produces: `agent_type` の表記（プラグイン接頭辞 `mgzl:` が付くか否か）、`tool_input` のキー構成、`agent_id` の有無。Task 3 の `findAgentFile` と Task 5 の `parsePayload` がこれに合わせる

- [ ] **Step 1: ユーザーに貼ってもらう設定断片を提示する**

ユーザーに次のとおり依頼する。**この編集はユーザー自身が行う。実装者は settings ファイルを書き換えない**（`~/.claude/settings.json` ではなく、必ずプロジェクトの `<cwd>/.claude/settings.local.json`）。

「`/Users/otto/workspace/mgzl-claude-code-plugin/.claude/settings.local.json` を開き、既存の JSON のトップレベルに次の `hooks` キーを追加してください。すでに `hooks` キーがある場合は、その中に `PreToolUse` 配列を足してください。採取後に元へ戻すので、編集前の内容を控えておいてください。」

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "cat > /tmp/claude/typesafe-capture-$$.json",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

書き出し先を `$TMPDIR` ではなく `/tmp/claude` に固定しているのは、hook が Bash ツールのサンドボックス外で動くためである。hook 側の `$TMPDIR` は macOS 標準の一時領域を指し、Bash ツール側の `$TMPDIR`（サンドボックス専用領域）とは別のディレクトリになるので、`$TMPDIR` を使うと採取ファイルが Bash ツールから見えない。`/tmp/claude` はサンドボックスの書き込み許可対象に含まれており、両側から同じパスで扱える。

この hook は stdin をそのまま 1 発火 1 ファイルへ書き出すだけで、stdout には何も出さないのでツール呼び出しを妨げない。`$$` は hook を実行するシェルの PID なので、発火ごとに別ファイルになり JSON が連結されない。

- [ ] **Step 2: 設定を反映させるため Claude Code を再起動してもらう**

ユーザーに「設定を保存したら Claude Code を再起動し、再起動後にこのセッションの続きを指示してください」と伝える。hook 定義は起動時に読まれるため、保存しただけでは反映されない。

- [ ] **Step 3: メインセッションでの Bash 発火を採取する**

再起動後、次を実行して採取を発生させる。

Run: `ls /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks`

- [ ] **Step 4: 採取されたファイルを一覧する**

Run: `ls /tmp/claude`

Expected: `typesafe-capture-<数字>.json` が 1 件以上ある

- [ ] **Step 5: メインセッションの stdin の中身を読む**

Run: `cat /tmp/claude/typesafe-capture-*.json`

確認する点:
- `hook_event_name` が `"PreToolUse"` であること
- `tool_name` が `"Bash"` であること
- `tool_input` が `{ "command": ..., "description": ... }` の形であること（`description` が無い発火もありうる）
- `agent_id` / `agent_type` がトップレベルに **無い** こと（メインセッションの発火なので）
- `cwd` / `session_id` が既存の UserPromptSubmit と同じキー名であること

- [ ] **Step 6: 採取済みファイルを消してからサブエージェント内の発火を採取する**

Run: `rm /tmp/claude/typesafe-capture-*.json`

その後、プラグイン定義のあるエージェントを 1 つ起動する。Agent ツールで `subagent_type: "mgzl:budgeted-investigator"` を指定し、prompt に「`/Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks` の中身を Bash の `ls` で一覧して報告してください」と渡す。これで Agent ツール自身の PreToolUse と、サブエージェント内の Bash の PreToolUse の両方が採取される。

- [ ] **Step 7: サブエージェント内の stdin の中身を読む**

Run: `cat /tmp/claude/typesafe-capture-*.json`

**このタスクで最も重要な確認点:** サブエージェント内で発火したレコードのトップレベル `agent_type` が

- `"mgzl:budgeted-investigator"`（プラグイン接頭辞あり）なのか
- `"budgeted-investigator"`（接頭辞なし）なのか

を記録する。Task 3 の `findAgentFile` はこの表記に合わせて書く（計画のコードは両表記を受け付ける形で書いてあるが、採取結果と食い違う場合はこのタスクの結果を正とする）。

あわせて、Agent ツール呼び出し側のレコードで `tool_input` が `{ "description": ..., "prompt": ..., "subagent_type": ... }` の形であることを確認する。

- [ ] **Step 8: 採取結果を書き留める**

確認した内容を、実装に入る前にユーザーへ 1 メッセージで報告する。最低限、次の 3 点を含める。

- `agent_type` の実物の値（接頭辞の有無）
- `tool_input` の実際のキー名（`command` / `prompt` / `description`）
- `agent_id` がトップレベルに存在する条件

- [ ] **Step 9: 一時 hook を元に戻してもらう**

ユーザーに「`/Users/otto/workspace/mgzl-claude-code-plugin/.claude/settings.local.json` を Step 1 の編集前の状態に戻し（追加した `PreToolUse` 配列、および `hooks` キー自体を新規追加していたならそれも削除）、Claude Code を再起動してください」と依頼する。

- [ ] **Step 10: 採取ファイルを掃除する**

Run: `rm /tmp/claude/typesafe-capture-*.json`

- [ ] **Step 11: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: このタスクではリポジトリ内のファイルに変更が無い（`.claude/settings.local.json` も元に戻っている）

---

## Task 1: `hooks/lib/request.ts` — ツール呼び出しから request 文を組み立てる

設計書 5 章。hook と eval の両方から使う唯一の組み立て関数。

**Files:**
- Create: `typesafe/hooks/lib/request.ts`
- Test: `typesafe/hooks/lib/request.test.ts`

**Interfaces:**
- Consumes: なし（他ファイルに依存しない）
- Produces:
  - `export const TOOL_INPUT_CHARS = 2000`
  - `export type ToolRequestInput = { toolName: string; toolInput: Record<string, unknown> }`
  - `export function buildToolRequest(input: ToolRequestInput): string | undefined`
  - Task 5（`suggest-skill.ts`）と Task 6（`eval/run.ts`）が両方 import する

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/request.test.ts` を新規作成する。

```ts
import { describe, expect, test } from "bun:test";
import { buildToolRequest, TOOL_INPUT_CHARS } from "./request.ts";

describe("buildToolRequest", () => {
  test("Bash は description と command を行で並べる", () => {
    expect(
      buildToolRequest({
        toolName: "Bash",
        toolInput: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
      }),
    ).toBe(
      'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
    );
  });

  test("Agent は description と prompt を行で並べる", () => {
    expect(
      buildToolRequest({
        toolName: "Agent",
        toolInput: {
          description: "Write the implementation plan",
          prompt: "設計書から実装計画を書いてください",
          subagent_type: "general-purpose",
        },
      }),
    ).toBe(
      "The assistant is about to perform this action:\nWrite the implementation plan\n設計書から実装計画を書いてください",
    );
  });

  test("description が無ければその行を省く", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { command: "ls typesafe/hooks" } })).toBe(
      "The assistant is about to perform this action:\nls typesafe/hooks",
    );
  });

  test("description が空文字でもその行を省く", () => {
    expect(
      buildToolRequest({ toolName: "Bash", toolInput: { description: "", command: "ls" } }),
    ).toBe("The assistant is about to perform this action:\nls");
  });

  test("description が文字列でなければその行を省く", () => {
    expect(
      buildToolRequest({ toolName: "Bash", toolInput: { description: 42, command: "ls" } }),
    ).toBe("The assistant is about to perform this action:\nls");
  });

  test("body は TOOL_INPUT_CHARS で切り詰める", () => {
    const long = "a".repeat(TOOL_INPUT_CHARS + 500);
    const built = buildToolRequest({ toolName: "Agent", toolInput: { prompt: long } });
    expect(built).toBe(`The assistant is about to perform this action:\n${"a".repeat(TOOL_INPUT_CHARS)}`);
  });

  test("TOOL_INPUT_CHARS は 2000", () => {
    expect(TOOL_INPUT_CHARS).toBe(2000);
  });

  test("Bash で command が無ければ undefined", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { description: "何かする" } })).toBeUndefined();
  });

  test("Agent で prompt が無ければ undefined", () => {
    expect(buildToolRequest({ toolName: "Agent", toolInput: { description: "何かする" } })).toBeUndefined();
  });

  test("command が空文字なら undefined", () => {
    expect(buildToolRequest({ toolName: "Bash", toolInput: { command: "" } })).toBeUndefined();
  });

  test("対象外のツール名なら undefined", () => {
    expect(
      buildToolRequest({ toolName: "Edit", toolInput: { file_path: "/x", old_string: "a", new_string: "b" } }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/request.test.ts`

Expected: FAIL（`Cannot find module './request.ts'`）

- [ ] **Step 3: 最小実装を書く**

`typesafe/hooks/lib/request.ts` を新規作成する。

```ts
/** request 文に載せる command / prompt の最大文字数。Agent の prompt は長くなりうる */
export const TOOL_INPUT_CHARS = 2000;

export type ToolRequestInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
};

const PREFIX = "The assistant is about to perform this action:";

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

/** ツールごとに本体として使う tool_input のキー。対象外のツールは undefined */
function bodyKeyFor(toolName: string): string | undefined {
  if (toolName === "Bash") return "command";
  if (toolName === "Agent") return "prompt";
  return undefined;
}

/**
 * これから取る行為を表す request 文を組み立てる。
 * 冒頭の一文は「ユーザーの依頼」ではなく「行為」であることを Jev に伝えるためにある。
 * 本体（command / prompt）が取れない場合は組み立てを諦め、呼び出し側は提案を打ち切る。
 */
export function buildToolRequest(input: ToolRequestInput): string | undefined {
  const bodyKey = bodyKeyFor(input.toolName);
  if (bodyKey === undefined) return undefined;
  const body = readString(input.toolInput, bodyKey).slice(0, TOOL_INPUT_CHARS);
  if (body === "") return undefined;
  const description = readString(input.toolInput, "description");
  const lines = description === "" ? [PREFIX, body] : [PREFIX, description, body];
  return lines.join("\n");
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/request.test.ts`

Expected: PASS（11 tests）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/hooks/lib/request.ts` と `typesafe/hooks/lib/request.test.ts` が新規（`??`）として出る

---

## Task 2: `pipeline.ts` — framing の切り替えと `GateScores` の汎用化

設計書 7 章。`suggest()` に第 4 引数 `framing` を足し、gate を可変個数にする。既存の呼び出し元（`suggest-skill.ts` の UserPromptSubmit 側、`eval/run.ts`）は無変更で従来どおり動く。

**Files:**
- Modify: `typesafe/hooks/lib/pipeline.ts`
- Test: `typesafe/hooks/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `RosterEntry`（`roster.ts`）、`askSystemOne` / `Answer` / `ChoiceAnswer` / `JevOptions` / `Question`（`jev.ts`）
- Produces:
  - `export type GateSpec = { key: string; instructions: string; invert: boolean }`
  - `export type Framing = { wide: string; rerank: string; fits: (name: string, description: string) => string; gates: readonly GateSpec[] }`
  - `export type GateScores = { scores: Record<string, number>; mean: number }`
  - `export const PROMPT_FRAMING: Framing`
  - `export const TOOL_FRAMING: Framing`
  - `export async function suggest(prompt: string, roster: readonly RosterEntry[], options: JevOptions, framing?: Framing): Promise<SuggestResult>`
  - Task 4（`log.ts`）が `GateScores` を、Task 5・Task 6 が `TOOL_FRAMING` と `suggest` を使う

**設計書からの意図的な差分:** 設計書の `fits: (name: string) => string` を `(name: string, description: string) => string` にする。`PROMPT_FRAMING` の fits 文言は末尾に description 全文を含むため、name だけでは既存の質問文を再現できない。あわせて `TOOL_FRAMING.fits` も name と description を差し込む。Noul の instructions が候補ごとに同一だと `fits::<name>` が全候補で同じ値になり、閾値判定の材料にならないためである。

- [ ] **Step 1: 失敗するテストを書く（既存テストの書き換えを含む）**

`typesafe/hooks/lib/pipeline.test.ts` の変更は 3 か所ある。

まず import 行を差し替える。

変更前:
```ts
import { FITS_THRESHOLD, GATE_THRESHOLD, SHORTLIST, suggest } from "./pipeline.ts";
```

変更後:
```ts
import {
  FITS_THRESHOLD,
  GATE_THRESHOLD,
  PROMPT_FRAMING,
  SHORTLIST,
  suggest,
  TOOL_FRAMING,
} from "./pipeline.ts";
```

次に、`gate_quiet` のテストにある `GateScores` の固定 key 参照を新しい形へ書き換える。

変更前:
```ts
    expect(result.gate.mean).toBeCloseTo((0.1 + 0.1 + (1 - 0.9)) / 3, 10);
    expect(result.gate.mean).toBeLessThan(GATE_THRESHOLD);
```

変更後:
```ts
    expect(result.gate.mean).toBeCloseTo((0.1 + 0.1 + (1 - 0.9)) / 3, 10);
    expect(result.gate.mean).toBeLessThan(GATE_THRESHOLD);
    // 反転前の生の noul を key ごとに残す
    expect(result.gate.scores).toEqual({
      "gate::acts_on_user_system": 0.1,
      "gate::would_follow_documented_procedure": 0.1,
      "gate::prose_suffices": 0.9,
    });
```

最後に、ファイル末尾の `describe("suggest", ...)` の閉じ括弧の直前に、framing 向けのテストを追記する。

```ts
  test("framing を省略すると PROMPT_FRAMING と同じ質問が送られる（後方互換）", async () => {
    const { fetchImpl: implA, bodies: bodiesA } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implA });

    const { fetchImpl: implB, bodies: bodiesB } = queuedFetch([
      call1([0.1, 0.1, 0.9], { "mgzl:commiting-to-git": 0.4 }, "mgzl:commiting-to-git"),
    ]);
    await suggest("この変更をコミットして", ROSTER, { ...OPTIONS, fetchImpl: implB }, PROMPT_FRAMING);

    expect(bodiesA[0]).toEqual(bodiesB[0]);
  });

  test("TOOL_FRAMING の Call 1 は行為向けの which と gate 1 問になる", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.6,
            probabilities: { "mgzl:commiting-to-git": 0.4 },
          },
          "gate::routine_step": { type: "noul", noul: 0.9 },
        },
      },
    ]);
    const request =
      'The assistant is about to perform this action:\nList files\nls typesafe/hooks';
    const result = await suggest(request, ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING);

    const body = bodies[0];
    expect(body?.state).toEqual({ request, recent_context: "" });
    expect(Object.keys(body?.questions ?? {})).toEqual(["which", "gate::routine_step"]);
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?",
      criteria: {
        "mgzl:commiting-to-git": "差分を分析しコミットメッセージを生成してコミットする",
        "reviewview:reviewview-prepare": "レビュー結果を人間にトリアージ依頼する",
        "fading-memory:remember": "セッションの内容から記憶を作成する",
        "superpowers:writing-plans": "仕様から実装計画を書く",
      },
    });
    expect(body?.questions["gate::routine_step"]).toEqual({
      type: "noul",
      instructions:
        "Is this action a routine inspection step, such as listing, reading, or checking state, that any careful assistant would do without consulting a documented procedure?",
    });
    // invert: true なので 0.9 は 0.1 として平均に入り、閾値 0.3 を下回る
    expect(result.gate.mean).toBeCloseTo(0.1, 10);
    expect(result.gate.scores).toEqual({ "gate::routine_step": 0.9 });
    expect(result.outcome).toBe("gate_quiet");
    expect(bodies).toHaveLength(1);
  });

  test("TOOL_FRAMING の gate が低ければ Call 2 に進み、行為向けの文言で問う", async () => {
    const { fetchImpl, bodies } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.7,
            probabilities: {
              "mgzl:commiting-to-git": 0.6,
              "reviewview:reviewview-prepare": 0.2,
              "fading-memory:remember": 0.1,
              "superpowers:writing-plans": 0.1,
            },
          },
          "gate::routine_step": { type: "noul", noul: 0.05 },
        },
      },
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.92,
            probabilities: {
              "mgzl:commiting-to-git": 0.9,
              "reviewview:reviewview-prepare": 0.07,
              "fading-memory:remember": 0.03,
            },
          },
          "fits::mgzl:commiting-to-git": { type: "noul", noul: 0.88 },
          "fits::reviewview:reviewview-prepare": { type: "noul", noul: 0.05 },
          "fits::fading-memory:remember": { type: "noul", noul: 0.02 },
        },
      },
    ]);
    const request =
      'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"';
    const result = await suggest(request, ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING);

    expect(result.outcome).toBe("suggested");
    expect(result.winner).toBe("mgzl:commiting-to-git");
    expect(result.gate.mean).toBeCloseTo(0.95, 10);

    const body = bodies[1];
    expect(body?.questions["which"]).toEqual({
      type: "choice",
      instructions:
        "Exactly one of these skills documents the procedure for the action the assistant is about to take. Which one? Read what each actually does, not just its name.",
      criteria: {
        "mgzl:commiting-to-git":
          "差分を分析しコミットメッセージを生成してコミットする — コミット手順の本文。",
        "reviewview:reviewview-prepare":
          "レビュー結果を人間にトリアージ依頼する — トリアージ依頼の本文。",
        "fading-memory:remember": "セッションの内容から記憶を作成する — 記憶作成の本文。",
      },
    });
    expect(body?.questions["fits::mgzl:commiting-to-git"]).toEqual({
      type: "noul",
      instructions:
        "Does the skill 'mgzl:commiting-to-git' actually cover the action the assistant is about to take, rather than a merely similar topic? It is described as: 差分を分析しコミットメッセージを生成してコミットする",
    });
  });

  test("TOOL_FRAMING で gate の Noul 回答が欠けていたら例外にする", async () => {
    const { fetchImpl } = queuedFetch([
      {
        model: "jev-latest",
        answers: {
          which: {
            type: "choice",
            choice: "mgzl:commiting-to-git",
            confidence: 0.6,
            probabilities: { "mgzl:commiting-to-git": 0.4 },
          },
        },
      },
    ]);
    await expect(suggest("x", ROSTER, { ...OPTIONS, fetchImpl }, TOOL_FRAMING)).rejects.toThrow(
      "Jev did not answer the noul question 'gate::routine_step'",
    );
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/pipeline.test.ts`

Expected: FAIL（`PROMPT_FRAMING` / `TOOL_FRAMING` が export されていない、`result.gate.scores` が undefined）

- [ ] **Step 3: 最小実装を書く**

`typesafe/hooks/lib/pipeline.ts` を次の内容に置き換える（ファイル全文）。

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
/** gate の平均。これ未満なら提案しない */
export const GATE_THRESHOLD = 0.3;
/** fits の最大値。これ未満ならショートリストごと破棄する */
export const FITS_THRESHOLD = 0.3;

export type Outcome = "suggested" | "gate_quiet" | "no_fit";

/** Call 1 に載せる Noul 1 問。invert が true なら平均に入れる前に 1 - noul へ反転する */
export type GateSpec = { key: string; instructions: string; invert: boolean };

/** 判定の枠組み。プロンプト向けと行為向けで質問文と gate の構成が変わる */
export type Framing = {
  /** Call 1 の choice 質問文 */
  wide: string;
  /** Call 2 の choice 質問文 */
  rerank: string;
  /** Call 2 の候補ごとの noul 質問文 */
  fits: (name: string, description: string) => string;
  gates: readonly GateSpec[];
};

export type GateScores = {
  /** gate 質問キー → 反転前の生の noul。framing ごとにキーが変わる */
  scores: Record<string, number>;
  /** invert 適用後の平均 */
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

/** UserPromptSubmit 向け。ユーザーの依頼文を材料にする従来の枠組み */
export const PROMPT_FRAMING: Framing = {
  wide: WIDE_INSTRUCTIONS,
  rerank: RERANK_INSTRUCTIONS,
  fits: (name, description) =>
    `Does the skill '${name}' do the specific thing the user's request asks for? It is described as: ${description}`,
  gates: [
    { key: "gate::acts_on_user_system", instructions: GATE_ACTS, invert: false },
    { key: "gate::would_follow_documented_procedure", instructions: GATE_PROCEDURE, invert: false },
    // 「文章で足りる」ほど提案が不要になるため反転して平均に入れる
    { key: "gate::prose_suffices", instructions: GATE_PROSE, invert: true },
  ],
};

const TOOL_WIDE_INSTRUCTIONS =
  "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?";
const TOOL_RERANK_INSTRUCTIONS =
  "Exactly one of these skills documents the procedure for the action the assistant is about to take. Which one? Read what each actually does, not just its name.";
const GATE_ROUTINE_STEP =
  "Is this action a routine inspection step, such as listing, reading, or checking state, that any careful assistant would do without consulting a documented procedure?";

/**
 * PreToolUse 向け。プロンプト向けの gate 3 問は Bash 実行直前には自明に同じ答えになり
 * 判別力が無いため、「ただの確認作業か」を問う 1 問だけにする。
 */
export const TOOL_FRAMING: Framing = {
  wide: TOOL_WIDE_INSTRUCTIONS,
  rerank: TOOL_RERANK_INSTRUCTIONS,
  fits: (name, description) =>
    `Does the skill '${name}' actually cover the action the assistant is about to take, rather than a merely similar topic? It is described as: ${description}`,
  gates: [{ key: "gate::routine_step", instructions: GATE_ROUTINE_STEP, invert: true }],
};

function noulOf(answers: Record<string, Answer>, key: string): number {
  const answer = answers[key];
  if (answer === undefined || answer.type !== "noul") {
    throw new Error(`Jev did not answer the noul question '${key}'`);
  }
  return answer.noul;
}

function choiceOf(answers: Record<string, Answer>, key: string): ChoiceAnswer | undefined {
  const answer = answers[key];
  return answer !== undefined && answer.type === "choice" ? answer : undefined;
}

/**
 * Call 1。全件を description だけで浅く読み、
 * 同時に「そもそもスキルが要るターンか」を framing の gate で測る。
 */
function wideQuestions(
  roster: readonly RosterEntry[],
  framing: Framing,
): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of roster) criteria[entry.name] = entry.description;
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: framing.wide, criteria },
  };
  for (const gate of framing.gates) {
    questions[gate.key] = { type: "noul", instructions: gate.instructions };
  }
  return questions;
}

function rerankQuestions(
  candidates: readonly RosterEntry[],
  framing: Framing,
): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const entry of candidates) {
    criteria[entry.name] = `${entry.description} — ${entry.body.slice(0, EXCERPT_CHARS)}`;
  }
  const questions: Record<string, Question> = {
    which: { type: "choice", instructions: framing.rerank, criteria },
  };
  for (const entry of candidates) {
    questions[`fits::${entry.name}`] = {
      type: "noul",
      instructions: framing.fits(entry.name, entry.description),
    };
  }
  return questions;
}

function computeGate(answers: Record<string, Answer>, gates: readonly GateSpec[]): GateScores {
  const scores: Record<string, number> = {};
  let total = 0;
  for (const gate of gates) {
    const raw = noulOf(answers, gate.key);
    scores[gate.key] = raw;
    total += gate.invert ? 1 - raw : raw;
  }
  // gate が 0 問の framing は想定しないが、0 除算で NaN を混ぜないよう 0 を返す
  return { scores, mean: gates.length === 0 ? 0 : total / gates.length };
}

export async function suggest(
  prompt: string,
  roster: readonly RosterEntry[],
  options: JevOptions,
  framing: Framing = PROMPT_FRAMING,
): Promise<SuggestResult> {
  const startedAt = Date.now();
  const state = { request: prompt, recent_context: "" };

  const wide = await askSystemOne(state, wideQuestions(roster, framing), options);
  const wideWhich = choiceOf(wide.answers, "which");
  if (wideWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question (call 1)");
  }

  const gate = computeGate(wide.answers, framing.gates);

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

  if (candidates.length === 0) {
    throw new Error("Jev ranked no roster entry in call 1");
  }

  const rerank = await askSystemOne(
    state,
    rerankQuestions(
      candidates.map((candidate) => candidate.entry),
      framing,
    ),
    options,
  );
  const rerankWhich = choiceOf(rerank.answers, "which");
  if (rerankWhich === undefined) {
    throw new Error("Jev did not answer the 'which' choice question (call 2)");
  }
  const candidateNames = new Set(candidates.map((candidate) => candidate.entry.name));
  if (!candidateNames.has(rerankWhich.choice)) {
    throw new Error(`Jev chose '${rerankWhich.choice}' which is not in the shortlist`);
  }

  // fits は noulOf 内で必ず数値が返るか例外になるため、この時点では number 確定
  const rankedShortlist = candidates.map(({ entry, probability }) => ({
    name: entry.name,
    wideProbability: probability,
    rerankProbability: rerankWhich.probabilities[entry.name],
    fits: noulOf(rerank.answers, `fits::${entry.name}`),
  }));
  const shortlist: ShortlistItem[] = rankedShortlist;

  const maxFits = rankedShortlist.reduce((max, item) => Math.max(max, item.fits), 0);
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

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/pipeline.test.ts`

Expected: PASS（既存 8 件 + 追加 4 件 = 12 tests）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/hooks/lib/pipeline.ts` と `typesafe/hooks/lib/pipeline.test.ts` が変更（` M`）として出る

---

## Task 3: `roster.ts` — `agentHasSkillTool` によるサブエージェントの Skill ツール推定

設計書 6 章。既存のプラグイン解決関数（`enabledPluginKeys` / `installPathFor`）と `parseFrontmatter` を再利用し、新規ファイルは作らない。

**Files:**
- Modify: `typesafe/hooks/lib/roster.ts`
- Test: `typesafe/hooks/lib/roster.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `Frontmatter` に `tools?: string` を追加
  - `export function agentHasSkillTool(agentType: string, cwd: string, options?: DiscoverOptions): boolean`
  - Task 5（`suggest-skill.ts`）が import する

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/roster.test.ts` の import 行を差し替える。

変更前:
```ts
import { BODY_CHARS, discover, MAX_ENTRIES, parseFrontmatter } from "./roster.ts";
```

変更後:
```ts
import { agentHasSkillTool, BODY_CHARS, discover, MAX_ENTRIES, parseFrontmatter } from "./roster.ts";
```

そのうえで、ファイル末尾に次の `describe` ブロックを追記する。`writeAgent` ヘルパーも同じブロックの前に置く。

```ts
function writeAgent(agentsDir: string, fileName: string, frontmatter: string): void {
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${fileName}.md`), `---\n${frontmatter}\n---\n\nエージェント本文。\n`);
}

describe("agentHasSkillTool", () => {
  test("general-purpose は定義ファイルが無くても Skill あり", () => {
    const fixture = newFixture();
    expect(agentHasSkillTool("general-purpose", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("プラグインの agents/ を引き、tools に Skill があれば true", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(
      join(installPath, "agents"),
      "helper",
      "name: helper\ndescription: 手伝う\nmodel: sonnet\ntools: Read, Grep, Skill",
    );
    expect(agentHasSkillTool("demo:helper", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("プラグイン接頭辞が無い agent_type でも同じ定義に解決する", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(
      join(installPath, "agents"),
      "helper",
      "name: helper\ndescription: 手伝う\nmodel: sonnet\ntools: Read, Grep, Skill",
    );
    expect(agentHasSkillTool("helper", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("tools に Skill が無ければ false", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(
      join(installPath, "agents"),
      "reader",
      "name: reader\ndescription: 読むだけ\nmodel: sonnet\ntools: Read, Grep, Glob",
    );
    expect(agentHasSkillTool("demo:reader", fixture.cwd, { home: fixture.home })).toBe(false);
  });

  test("tools フィールドが無ければ全ツール扱いで true", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(join(installPath, "agents"), "free", "name: free\ndescription: 何でもする\nmodel: sonnet");
    expect(agentHasSkillTool("demo:free", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("tools: * は全ツール扱いで true", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(
      join(installPath, "agents"),
      "star",
      'name: star\ndescription: 何でもする\nmodel: sonnet\ntools: "*"',
    );
    expect(agentHasSkillTool("demo:star", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("tools が配列表記でも読む", () => {
    const fixture = singlePluginFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeAgent(
      join(installPath, "agents"),
      "bracket",
      'name: bracket\ndescription: 手伝う\nmodel: sonnet\ntools: [Read, "Skill"]',
    );
    expect(agentHasSkillTool("demo:bracket", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("定義ファイルが見つからなければ false", () => {
    const fixture = singlePluginFixture();
    expect(agentHasSkillTool("demo:missing", fixture.cwd, { home: fixture.home })).toBe(false);
  });

  test("組み込みエージェント名は定義が無いので false", () => {
    const fixture = newFixture();
    expect(agentHasSkillTool("Explore", fixture.cwd, { home: fixture.home })).toBe(false);
  });

  test("~/.claude/agents/ の定義を引く", () => {
    const fixture = newFixture();
    writeAgent(
      join(fixture.home, ".claude", "agents"),
      "user-agent",
      "name: user-agent\ndescription: ユーザー定義\nmodel: sonnet\ntools: Read, Skill",
    );
    expect(agentHasSkillTool("user-agent", fixture.cwd, { home: fixture.home })).toBe(true);
  });

  test("<cwd>/.claude/agents/ の定義を引く", () => {
    const fixture = newFixture();
    writeAgent(
      join(fixture.cwd, ".claude", "agents"),
      "proj-agent",
      "name: proj-agent\ndescription: プロジェクト定義\nmodel: sonnet\ntools: Read",
    );
    expect(agentHasSkillTool("proj-agent", fixture.cwd, { home: fixture.home })).toBe(false);
  });

  test("ファイル名と name が食い違う定義はフロントマターの name で解決する", () => {
    const fixture = newFixture();
    writeAgent(
      join(fixture.home, ".claude", "agents"),
      "01-renamed",
      "name: real-name\ndescription: 名前が違う\nmodel: sonnet\ntools: Read, Skill",
    );
    expect(agentHasSkillTool("real-name", fixture.cwd, { home: fixture.home })).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/roster.test.ts`

Expected: FAIL（`agentHasSkillTool` が export されていない）

- [ ] **Step 3: 最小実装を書く**

`typesafe/hooks/lib/roster.ts` に 3 か所手を入れる。

(a) `Frontmatter` 型に `tools` を足す。

変更前:
```ts
export type Frontmatter = {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
};
```

変更後:
```ts
export type Frontmatter = {
  name?: string;
  description?: string;
  /** エージェント定義の `tools:` の生の値。スキルには存在しない */
  tools?: string;
  disableModelInvocation: boolean;
};
```

(b) `parseFrontmatter` のキー振り分けに `tools` を足す。

変更前:
```ts
    if (key === "name") frontmatter.name = value;
    if (key === "description") frontmatter.description = value;
    if (key === "disable-model-invocation") frontmatter.disableModelInvocation = value === "true";
```

変更後:
```ts
    if (key === "name") frontmatter.name = value;
    if (key === "description") frontmatter.description = value;
    if (key === "tools") frontmatter.tools = value;
    if (key === "disable-model-invocation") frontmatter.disableModelInvocation = value === "true";
```

(c) ファイル末尾（`discover` の後）に次を追記する。

```ts
/** `tools:` の値を配列表記・カンマ区切りのどちらでも読む */
function parseToolList(raw: string): string[] {
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return inner
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter((item) => item !== "");
}

/** ディレクトリから `<name>.md` を、無ければフロントマターの name が一致する .md を探す */
function readAgentDefinition(dir: string, name: string): string | undefined {
  try {
    return readFileSync(join(dir, `${name}.md`), "utf8");
  } catch {
    // ファイル名とフロントマターの name が食い違う定義もあるため、総当たりへ落とす
  }
  let fileNames: string[];
  try {
    fileNames = readdirSync(dir).sort();
  } catch {
    return undefined;
  }
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".md")) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, fileName), "utf8");
    } catch {
      continue;
    }
    if (parseFrontmatter(text).frontmatter.name === name) return text;
  }
  return undefined;
}

/**
 * agent_type に対応する定義ファイルの中身を返す。
 * agent_type にプラグイン接頭辞が付く場合と付かない場合の両方を受けられるようにしてある。
 * 接頭辞があればそのプラグインだけを見る。
 */
function findAgentDefinition(agentType: string, cwd: string, home: string): string | undefined {
  const colon = agentType.indexOf(":");
  const pluginPrefix = colon === -1 ? undefined : agentType.slice(0, colon);
  const bare = colon === -1 ? agentType : agentType.slice(colon + 1);

  for (const key of enabledPluginKeys(cwd, home)) {
    const pluginName = key.split("@")[0] ?? key;
    if (pluginPrefix !== undefined && pluginName !== pluginPrefix) continue;
    const installPath = installPathFor(key, cwd, home);
    if (installPath === undefined) continue;
    const text = readAgentDefinition(join(installPath, "agents"), bare);
    if (text !== undefined) return text;
  }
  for (const dir of [join(home, ".claude", "agents"), join(cwd, ".claude", "agents")]) {
    const text = readAgentDefinition(dir, bare);
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * サブエージェント内で発火したとき、そのエージェントが Skill ツールを持つかを推定する。
 * hook の stdin にはツール一覧が渡らないため定義ファイルから逆算する。
 * 判定できないものは false に倒す。提案が出ないだけで作業は止まらない。
 */
export function agentHasSkillTool(
  agentType: string,
  cwd: string,
  options: DiscoverOptions = {},
): boolean {
  // general-purpose は定義ファイルを持たないが全ツールを持つことが実証済み
  if (agentType === "general-purpose") return true;
  const home = options.home ?? process.env["HOME"] ?? homedir();
  const text = findAgentDefinition(agentType, cwd, home);
  if (text === undefined) return false;
  const { frontmatter } = parseFrontmatter(text);
  const tools = frontmatter.tools;
  if (tools === undefined || tools === "") return true;
  const list = parseToolList(tools);
  if (list.includes("*")) return true;
  return list.includes("Skill");
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/roster.test.ts`

Expected: PASS（既存 22 件 + 追加 12 件 = 34 tests）

- [ ] **Step 5: Task 0 の採取結果と `agent_type` の表記を突き合わせる**

Task 0 Step 7 で記録した実物の `agent_type` が、接頭辞ありでも無しでも `findAgentDefinition` で解決できることを確認する。実物が両方の形のどちらとも違った場合（例: `agents/budgeted-investigator` のようなパス表記）は、`findAgentDefinition` の先頭で実物の表記を `pluginPrefix` / `bare` に分解する処理を足す。

- [ ] **Step 6: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/hooks/lib/roster.ts` と `typesafe/hooks/lib/roster.test.ts` が変更（` M`）として出る

---

## Task 4: `log.ts` — `event` / `tool_name` / `agent_type` の追加

設計書 8 章。Task 2 で `GateScores` の形が変わったため、既存テストの固定 key 参照もここで書き換える。

**Files:**
- Modify: `typesafe/hooks/lib/log.ts`
- Test: `typesafe/hooks/lib/log.test.ts`

**Interfaces:**
- Consumes: `GateScores` / `Outcome` / `ShortlistItem`（`pipeline.ts`、Task 2）
- Produces:
  - `export type HookEvent = "UserPromptSubmit" | "PreToolUse"`
  - `LogRecord` に `event: HookEvent`、`tool_name?: string`、`agent_type?: string` を追加
  - Task 5（`suggest-skill.ts`）が `HookEvent` を import する

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/hooks/lib/log.test.ts` の import 行を差し替える。

変更前:
```ts
import { append, LOG_FILE_NAME, type LogRecord } from "./log.ts";
```

変更後:
```ts
import { append, type HookEvent, LOG_FILE_NAME, type LogRecord } from "./log.ts";
```

次に `BASE` を、新しい `GateScores` の形と `event` を持つ形に書き換える。

変更前:
```ts
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
```

変更後:
```ts
const BASE: Omit<LogRecord, "ts"> = {
  session_id: "sess-1",
  cwd: "/Users/otto/workspace/mgzl-claude-code-plugin",
  event: "UserPromptSubmit",
  prompt: "この変更をコミットして",
  outcome: "suggested",
  winner: "mgzl:commiting-to-git",
  gate: {
    scores: {
      "gate::acts_on_user_system": 0.9,
      "gate::would_follow_documented_procedure": 0.8,
      "gate::prose_suffices": 0.1,
    },
    mean: 0.8666666666666667,
  },
  shortlist: [{ name: "mgzl:commiting-to-git", wideProbability: 0.7, rerankProbability: 0.9, fits: 0.95 }],
  rerankConfidence: 0.88,
  elapsedMs: 412,
  rosterSize: 48,
  error: undefined,
};
```

最後に、`describe("append", ...)` の閉じ括弧の直前に次を追記する。

```ts
  test("event を記録する", () => {
    const dataDir = join(root, "events");
    append(BASE, dataDir);
    const line = readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd();
    expect(JSON.parse(line).event).toBe("UserPromptSubmit");
  });

  test("PreToolUse では tool_name と agent_type も記録する", () => {
    const dataDir = join(root, "pretooluse");
    const event: HookEvent = "PreToolUse";
    append(
      {
        ...BASE,
        event,
        tool_name: "Bash",
        agent_type: "mgzl:budgeted-investigator",
        prompt:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        gate: { scores: { "gate::routine_step": 0.05 }, mean: 0.95 },
      },
      dataDir,
    );
    const record = JSON.parse(readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd());
    expect(record.event).toBe("PreToolUse");
    expect(record.tool_name).toBe("Bash");
    expect(record.agent_type).toBe("mgzl:budgeted-investigator");
    expect(record.gate).toEqual({ scores: { "gate::routine_step": 0.05 }, mean: 0.95 });
  });

  test("tool_name / agent_type を渡さなければキー自体が入らない", () => {
    const dataDir = join(root, "no-tool-fields");
    append(BASE, dataDir);
    const record = JSON.parse(readFileSync(join(dataDir, LOG_FILE_NAME), "utf8").trimEnd());
    expect("tool_name" in record).toBe(false);
    expect("agent_type" in record).toBe(false);
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/log.test.ts`

Expected: FAIL（`HookEvent` が export されていない、`event` が `LogRecord` に無い）

- [ ] **Step 3: 最小実装を書く**

`typesafe/hooks/lib/log.ts` の型定義を書き換える。

変更前:
```ts
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
```

変更後:
```ts
/** pipeline の 3 経路に、入口で打ち切った skipped と失敗した error を足したもの */
export type LogOutcome = Outcome | "skipped" | "error";

/** フックが発火したイベント。event を持たない既存レコードは UserPromptSubmit とみなす */
export type HookEvent = "UserPromptSubmit" | "PreToolUse";

export type LogRecord = {
  /** ISO 8601 */
  ts: string;
  session_id: string;
  cwd: string;
  event: HookEvent;
  /** PreToolUse のときのみ。"Bash" / "Agent" */
  tool_name?: string;
  /** サブエージェント内で発火したときのみ */
  agent_type?: string;
  /** UserPromptSubmit は依頼文の全文、PreToolUse は組み立て後の request 文 */
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
```

`append` の実装は変更しない。`JSON.stringify` は値が `undefined` のキーを落とすため、`tool_name` / `agent_type` を渡さなければ出力にキーは入らない。

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/log.test.ts`

Expected: PASS（既存 5 件 + 追加 3 件 = 8 tests）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/hooks/lib/log.ts` と `typesafe/hooks/lib/log.test.ts` が変更（` M`）として出る

---

## Task 5: `suggest-skill.ts` と `hooks.json` — PreToolUse の発火と注入

設計書 3 章・4 章・11 章。1 つのスクリプトを 2 イベントで使い回す。

**Files:**
- Modify: `typesafe/hooks/suggest-skill.ts`
- Modify: `typesafe/hooks/hooks.json`
- Test: `typesafe/hooks/suggest-skill.test.ts`
- Test: `typesafe/manifest.test.ts`

**Interfaces:**
- Consumes: `append` / `HookEvent`（Task 4）、`suggest` / `SuggestResult` / `TOOL_FRAMING`（Task 2）、`agentHasSkillTool` / `discover`（Task 3）、`buildToolRequest`（Task 1）
- Produces: hook の stdout 契約のみ。他の TypeScript ファイルから import されない

- [ ] **Step 1: 失敗するテストを書く（hooks.json のマニフェスト検証）**

`typesafe/manifest.test.ts` の `describe("typesafe のマニフェスト", ...)` の中、`marketplace.json` のテストの直前に次を追記する。

```ts
  test("hooks.json は PreToolUse に matcher Bash|Agent で suggest-skill.ts を登録する", async () => {
    const hooks = await readJson(join(PLUGIN_ROOT, "hooks", "hooks.json"));
    expect(hooks).toMatchObject({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Agent",
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
```

- [ ] **Step 2: 失敗するテストを書く（hook の挙動）**

`typesafe/hooks/suggest-skill.test.ts` に手を入れる。

まず `CALL1_SUGGESTED` などの定数の直後、`describe(...)` の直前に、PreToolUse 用の応答定数と fixture ヘルパーを追記する。

```ts
const TOOL_CALL1_SUGGESTED = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.9, probabilities: { demo: 0.9 } },
    "gate::routine_step": { type: "noul", noul: 0.05 },
  },
};

const TOOL_CALL1_GATE_QUIET = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.9, probabilities: { demo: 0.9 } },
    "gate::routine_step": { type: "noul", noul: 0.95 },
  },
};

const TOOL_CALL2_NO_FIT = {
  model: "test",
  answers: {
    which: { type: "choice", choice: "demo", confidence: 0.4, probabilities: { demo: 0.4 } },
    "fits::demo": { type: "noul", noul: 0.05 },
  },
};

/** roster に demo スキル 1 件と、agents/ にエージェント定義を持つ偽の HOME を作る */
function createAgentFixtureHome(agentFrontmatter: string, fileName = "helper"): string {
  const home = createFixtureHome();
  const agentsDir = join(home, ".claude", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, `${fileName}.md`),
    ["---", agentFrontmatter, "---", "", "エージェント本文。"].join("\n"),
  );
  return home;
}
```

次に、ファイル末尾の `describe("suggest-skill フック", ...)` の閉じ括弧の直前に、PreToolUse のテスト群を追記する。

```ts
  test("PreToolUse の Bash で 5 章の形の request を組み立てて送る", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-bash-"));
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
          cwd: home,
          session_id: "t1",
        },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      expect(result.exitCode).toBe(0);
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd(),
      );
      expect(record.event).toBe("PreToolUse");
      expect(record.tool_name).toBe("Bash");
      expect(record.prompt).toBe(
        'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
      );
    } finally {
      server.stop();
    }
  });

  test("PreToolUse の Agent は prompt を本体に使う", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-agent-"));
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: {
            description: "Write the plan",
            prompt: "設計書から実装計画を書いてください",
            subagent_type: "general-purpose",
          },
          cwd: home,
          session_id: "t2",
        },
        {
          TYPESAFE_API_KEY: "sk-test",
          TYPESAFE_BASE_URL: server.url,
          HOME: home,
          CLAUDE_PLUGIN_DATA: dataDir,
        },
      );
      const record = JSON.parse(
        readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd(),
      );
      expect(record.tool_name).toBe("Agent");
      expect(record.prompt).toBe(
        "The assistant is about to perform this action:\nWrite the plan\n設計書から実装計画を書いてください",
      );
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で提案ありなら PreToolUse の hookEventName で行為向けの文面を出す", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: "git commit" },
          cwd: home,
          session_id: "t3",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            "<skill_relevance>Relevant to the action you are about to take: demo. If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.</skill_relevance>",
        },
      });
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で gate_quiet なら stdout に何も出さない", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([TOOL_CALL1_GATE_QUIET]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "List files", command: "ls typesafe/hooks" },
          cwd: home,
          session_id: "t4",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
      expect(server.requestCount()).toBe(1);
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で no_fit なら stdout に何も出さない", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, TOOL_CALL2_NO_FIT]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Post to Slack", command: "curl -X POST https://slack.example" },
          cwd: home,
          session_id: "t5",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
      expect(server.requestCount()).toBe(2);
    } finally {
      server.stop();
    }
  });

  test("PreToolUse で command が無ければ skipped で API を呼ばない", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-nobody-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "何かする" },
        cwd: home,
        session_id: "t6",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
    expect(record.event).toBe("PreToolUse");
  });

  test("サブエージェント内で agent_type が general-purpose なら提案する", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit", command: "git commit" },
          cwd: home,
          session_id: "t7",
          agent_id: "agent-1",
          agent_type: "general-purpose",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Relevant to the action you are about to take: demo");
    } finally {
      server.stop();
    }
  });

  test("サブエージェントの tools に Skill があれば提案する", async () => {
    const home = createAgentFixtureHome(
      "name: helper\ndescription: 手伝う\nmodel: sonnet\ntools: Read, Grep, Skill",
    );
    const server = startFakeServer([TOOL_CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { description: "Commit", command: "git commit" },
          cwd: home,
          session_id: "t8",
          agent_id: "agent-2",
          agent_type: "helper",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Relevant to the action you are about to take: demo");
    } finally {
      server.stop();
    }
  });

  test("サブエージェントの tools に Skill が無ければ API を呼ばず skipped", async () => {
    const home = createAgentFixtureHome(
      "name: reader\ndescription: 読むだけ\nmodel: sonnet\ntools: Read, Grep",
      "reader",
    );
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-noskill-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t9",
        agent_id: "agent-3",
        agent_type: "reader",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
    expect(record.agent_type).toBe("reader");
  });

  test("サブエージェントの定義が見つからなければ API を呼ばず skipped", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-nodef-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t10",
        agent_id: "agent-4",
        agent_type: "Explore",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("skipped");
  });

  test("PreToolUse で API に到達できなくても無出力で exit 0、ログに event が残る", async () => {
    const home = createFixtureHome();
    const dataDir = mkdtempSync(join(tmpdir(), "suggest-skill-pretool-error-"));
    const result = await runHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { description: "Commit", command: "git commit" },
        cwd: home,
        session_id: "t11",
      },
      { ...UNREACHABLE, HOME: home, CLAUDE_PLUGIN_DATA: dataDir },
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(dataDir, "suggestions.jsonl"), "utf8").trimEnd());
    expect(record.outcome).toBe("error");
    expect(record.event).toBe("PreToolUse");
    expect(record.tool_name).toBe("Bash");
  });

  test("UserPromptSubmit の既存の挙動は変わらない（提案ありの文面と hookEventName）", async () => {
    const home = createFixtureHome();
    const server = startFakeServer([CALL1_SUGGESTED, CALL2_ANSWER]);
    try {
      const result = await runHook(
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "demo スキルを使って",
          cwd: home,
          session_id: "t12",
        },
        { TYPESAFE_API_KEY: "sk-test", TYPESAFE_BASE_URL: server.url, HOME: home },
      );
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "<skill_relevance>Relevant to the current request: demo. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>",
        },
      });
    } finally {
      server.stop();
    }
  });
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/manifest.test.ts`

Expected: FAIL（`hooks.json` に `PreToolUse` が無い）

- [ ] **Step 4: `hooks.json` を書く**

`typesafe/hooks/hooks.json` を次の内容に置き換える。

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
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Agent",
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

- [ ] **Step 5: マニフェストのテストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/manifest.test.ts`

Expected: PASS（既存 3 件 + 追加 1 件 = 4 tests）

- [ ] **Step 6: hook のテストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/suggest-skill.test.ts`

Expected: FAIL（PreToolUse の stdin が UserPromptSubmit として扱われ、`prompt` が空なので `skipped` になる）

- [ ] **Step 7: `suggest-skill.ts` を書く**

`typesafe/hooks/suggest-skill.ts` を次の内容に置き換える（ファイル全文）。

```ts
import { append, type HookEvent } from "./lib/log.ts";
import { type SuggestResult, suggest, TOOL_FRAMING } from "./lib/pipeline.ts";
import { buildToolRequest } from "./lib/request.ts";
import { agentHasSkillTool, discover } from "./lib/roster.ts";

const SUGGESTED_PREFIX = "Relevant to the current request: ";
const SUGGESTED_SUFFIX =
  ". Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.";
const NO_SUGGESTION =
  "No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.";
const TOOL_SUGGESTED_PREFIX = "Relevant to the action you are about to take: ";
const TOOL_SUGGESTED_SUFFIX =
  ". If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.";

type Payload = {
  event: HookEvent;
  prompt: string;
  cwd: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  agentId: string;
  agentType: string;
};

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
  const toolInput = parsed["tool_input"];
  return {
    // 既知の値以外は既存の挙動に倒す
    event: readString(parsed, "hook_event_name") === "PreToolUse" ? "PreToolUse" : "UserPromptSubmit",
    prompt: readString(parsed, "prompt"),
    cwd: cwd === "" ? process.cwd() : cwd,
    sessionId: readString(parsed, "session_id"),
    toolName: readString(parsed, "tool_name"),
    toolInput: isRecord(toolInput) ? toolInput : {},
    agentId: readString(parsed, "agent_id"),
    agentType: readString(parsed, "agent_type"),
  };
}

/** ログの共通部分。PreToolUse のときだけ tool_name / agent_type を載せる */
function recordBase(payload: Payload): {
  session_id: string;
  cwd: string;
  event: HookEvent;
  tool_name?: string;
  agent_type?: string;
} {
  return {
    session_id: payload.sessionId,
    cwd: payload.cwd,
    event: payload.event,
    tool_name: payload.event === "PreToolUse" ? payload.toolName : undefined,
    agent_type: payload.agentType === "" ? undefined : payload.agentType,
  };
}

function additionalContext(result: SuggestResult): string | undefined {
  if (result.outcome === "suggested") {
    if (result.winner === null) {
      // pipeline.ts の型上は string | null だが、"suggested" は常に choice の結果を積む契約
      throw new Error("suggest returned outcome 'suggested' without a winner");
    }
    return `<skill_relevance>${SUGGESTED_PREFIX}${result.winner}${SUGGESTED_SUFFIX}</skill_relevance>`;
  }
  if (result.outcome === "gate_quiet" || result.outcome === "no_fit") {
    return `<skill_relevance>${NO_SUGGESTION}</skill_relevance>`;
  }
  return undefined;
}

/** PreToolUse では「該当なし」を出さない。Bash のたびに注入されるとノイズになるため */
function toolAdditionalContext(result: SuggestResult): string | undefined {
  if (result.outcome !== "suggested") return undefined;
  if (result.winner === null) {
    throw new Error("suggest returned outcome 'suggested' without a winner");
  }
  return `<skill_relevance>${TOOL_SUGGESTED_PREFIX}${result.winner}${TOOL_SUGGESTED_SUFFIX}</skill_relevance>`;
}

function emit(event: HookEvent, context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: context },
    }),
  );
}

function logSkipped(payload: Payload, rosterSize: number, prompt: string): void {
  append({
    ...recordBase(payload),
    prompt,
    outcome: "skipped",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize,
  });
}

// main の進行に応じて更新し、途中で失敗しても catch 側でエラーログに payload / rosterSize / request を残せるようにする
let currentPayload: Payload | undefined;
let currentRosterSize = 0;
let currentRequest = "";

async function runUserPromptSubmit(payload: Payload, apiKey: string): Promise<void> {
  // 明示的なスキル呼び出し（/ 始まり）には提案が不要
  if (payload.prompt === "" || payload.prompt.startsWith("/")) {
    logSkipped(payload, 0, payload.prompt);
    return;
  }
  currentRequest = payload.prompt;

  const roster = discover(payload.cwd);
  currentRosterSize = roster.length;
  if (roster.length === 0) {
    logSkipped(payload, 0, payload.prompt);
    return;
  }

  const result = await suggest(payload.prompt, roster, { apiKey });
  const context = additionalContext(result);
  if (context !== undefined) emit(payload.event, context);

  append({
    ...recordBase(payload),
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

async function runPreToolUse(payload: Payload, apiKey: string): Promise<void> {
  // サブエージェント内での発火は、Skill ツールを持たないと推定したら API を呼ばずに終わる
  if (payload.agentId !== "" && !agentHasSkillTool(payload.agentType, payload.cwd)) {
    logSkipped(payload, 0, "");
    return;
  }

  const request = buildToolRequest({ toolName: payload.toolName, toolInput: payload.toolInput });
  if (request === undefined) {
    logSkipped(payload, 0, "");
    return;
  }
  currentRequest = request;

  const roster = discover(payload.cwd);
  currentRosterSize = roster.length;
  if (roster.length === 0) {
    logSkipped(payload, 0, request);
    return;
  }

  const result = await suggest(request, roster, { apiKey }, TOOL_FRAMING);
  const context = toolAdditionalContext(result);
  if (context !== undefined) emit(payload.event, context);

  append({
    ...recordBase(payload),
    prompt: request,
    outcome: result.outcome,
    winner: result.winner,
    gate: result.gate,
    shortlist: result.shortlist,
    rerankConfidence: result.rerankConfidence,
    elapsedMs: result.elapsedMs,
    rosterSize: roster.length,
  });
}

async function main(): Promise<void> {
  const payload = parsePayload(await Bun.stdin.text());
  currentPayload = payload;
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  // キー未設定は機能そのものが無効なので、stdin が壊れていても含めて記録すら残さない
  if (apiKey === "") return;
  if (payload === undefined) {
    // stdin が壊れていて payload が組み立てられない場合も、記録だけは残す（キー設定時のみ）
    append({
      session_id: "",
      cwd: "",
      event: "UserPromptSubmit",
      prompt: "",
      outcome: "error",
      winner: null,
      gate: null,
      shortlist: [],
      elapsedMs: 0,
      rosterSize: 0,
      error: "malformed stdin payload",
    });
    return;
  }

  if (payload.event === "PreToolUse") {
    await runPreToolUse(payload, apiKey);
    return;
  }
  await runUserPromptSubmit(payload, apiKey);
}

try {
  await main();
} catch (e) {
  // 提案の失敗でユーザーのターンを止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`typesafe suggest-skill: ${message}\n`);
  append({
    session_id: currentPayload?.sessionId ?? "",
    cwd: currentPayload?.cwd ?? process.cwd(),
    event: currentPayload?.event ?? "UserPromptSubmit",
    tool_name:
      currentPayload?.event === "PreToolUse" ? currentPayload.toolName : undefined,
    agent_type:
      currentPayload === undefined || currentPayload.agentType === ""
        ? undefined
        : currentPayload.agentType,
    prompt: currentRequest,
    outcome: "error",
    winner: null,
    gate: null,
    shortlist: [],
    elapsedMs: 0,
    rosterSize: currentRosterSize,
    error: message,
  });
}
process.exit(0);
```

- [ ] **Step 8: hook のテストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/suggest-skill.test.ts`

Expected: PASS（既存 9 件 + 追加 12 件 = 21 tests）

`startFakeServer` を使うテストは、Claude Code の Bash サンドボックス内ではポートを bind できず `EADDRINUSE` で落ちる。README に既に記載のある既知の事象なので、サンドボックス内で実行している場合はその 2 種類の失敗だけは許容し、それ以外が通ることを確認する。

- [ ] **Step 9: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/hooks/suggest-skill.ts` / `typesafe/hooks/suggest-skill.test.ts` / `typesafe/hooks/hooks.json` / `typesafe/manifest.test.ts` が変更（` M`）として出る

---

## Task 6: `eval/` — ツール向けケースの追加と `event` 別の内訳

設計書 9 章。`run.ts` は `request.ts` の `buildToolRequest` を hook と共有する。

**Files:**
- Modify: `typesafe/eval/run.ts`
- Modify: `typesafe/eval/golden.json`
- Test: `typesafe/eval/run.test.ts`

**Interfaces:**
- Consumes: `buildToolRequest`（Task 1）、`suggest` / `PROMPT_FRAMING` / `TOOL_FRAMING`（Task 2）、`HookEvent`（Task 4）、`discover`（Task 3）
- Produces: `GoldenCase` に `toolName?` / `toolInput?` を、`EvalRow` に `event` を追加。CLI 出力に `event=…` 行を追加

- [ ] **Step 1: 失敗するテストを書く**

`typesafe/eval/run.test.ts` の import 行を差し替える。

変更前:
```ts
import { buildReport, type EvalRow, type GoldenCase, parseArgs, readGolden } from "./run.ts";
```

変更後:
```ts
import { buildReport, type EvalRow, parseArgs, readGolden } from "./run.ts";
```

次に、既存の `ROWS` の各要素に `event` を足す。

変更前:
```ts
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
```

変更後:
```ts
const ROWS: EvalRow[] = [
  {
    request: "今の変更をコミットして",
    expected: "mgzl:commiting-to-git",
    winner: "mgzl:commiting-to-git",
    event: "UserPromptSubmit",
    gateMean: 0.82,
    maxFits: 0.91,
  },
  {
    request: "このプロジェクトの AutoMemory を棚卸しして",
    expected: "mgzl:audit-memory",
    winner: "fading-memory:maintain",
    event: "UserPromptSubmit",
    gateMean: 0.71,
    maxFits: 0.55,
  },
  {
    request: "モナドとは何ですか",
    expected: null,
    winner: null,
    event: "UserPromptSubmit",
    gateMean: 0.12,
    maxFits: 0,
  },
  {
    request: "Slack のチャンネルにこの結果を投稿して",
    expected: null,
    winner: "mgzl:create-issue",
    event: "UserPromptSubmit",
    gateMean: 0.64,
    maxFits: 0.41,
  },
];
```

同様に、`buildReport` の他のテスト内に直接書かれている行オブジェクトにも `event: "UserPromptSubmit"` を足す。該当は 4 か所ある。

1. 「該当ありで何も提案しなかった場合も誤りとして数える」の 1 行
2. 「request は先頭 60 文字に切り詰める」の 1 行
3. 「該当なしで例外になった場合は…」の 1 行
4. 「該当ありで例外になった場合は…」の 1 行

いずれも `expected` の次の行に `event: "UserPromptSubmit",` を挿入する。たとえば 1 は次のようになる。

```ts
    const report = buildReport([
      {
        request: "今の変更をコミットして",
        expected: "mgzl:commiting-to-git",
        winner: null,
        event: "UserPromptSubmit",
        gateMean: 0.2,
        maxFits: 0,
      },
    ]);
```

次に、`describe("readGolden", ...)` の中身を差し替える。

変更前:
```ts
describe("readGolden", () => {
  test("正常なエントリはそのまま読む", () => {
    expect(readGolden([{ request: "a", expected: "x" }, { request: "b", expected: null }])).toEqual([
      { request: "a", expected: "x" },
      { request: "b", expected: null },
    ]);
  });

  test("配列でなければ例外にする", () => {
    expect(() => readGolden({})).toThrow("golden must be an array");
  });

  test("不正なエントリがあれば index 付きで例外にする", () => {
    expect(() => readGolden([{ request: "a", expected: "x" }, { request: "b" }])).toThrow(
      "golden.json entry 1 is malformed",
    );
  });

  test("ファイルから読んでも不正なエントリで例外にする", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typesafe-golden-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify([{ request: "a", expected: "x" }, { expected: "y" }]));
    const parsed: unknown = JSON.parse(await Bun.file(path).text());
    expect(() => readGolden(parsed)).toThrow("golden.json entry 1 is malformed");
  });
});
```

変更後:
```ts
describe("readGolden", () => {
  test("プロンプト向けのエントリはそのまま読む", () => {
    expect(readGolden([{ request: "a", expected: "x" }, { request: "b", expected: null }])).toEqual([
      { request: "a", expected: "x", event: "UserPromptSubmit" },
      { request: "b", expected: null, event: "UserPromptSubmit" },
    ]);
  });

  test("tool_name 付きのエントリは request を組み立てて PreToolUse にする", () => {
    expect(
      readGolden([
        {
          tool_name: "Bash",
          tool_input: { description: "Commit the staged changes", command: 'git commit -m "fix: x"' },
          expected: "mgzl:commiting-to-git",
        },
      ]),
    ).toEqual([
      {
        request:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        expected: "mgzl:commiting-to-git",
        event: "PreToolUse",
      },
    ]);
  });

  test("配列でなければ例外にする", () => {
    expect(() => readGolden({})).toThrow("golden must be an array");
  });

  test("request も tool_name も無ければ index 付きで例外にする", () => {
    expect(() => readGolden([{ request: "a", expected: "x" }, { expected: null }])).toThrow(
      "golden.json entry 1 is malformed",
    );
  });

  test("tool_input から request を組み立てられなければ index 付きで例外にする", () => {
    expect(() =>
      readGolden([{ tool_name: "Bash", tool_input: { description: "x" }, expected: null }]),
    ).toThrow("golden.json entry 0 is malformed");
  });

  test("ファイルから読んでも不正なエントリで例外にする", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typesafe-golden-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify([{ request: "a", expected: "x" }, { expected: "y" }]));
    const parsed: unknown = JSON.parse(await Bun.file(path).text());
    expect(() => readGolden(parsed)).toThrow("golden.json entry 1 is malformed");
  });
});
```

続いて `describe("buildReport", ...)` の閉じ括弧の直前に、内訳のテストを追記する。

```ts
  test("event 別の内訳を出す", () => {
    const report = buildReport([
      ...ROWS,
      {
        request:
          'The assistant is about to perform this action:\nCommit the staged changes\ngit commit -m "fix: x"',
        expected: "mgzl:commiting-to-git",
        winner: "mgzl:commiting-to-git",
        event: "PreToolUse",
        gateMean: 0.95,
        maxFits: 0.88,
      },
      {
        request: "The assistant is about to perform this action:\nList files\nls typesafe/hooks",
        expected: null,
        winner: "mgzl:investigate-budgeted",
        event: "PreToolUse",
        gateMean: 0.4,
        maxFits: 0.35,
      },
    ]);
    expect(report).toContain(
      "event=UserPromptSubmit total=4 with_skill=2 without_skill=2 errors=0 wrong_suggestion_rate=0.500 unneeded_suggestion_rate=0.500",
    );
    expect(report).toContain(
      "event=PreToolUse total=2 with_skill=1 without_skill=1 errors=0 wrong_suggestion_rate=0.000 unneeded_suggestion_rate=1.000",
    );
  });
```

最後に `describe("golden.json", ...)` を差し替える。

変更前:
```ts
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

変更後:
```ts
describe("golden.json", () => {
  test("40 件で、プロンプト向け 30 件（20/10）とツール向け 10 件（5/5）", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    const cases = readGolden(parsed);
    expect(cases).toHaveLength(40);

    const prompts = cases.filter((c) => c.event === "UserPromptSubmit");
    expect(prompts).toHaveLength(30);
    expect(prompts.filter((c) => c.expected !== null)).toHaveLength(20);
    expect(prompts.filter((c) => c.expected === null)).toHaveLength(10);

    const tools = cases.filter((c) => c.event === "PreToolUse");
    expect(tools).toHaveLength(10);
    expect(tools.filter((c) => c.expected !== null)).toHaveLength(5);
    expect(tools.filter((c) => c.expected === null)).toHaveLength(5);
  });

  test("ツール向けケースの request は行為向けの前置きで始まる", async () => {
    const parsed: unknown = JSON.parse(
      await Bun.file(join(import.meta.dir, "golden.json")).text(),
    );
    for (const item of readGolden(parsed).filter((c) => c.event === "PreToolUse")) {
      expect(item.request.startsWith("The assistant is about to perform this action:\n")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/eval/run.test.ts`

Expected: FAIL（`EvalRow` に `event` が無い、`readGolden` が `event` を付けない）

- [ ] **Step 3: `golden.json` にツール向け 10 件を追記する**

`typesafe/eval/golden.json` の末尾の `]` の直前、最後の要素 `{ "request": "Slack のチャンネルにこの結果を投稿して", "expected": null }` の後ろにカンマを足して次を追記する。

```json
  { "tool_name": "Bash", "tool_input": { "description": "Commit the staged changes", "command": "git commit -m \"fix: suggest-skill で PreToolUse を扱う\"" }, "expected": "mgzl:commiting-to-git" },
  { "tool_name": "Bash", "tool_input": { "description": "Open an issue for the plugin bug", "command": "gh issue create --repo megazalrock/mgzl-claude-code-plugin --title \"typesafe: PreToolUse で提案が二重に出る\" --body \"...\"" }, "expected": "mgzl:create-issue" },
  { "tool_name": "Bash", "tool_input": { "description": "Create an isolated worktree for this feature", "command": "git worktree add ../mgzl-typesafe-pretooluse -b feat/typesafe-pretooluse" }, "expected": "superpowers:using-git-worktrees" },
  { "tool_name": "Agent", "tool_input": { "description": "Write the implementation plan", "prompt": "docs/superpowers/specs/2026-09-18-typesafe-pretooluse-suggestion-design.md を読んで、設計書に対応する実装計画書を 1 ファイル書いてください。", "subagent_type": "general-purpose" }, "expected": "superpowers:writing-plans" },
  { "tool_name": "Agent", "tool_input": { "description": "Send the review findings to triage", "prompt": "このブランチの差分に対するレビュー結果をまとめて、人間にトリアージを依頼してください。", "subagent_type": "general-purpose" }, "expected": "reviewview:reviewview-prepare" },
  { "tool_name": "Bash", "tool_input": { "description": "List files in the hooks directory", "command": "ls typesafe/hooks" }, "expected": null },
  { "tool_name": "Bash", "tool_input": { "description": "Read the plugin README", "command": "cat typesafe/README.md" }, "expected": null },
  { "tool_name": "Bash", "tool_input": { "description": "Find where the gate threshold is defined", "command": "grep -rn \"GATE_THRESHOLD\" typesafe" }, "expected": null },
  { "tool_name": "Bash", "tool_input": { "description": "Check the working tree status", "command": "git status --short" }, "expected": null },
  { "tool_name": "Bash", "tool_input": { "description": "Post the result to Slack", "command": "curl -X POST -H \"Content-type: application/json\" --data '{\"text\":\"done\"}' https://hooks.slack.com/services/XXX" }, "expected": null }
```

- [ ] **Step 4: `run.ts` を書く**

`typesafe/eval/run.ts` を次の内容に置き換える（ファイル全文）。

```ts
import { join } from "node:path";
import type { HookEvent } from "../hooks/lib/log.ts";
import { PROMPT_FRAMING, suggest, TOOL_FRAMING } from "../hooks/lib/pipeline.ts";
import { buildToolRequest } from "../hooks/lib/request.ts";
import { discover } from "../hooks/lib/roster.ts";

export type GoldenCase = {
  /** ツール向けケースでは buildToolRequest が組み立てた行為の記述が入る */
  request: string;
  expected: string | null;
  event: HookEvent;
};

export type EvalRow = {
  request: string;
  expected: string | null;
  winner: string | null;
  event: HookEvent;
  /** gate の平均 */
  gateMean: number;
  /** ショートリスト内の fits の最大値。提案なしのときは 0 */
  maxFits: number;
  /** suggest が例外を投げたケースのメッセージ。正常終了時は undefined */
  error?: string;
};

export type Args = { cwd: string; golden: string; concurrency: number };

const BAND_COUNT = 10;
const REQUEST_HEAD = 60;
const EVENTS: readonly HookEvent[] = ["UserPromptSubmit", "PreToolUse"];

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
    if (flag === "--concurrency") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) throw new Error(`--concurrency must be a number, got '${value}'`);
      concurrency = parsed;
    }
  }
  if (cwd === undefined) throw new Error("--cwd is required");
  return { cwd, golden, concurrency };
}

/** error があるケースは winner が null でも「たまたま expected: null と一致した」扱いにしない */
function isCorrect(row: EvalRow): boolean {
  return row.error === undefined && row.winner === row.expected;
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

/** 件数と 2 つの誤り率をまとめた key=value 断片。全体にも event 別にも使う */
function counts(rows: readonly EvalRow[]): string {
  const withSkill = rows.filter((row) => row.expected !== null);
  const withoutSkill = rows.filter((row) => row.expected === null);
  const errored = rows.filter((row) => row.error !== undefined);
  // 例外になった行は「合っていた/間違っていた」を判定できないため、両方の率の分母・分子から除外する
  const withSkillNoError = withSkill.filter((row) => row.error === undefined);
  const withoutSkillNoError = withoutSkill.filter((row) => row.error === undefined);
  const wrong = withSkillNoError.filter((row) => row.winner !== row.expected);
  const unneeded = withoutSkillNoError.filter((row) => row.winner !== null);
  return [
    `total=${rows.length}`,
    `with_skill=${withSkill.length}`,
    `without_skill=${withoutSkill.length}`,
    `errors=${errored.length}`,
    `wrong_suggestion_rate=${rate(wrong.length, withSkillNoError.length)}`,
    `unneeded_suggestion_rate=${rate(unneeded.length, withoutSkillNoError.length)}`,
  ].join(" ");
}

/** 集計結果を key=value の簡素形式で組み立てる */
export function buildReport(rows: readonly EvalRow[]): string {
  const lines: string[] = counts(rows).split(" ");

  for (const event of EVENTS) {
    const inEvent = rows.filter((row) => row.event === event);
    if (inEvent.length === 0) continue;
    lines.push(`event=${event} ${counts(inEvent)}`);
  }

  // error があった行は fits を持たないため帯の分母から除外する
  const suggested = rows.filter((row) => row.winner !== null && row.error === undefined);
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
    const errorSuffix = row.error === undefined ? "" : ` error="${row.error}"`;
    lines.push(
      `mismatch event=${row.event} request="${row.request.slice(0, REQUEST_HEAD)}" expected=${row.expected ?? "null"} winner=${row.winner ?? "null"} gate=${row.gateMean.toFixed(2)} fits=${row.maxFits.toFixed(2)}${errorSuffix}`,
    );
  }

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExpected(item: Record<string, unknown>): string | null | undefined {
  if (!("expected" in item)) return undefined;
  const expected = item["expected"];
  if (typeof expected === "string" || expected === null) return expected;
  return undefined;
}

export function readGolden(parsed: unknown): GoldenCase[] {
  if (!Array.isArray(parsed)) throw new Error("golden must be an array");
  return parsed.map((item, index) => {
    const malformed = new Error(`golden.json entry ${index} is malformed`);
    if (!isRecord(item)) throw malformed;
    const expected = readExpected(item);
    if (expected === undefined) throw malformed;

    const toolName = item["tool_name"];
    if (typeof toolName === "string") {
      const toolInput = item["tool_input"];
      if (!isRecord(toolInput)) throw malformed;
      const request = buildToolRequest({ toolName, toolInput });
      if (request === undefined) throw malformed;
      return { request, expected, event: "PreToolUse" };
    }

    const request = item["request"];
    if (typeof request !== "string") throw malformed;
    return { request, expected, event: "UserPromptSubmit" };
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
      const framing = item.event === "PreToolUse" ? TOOL_FRAMING : PROMPT_FRAMING;
      try {
        const result = await suggest(item.request, roster, { apiKey }, framing);
        rows[index] = {
          request: item.request,
          expected: item.expected,
          winner: result.winner,
          event: item.event,
          gateMean: result.gate.mean,
          maxFits: result.shortlist.reduce((max, entry) => Math.max(max, entry.fits ?? 0), 0),
        };
      } catch (error) {
        // Jev が回答を欠いた・ショートリスト外を選んだ等で suggest が例外を投げても、
        // 1 件のケースの失敗として記録し、他のケースの評価は続行する
        rows[index] = {
          request: item.request,
          expected: item.expected,
          winner: null,
          event: item.event,
          gateMean: 0,
          maxFits: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
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

- [ ] **Step 5: `mismatch` の期待値に `event=` を足す**

`buildReport` の出力の `mismatch` 行に `event=` を追加したため、`run.test.ts` の既存の期待値を書き換える。規則は 1 つで、期待値文字列の中の `mismatch request="` を `mismatch event=UserPromptSubmit request="` に置き換える。該当は次の 6 か所。

- 59 行目付近: `'mismatch request="このプロジェクトの AutoMemory を棚卸しして" …'`
- 62 行目付近: `'mismatch request="Slack のチャンネルにこの結果を投稿して" expected=null winner=mgzl:create-issue …'`
- 77 行目付近: `'mismatch request="今の変更をコミットして" expected=mgzl:commiting-to-git winner=null gate=0.20 fits=0.00'`
- 85 行目付近: `` `mismatch request="${"あ".repeat(60)}"` `` → `` `mismatch event=UserPromptSubmit request="${"あ".repeat(60)}"` ``
- 103 行目付近: `'mismatch request="Slack のチャンネルにこの結果を投稿して" … error="Jev did not answer …"'`
- 126 行目付近: `'mismatch request="今の変更をコミットして" … error="roster is empty"'`

置換後は確認する。

Run: `grep -c 'mismatch event=UserPromptSubmit request=' /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/eval/run.test.ts`

Expected: `6`

- [ ] **Step 6: テストを実行して成功を確認する**

Run: `bun test /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/eval/run.test.ts`

Expected: PASS（`buildReport` 8 件 + `parseArgs` 4 件 + `readGolden` 6 件 + `golden.json` 2 件 = 20 tests）

- [ ] **Step 7: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: `typesafe/eval/run.ts` / `typesafe/eval/run.test.ts` / `typesafe/eval/golden.json` が変更（` M`）として出る

---

## Task 7: `README.md` の更新

設計書 13 章（および 12 章の既知の制約）。

**Files:**
- Modify: `typesafe/README.md`

**Interfaces:**
- Consumes: Task 1〜6 の成果すべて
- Produces: なし

- [ ] **Step 1: 冒頭の説明を 2 つの発火点に書き換える**

変更前:
```markdown
# typesafe

`UserPromptSubmit` フックで TypeSafe の System One モデル Jev にスキル選択を問い合わせ、そのターンに関係するスキル 1 件を提案として注入するプラグインである。

## 何をするか

ユーザーが 1 ターン送るたびに、次の 2 リクエストを Jev に投げる。
```

変更後:
```markdown
# typesafe

TypeSafe の System One モデル Jev にスキル選択を問い合わせ、関係するスキル 1 件を提案として注入するプラグインである。発火点は 2 つある。

- `UserPromptSubmit`（ユーザーのプロンプト送信時）: 依頼文を材料に、そのターンの進め方を決めるスキルを提案する
- `PreToolUse`（matcher `Bash|Agent`、ツール呼び出しの直前）: これから取る行為を材料に、その行為を手順化したスキルを提案する

スキルの支援が本当に要るのは作業の途中である。「バグを直して」と依頼された後、調査が進んでコミットが必要になった瞬間にはプロンプト時点の提案は届いていない。`PreToolUse` はその穴を埋める。対象を Bash と Agent に絞るのは、git 操作・テスト実行・gh 操作・サブエージェント起動が「スキルが手順を持っていそうな行為」でありながら、実装中でもターンあたり数回に収まるためである。Edit / Write は実装中に連発するので対象外にしてある。`PreToolUse` の command hook はタイムアウトしてもツール呼び出しをブロックしない。

## 何をするか（UserPromptSubmit）

ユーザーが 1 ターン送るたびに、次の 2 リクエストを Jev に投げる。
```

- [ ] **Step 2: PreToolUse の節を追記する**

「提案は『合わなければ無視してよい』文面に留めてある。…」で終わる段落の直後、`## 環境変数` の直前に次を挿入する（外側の囲みは計画書上の区切りなので、README には内側の内容だけを入れる）。

````markdown
## 何をするか（PreToolUse）

Bash または Agent を呼ぶ直前に、これから取る行為を次の形の request 文にして Jev へ渡す。

```
The assistant is about to perform this action:
<tool_input.description>
<Bash は tool_input.command / Agent は tool_input.prompt>
```

本体は 2000 文字（`TOOL_INPUT_CHARS`）で切り詰める。`description` が無ければその行を省く。本体も取れない場合は request を組み立てられないので `skipped` として終わる。

判定の枠組み（framing）はプロンプト向けと別である。Call 1 の gate は 1 問だけで、`gate::routine_step`「これは ls / cat / git status のような、手順書を引くまでもない定型の確認作業か」を問い、`invert: true` で反転してから平均に入れる。プロンプト向けの gate 3 問（ファイル操作か・手順書を引くか・文章で足りるか）は Bash 実行直前には自明に同じ答えになり判別力が無いため使わない。閾値 `GATE_THRESHOLD = 0.30` / `FITS_THRESHOLD = 0.30` はプロンプト向けと共通である。

**`PreToolUse` では「該当なし」を注入しない。** `outcome` が `suggested` のときだけ出力する。Bash を呼ぶたびに「該当なし」の 1 文が入るのはノイズにしかならないためである。

提案あり:

```
<skill_relevance>Relevant to the action you are about to take: mgzl:commiting-to-git. If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.</skill_relevance>
```

### サブエージェント内での発火

hook の stdin にはサブエージェントのツール一覧が渡らない。`agent_id` があり（= サブエージェント内で発火した）、かつ次の推定で Skill ツールを持たないと判断した場合は、API を呼ばずに `skipped` で終える。

1. `agent_type` が `general-purpose` → Skill あり（全ツールを持つことが実証済み）
2. `agent_type` に対応する定義ファイルが見つかる → フロントマターの `tools:` を読む
   - `tools:` が無い、または `tools: *` → Skill あり
   - `tools:` に `Skill` が含まれる → Skill あり
   - それ以外 → Skill なし（`tools:` の許可リストは列挙外のツールを完全に剥奪する）
3. それ以外（`Explore` / `Plan` / `claude-code-guide` 等の組み込み、定義が見つからないもの） → Skill なし

定義ファイルの探索先は roster と同じ 3 系統で、有効プラグインの `installPath/agents/*.md`、`~/.claude/agents/*.md`、`<cwd>/.claude/agents/*.md` である。`<agent_type>.md` を先に見て、無ければディレクトリ内の `*.md` からフロントマターの `name` が一致するものを探す。`agent_type` にプラグイン接頭辞（`mgzl:` など）が付く場合はそのプラグインだけを見る。

**組み込みエージェントのうち Skill あり扱いは `general-purpose` のみ**で、`Explore` / `Plan` などの内部では提案されない。
````

- [ ] **Step 3: 既知の制約に PreToolUse 固有のものを足す**

「### 既知の制約」の箇条書きの末尾に次を追記する。

```markdown
- `tool_input`（Bash のコマンド文字列、Agent の prompt）が TypeSafe の API へ送られる。依頼文だけでなく実行しようとしているコマンドそのものが外に出るため、機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を設定しないことで無効化する
- 同じ提案がセッション内で繰り返される（git status → diff → add → commit で 4 回など）。文面が「合わなければ無視」なので害は注入文字数だけである。重複の抑制はログの重複率を見てから判断する
- `agent_type` の表記が Claude Code の内部仕様で変わると推定が外れ、サブエージェント内で一律 `skipped` になる。フェイルオープンなので作業は止まらないが提案は消える
- Bash の `description` は Claude が書く任意の文で、省略されることがある。その場合は `command` だけが材料になり精度が落ちる
- ツール向けの閾値は eval のツール向けケースで調整するが、ケースは手書きで件数が少ない。運用ログを見て追加する
```

- [ ] **Step 4: ログの節にフィールドを足す**

変更前:
```markdown
`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions.jsonl` に 1 行 1 JSON で追記する。未設定なら何も書かない。`TYPESAFE_API_KEY` が未設定のときも機能そのものが無効なので、`skipped` を含めて一切記録しない。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`prompt`（全文）、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`rerankConfidence`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。ログは追記専用でローテーションは無い。
```

変更後:
```markdown
`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions.jsonl` に 1 行 1 JSON で追記する。未設定なら何も書かない。`TYPESAFE_API_KEY` が未設定のときも機能そのものが無効なので、`skipped` を含めて一切記録しない。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`event`（`UserPromptSubmit` / `PreToolUse`）、`tool_name`（`PreToolUse` のときのみ。`Bash` / `Agent`）、`agent_type`（サブエージェント内で発火したときのみ）、`prompt`、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`rerankConfidence`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。ログは追記専用でローテーションは無い。

`prompt` には `UserPromptSubmit` なら依頼文の全文が、`PreToolUse` なら組み立て後の request 文が入る。`gate` は `{ scores: { <質問キー>: <反転前の noul> }, mean: <反転適用後の平均> }` の形で、`scores` のキーは framing ごとに変わる（プロンプト向けは 3 キー、ツール向けは `gate::routine_step` の 1 キー）。`event` を持たない古いレコードは `UserPromptSubmit` とみなして集計する。
```

- [ ] **Step 5: 評価の節にツール向けケースの書き方を足す**

「`golden.json` は該当あり 20 件・該当なし 10 件の手書き 30 件から始める。…」の段落の直後に次を挿入する（外側の囲みは計画書上の区切り）。

````markdown
ツール向けケースは `request` の代わりに `tool_name` と `tool_input` を持つ。`run.ts` はフックと同じ `buildToolRequest` で request 文を組み立て、`TOOL_FRAMING` で `suggest` を呼ぶ。

```json
{ "tool_name": "Bash", "tool_input": { "description": "Commit the staged changes", "command": "git commit -m \"fix: ...\"" }, "expected": "mgzl:commiting-to-git" },
{ "tool_name": "Bash", "tool_input": { "description": "List files in the hooks directory", "command": "ls typesafe/hooks" }, "expected": null }
```

該当ありは git commit / gh issue 作成 / worktree 作成 / サブエージェント起動など、該当なしは ls / cat / grep / git status といった定型の確認作業と、roster に無い対象の名指し（Slack への curl など）を中心にする。現状は 10 件（該当あり 5 / 該当なし 5）で、プロンプト向け 30 件と合わせて 40 件である。
````

あわせて、出力項目の箇条書きに `event` 別の行を足す。

変更前:
```markdown
- `total` / `with_skill` / `without_skill` / `errors`（`suggest` が例外を投げたケースの件数）
```

変更後:
```markdown
- `total` / `with_skill` / `without_skill` / `errors`（`suggest` が例外を投げたケースの件数）
- `event=<イベント名> total=… with_skill=… without_skill=… errors=… wrong_suggestion_rate=… unneeded_suggestion_rate=…`: 発火イベント別の内訳
```

`mismatch` の説明も書き換える。

変更前:
```markdown
- `mismatch request="<先頭 60 文字>" expected=… winner=… gate=… fits=…`: 不一致ケースの一覧。`errors` になったケースは必ずここに列挙され、末尾に `error="..."` が付く
```

変更後:
```markdown
- `mismatch event=<イベント名> request="<先頭 60 文字>" expected=… winner=… gate=… fits=…`: 不一致ケースの一覧。`errors` になったケースは必ずここに列挙され、末尾に `error="..."` が付く
```

- [ ] **Step 6: 環境変数の節に注意書きを足す**

変更前:
```markdown
- `TYPESAFE_API_KEY`（必須）: 未設定ならフックは何も出力せず終了する。機能を無効化したいときはこれを設定しない。未設定時は System One への送信も行わず、ログにも何も記録しない
```

変更後:
```markdown
- `TYPESAFE_API_KEY`（必須）: 未設定ならフックは何も出力せず終了する。機能を無効化したいときはこれを設定しない。未設定時は System One への送信も行わず、ログにも何も記録しない。`PreToolUse` が有効なときは依頼文だけでなく実行しようとしているコマンド文字列や Agent の prompt も送られるため、機密性の高いプロジェクトではこの変数を設定しないことで両方の発火点をまとめて無効化する
```

- [ ] **Step 7: 記述が実装と一致しているか確かめる**

README で触れた関数名・定数名・文面が実物と一致しているかを確認する。

Run: `grep -n "TOOL_INPUT_CHARS\|gate::routine_step\|Relevant to the action you are about to take" /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/request.ts /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/lib/pipeline.ts /Users/otto/workspace/mgzl-claude-code-plugin/typesafe/hooks/suggest-skill.ts`

Expected: 3 つの識別子・文面がそれぞれのファイルに存在する

- [ ] **Step 8: 変更ファイル一覧を確認する**

Run: `git status --short`

Expected: Task 1〜7 で触れた全ファイル（`typesafe/README.md` / `typesafe/hooks/hooks.json` / `typesafe/hooks/suggest-skill.ts` / `typesafe/hooks/suggest-skill.test.ts` / `typesafe/hooks/lib/request.ts` / `typesafe/hooks/lib/request.test.ts` / `typesafe/hooks/lib/pipeline.ts` / `typesafe/hooks/lib/pipeline.test.ts` / `typesafe/hooks/lib/roster.ts` / `typesafe/hooks/lib/roster.test.ts` / `typesafe/hooks/lib/log.ts` / `typesafe/hooks/lib/log.test.ts` / `typesafe/manifest.test.ts` / `typesafe/eval/run.ts` / `typesafe/eval/run.test.ts` / `typesafe/eval/golden.json`）が並ぶ

---

## 設計書からの意図的な差分

1. **`Framing.fits` の引数**（7 章）: 設計書の `(name: string) => string` を `(name: string, description: string) => string` にした。`PROMPT_FRAMING` の既存の質問文は末尾に description 全文を含むため、name だけでは既存挙動を再現できない。
2. **`TOOL_FRAMING.fits` の文言**（7 章）: 設計書の "Does this skill actually cover the action the assistant is about to take, rather than a merely similar topic?" に skill 名と description を差し込んだ形にした。Noul の instructions が候補ごとに同一だと `fits::<name>` が全候補で同じ値を返し、`max(fits)` による閾値判定と候補の比較が成立しないためである。
3. **`GateScores` の形**（7 章）: 設計書の「`Record<string, number>` + `mean`」を `{ scores: Record<string, number>; mean: number }` にした。`Record<string, number>` に `mean` を混ぜると gate キーと `mean` が同じ名前空間に同居し、キー衝突と型の緩みを招くためである。ログと eval が見るのは `mean` だけなので集計側への影響は無い。
