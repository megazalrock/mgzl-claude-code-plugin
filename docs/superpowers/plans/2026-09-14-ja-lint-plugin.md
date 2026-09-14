# ja-lint プラグイン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code が書く日本語（コード内コメント・コミットメッセージ・PR のタイトル/本文）を textlint で検査し、違反を hook 経由で Claude に返して自己修正させる新規プラグイン `ja-lint/` を作る。

**Architecture:** `ja-lint/hooks/` に PreToolUse(Bash) と PostToolUse(Edit|Write) の 2 本の bun スクリプトを置き、共通ロジックを `hooks/lib/` の 5 モジュール（hook-io / comments / commands / textlint-config / lint）に分ける。textlint は `.textlintrc` を使わず `TextlintKernelDescriptor` を comment / commit / pr の 3 文脈ぶん手で組み立てる。依存は `ja-lint/package.json` + `ja-lint/bun.lock` を置き、Claude Code のプラグインキャッシュ作成時の自動インストールに任せる。

**Tech Stack:** bun / TypeScript / textlint 15.8.0 / @textlint/kernel 15.8.0 / @textlint/module-interop 15.8.0 / @textlint/textlint-plugin-text 15.8.0 / textlint-rule-preset-ja-technical-writing 12.0.2 / @textlint-ja/textlint-rule-preset-ai-writing 1.7.0 / textlint-rule-prh 6.1.0

**Spec:** docs/superpowers/specs/2026-09-14-ja-lint-plugin-design.md

## Global Constraints

- TypeScript で `!` `as` `any` を極力使わない。使う場合は必要な理由をコメントで残す。
- スクリプトは TypeScript + bun。シェルスクリプトは新規作成しない。
- `bun` で `.ts` を実行する場合は `bun run` を使う。
- `plugin.json` に `version` フィールドを追加しない。
- コメントは「コードからは読み取れない実装の理由」を中心に書く。「してはならない」系の注意書きは書かない。
- 新規プラグイン `ja-lint/` として切り出す。`common/` `cbo/` `fading-memory/` には手を入れない。
- `.claude-plugin/marketplace.json` の `plugins` 配列にだけ 1 件追記する。
- hook 自身の不調でツール実行を止めない。全例外を捕捉し stderr に 1 行出して exit 0。
- hooks.json の `command` は `bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/<name>.ts\"`、`timeout` は 30。
- 日本語（`\p{sc=Hiragana}` / `\p{sc=Katakana}` / `\p{sc=Han}`）を 1 文字も含まない場合は textlint を **import する前に** exit 0 する。そのため `lint.ts` 内の textlint 系 import はすべて `await import(...)` の動的 import にする。
- コミットのステップは書かない。コミットはユーザーの明示指示があるときだけ行う。
- SessionStart でのインストールや `${CLAUDE_PLUGIN_DATA}` は使わない。

---

## 事前調査で確定した事実（実装時の前提）

実際に `bun add --ignore-scripts` でインストールし、スクリプトを動かして確認した内容である。

- **パッケージ名**: 設計書は `@textlint-ja/textlint-rule-preset-ja-technical-writing` と書いているが、実在するのはスコープ無しの `textlint-rule-preset-ja-technical-writing`（12.0.2）である。ai-writing 側は `@textlint-ja/textlint-rule-preset-ai-writing`（1.7.0）でスコープ付きが正しい。
- **プリセットの形**: プリセットモジュールは `{ rules: Record<string, RuleModule>, rulesConfig: Record<string, unknown> }` を export する。`@textlint/kernel` はプリセットを展開しないので、自分で `rules` を回して `{ ruleId: "<ns>/<name>", rule, options }` に落とす必要がある。ja-technical-writing は CommonJS、ai-writing は ESM default export なので、どちらも `moduleInterop()` を通す。
- **プリセット内ルールの無効化**: 展開時に `options === false` のルールを配列に入れないことで実現する。`{ "ja-no-mixed-period": false }` のような override マップを `rulesConfig` にかぶせる方式で、comment / commit 文脈では `ja-no-mixed-period` を落とせることを実測で確認済み。
- **severity の数値**: `TextlintRuleSeverityLevelKeys` は `{ none: 0, warning: 1, error: 2, info: 3 }`。**info は 3** である。
- **severity オプションの限界（重要）**: `options: { severity: "info" }` は `TextlintRuleError` を使って報告するルール（例 `ja-no-mixed-period`）には効き、message.severity は 3 になる。しかし `ai-tech-writing-guideline` は `report(node, { message })` とプレーンオブジェクトで報告するため、kernel 側が severity を error(2) に固定してしまい、**`severity: "info"` オプションは効かない**（実測済み）。そのため本プラグインでは textlint の severity に頼らず、`lint.ts` 側で ruleId が `ai-writing/ai-tech-writing-guideline` のメッセージを info として分類する。
- **quiet**: `createLinter({ descriptor })` の `quiet` は既定 false。true にすると warning / info が落ちるので指定しない。
- **プレーンテキストの lint**: `lintText(text, filePath)` は拡張子に対応する plugin が descriptor に無いと動かない。`@textlint/textlint-plugin-text` を `{ pluginId: "text", plugin, options: true }` として必ず載せ、filePath には `.txt` を渡す。
- **戻り値**: `lintText` は `Promise<TextlintResult>`、`messages: TextlintMessage[]`。各 message は `ruleId: string` / `message: string` / `severity: number` / `index: number`（0 始まり） / `line: number`（1 始まり） / `column: number`（1 始まり） / `range: readonly [number, number]` / `loc` を持つ。
- **prh の指定方法**: `{ ruleId: "prh", rule: moduleInterop(prhRule), options: { rulePaths: ["<絶対パス>/prh.yml"] } }`。実測でメッセージ `サーバ => サーバー` が返ることを確認。pattern に `/サーバ(?![ー])/` のような正規表現を書けば正規表記側では鳴らないことも確認済み。
- **postinstall 不要**: 4 パッケージとも `bun add --ignore-scripts` で入り、lint が正常動作した。
- **プラグインの自動インストール**: プラグインルートに `package.json` と `bun.lock` の両方があるとき、Claude Code がバージョンディレクトリ作成時に `bun install --frozen-lockfile --ignore-scripts` を実行する（タイムアウト 60 秒）。
- **PreToolUse の stdin**: `{ session_id, cwd, hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id, ... }`。
- **PreToolUse の deny 出力**: exit 0 で `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`。advisory は `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}`。
- **PostToolUse の stdin**: `{ ..., hook_event_name: "PostToolUse", tool_name, tool_input, tool_output }`。
- **PostToolUse の block 出力**: PostToolUse は上位（トップレベル）の `decision` / `reason` を使う。exit 0 で `{"decision":"block","reason":"..."}` を返すと、reason がツール結果の隣に添えられて Claude に渡る。ツール実行自体は既に終わっているため取り消されないが、Claude には修正指示として届く。info だけのときは `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}` を返す。`additionalContext` はツール結果と並べて Claude のコンテキストに追加される文字列である。
- **exit code**: 0 = 成功（stdout が `{` で始まり `}` で終われば JSON として解釈）、2 = blocking error（PreToolUse ではツール呼び出しを阻止）、その他 = non-blocking error。
- **prh 公開辞書はコピー不要**: `textlint-rule-prh` が依存する `prh` パッケージ（5.4.4、`license: "MIT"`）に `prh-rules/media/WEB+DB_PRESS.yml` と `prh-rules/media/techbooster.yml` が同梱されている。`prh/rules` リポジトリからコピーする必要はなく、ライセンス確認も不要である。`rules/prh.yml` の `imports` に `../node_modules/prh/prh-rules/media/WEB+DB_PRESS.yml` と書けば読み込める。**`imports` の相対パスが prh.yml 自身の位置を基準に解決されることは実測で確認済み**（`rules/prh.yml` を `rulePaths` に絶対パスで渡し、`ユーザの` → `ユーザーの` などが実際に鳴った）。
- **WEB+DB_PRESS.yml の収録内容（実測）**: 鳴るもの — `ユーザの` → `ユーザーの`、`つくる` → `作る`、`インターフェイス` → `インタフェース`。鳴らないもの — `サーバから`、`ディレクトリ`、`デフォルト`、`プログラム`。設計書の出力例にある「サーバ => サーバー」は **この辞書には収録されていない**ため、テストや疎通確認では `ユーザの` を使う。

---

## ファイル構成

作成するファイル:

- `ja-lint/.claude-plugin/plugin.json` — プラグインメタデータ（name, description, author）。version は持たない
- `ja-lint/package.json` — textlint 系 7 パッケージの依存宣言
- `ja-lint/bun.lock` — 自動インストールの発火条件。`bun install` で生成する
- `ja-lint/hooks/hooks.json` — PreToolUse(Bash) と PostToolUse(Edit|Write) の登録
- `ja-lint/hooks/lib/hook-io.ts` — stdin JSON の解析、Finding 型、引用文の切り出し、理由文の整形、stdout JSON の組み立て
- `ja-lint/hooks/lib/comments.ts` — 日本語判定、Edit の追加行判定、拡張子別コメント抽出
- `ja-lint/hooks/lib/commands.ts` — Bash コマンドから lint 対象文字列を取り出す
- `ja-lint/hooks/lib/textlint-config.ts` — 文脈別 `TextlintKernelDescriptor` の組み立てと info 扱いする ruleId 集合
- `ja-lint/hooks/lib/lint.ts` — textlint の動的 import と lintText の薄いラッパー
- `ja-lint/hooks/post-edit.ts` — PostToolUse 本体
- `ja-lint/hooks/pre-bash.ts` — PreToolUse 本体
- `ja-lint/rules/prh.yml` — 表記ゆれ辞書。prh パッケージ同梱の `prh-rules/media/WEB+DB_PRESS.yml` を `imports` で読み込み、独自項目を足す口を残す
- `ja-lint/README.md` — 導入・挙動・調整方法
- `ja-lint/hooks/lib/hook-io.test.ts`
- `ja-lint/hooks/lib/comments.test.ts`
- `ja-lint/hooks/lib/commands.test.ts`
- `ja-lint/hooks/lib/lint.test.ts`

変更するファイル:

- `.claude-plugin/marketplace.json` — `plugins` 配列に ja-lint を 1 件追記

---

### Task 1: プラグインの骨組み

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/.claude-plugin/plugin.json`
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/package.json`
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/bun.lock`（`bun install` が生成する）
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/hooks.json`
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/README.md`
- Modify: `/Users/otto/workspace/mgzl-claude-code-plugin/.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `ja-lint/node_modules/` に textlint 一式。以降のすべてのタスクが `import { createLinter } from "textlint"` などを解決できるようになる

- [ ] **Step 1: plugin.json を作る**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/.claude-plugin/plugin.json`:

```json
{
  "name": "ja-lint",
  "description": "Claude Code が書く日本語（コード内コメント・コミットメッセージ・PR のタイトルと本文）を textlint で検査し、違反を hook で差し戻す",
  "author": {
    "name": "otto"
  }
}
```

- [ ] **Step 2: package.json を作る**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/package.json`:

```json
{
  "name": "ja-lint",
  "private": true,
  "type": "module",
  "dependencies": {
    "@textlint-ja/textlint-rule-preset-ai-writing": "1.7.0",
    "@textlint/kernel": "15.8.0",
    "@textlint/module-interop": "15.8.0",
    "@textlint/textlint-plugin-text": "15.8.0",
    "textlint": "15.8.0",
    "textlint-rule-preset-ja-technical-writing": "12.0.2",
    "textlint-rule-prh": "6.1.0"
  }
}
```

`@textlint/kernel` `@textlint/module-interop` `@textlint/textlint-plugin-text` は textlint の推移的依存だが、コードから直接 import するため明示的に依存として宣言する。バージョンはキャレットを付けず固定する（`--frozen-lockfile` でインストールされるため、ロックファイルと食い違わせない）。

- [ ] **Step 3: 依存をインストールして bun.lock を作る**

Run: `bun install --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint --ignore-scripts`

Expected: `ja-lint/bun.lock` と `ja-lint/node_modules/` が生成される。`textlint@15.8.0` `textlint-rule-preset-ja-technical-writing@12.0.2` `@textlint-ja/textlint-rule-preset-ai-writing@1.7.0` `textlint-rule-prh@6.1.0` が入る。

- [ ] **Step 4: インストール結果を確認する**

Run: `bun --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint -e 'const m = await import("textlint"); console.log(typeof m.createLinter);'`

Expected: `function` と出力される。

- [ ] **Step 5: hooks.json を作る**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-bash.ts\"",
            "timeout": 30
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/post-edit.ts\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: marketplace.json に追記する**

`/Users/otto/workspace/mgzl-claude-code-plugin/.claude-plugin/marketplace.json` の `plugins` 配列末尾（`fading-memory` の後ろ）に追記する:

```json
    {
      "name": "ja-lint",
      "source": "./ja-lint",
      "description": "Claude Code が書く日本語（コード内コメント・コミットメッセージ・PR のタイトルと本文）を textlint で検査し、違反を hook で差し戻す"
    }
```

- [ ] **Step 7: marketplace.json が壊れていないことを確認する**

Run: `bun -e 'console.log(JSON.parse(await Bun.file("/Users/otto/workspace/mgzl-claude-code-plugin/.claude-plugin/marketplace.json").text()).plugins.map((p) => p.name).join(","))'`

Expected: `mgzl,cbo,fading-memory,ja-lint`

- [ ] **Step 8: README の雛形を書く**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/README.md`:

```markdown
# ja-lint

Claude Code が書く日本語を textlint で検査するプラグインである。

## 検査対象

- Edit / Write で書かれたソースコード内のコメント（追加行のみ）
- `git commit` のコミットメッセージ
- `gh pr create` / `gh pr edit` のタイトルと本文

Claude の応答文そのもの、Markdown ファイルの本文、人間が直接書いた文章は対象外である。

## 挙動

- `git commit` / `gh pr` は PreToolUse で検査し、error があればコマンド実行を拒否する
- Edit / Write は PostToolUse で検査し、error があれば `decision: "block"` と `reason` で指摘を返す
- 日本語を 1 文字も含まない場合は textlint を読み込まずに終了する

## 調整方法

- 表記ゆれ辞書: `rules/prh.yml`
- ルールの有効・無効、例外語: `hooks/lib/textlint-config.ts`
```

この時点では雛形である。Task 8 Step 5 で、文脈別のルール構成表・実際の出力例・テストの実行方法を含む完成版に置き換える。

コミットはユーザーの指示があるまで行わない。

---

### Task 2: hook-io.ts

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/hook-io.ts`
- Test: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/hook-io.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Finding = { ruleId: string; message: string; quote: string }`
  - `type LintOutcome = { errors: Finding[]; infos: Finding[] }`
  - `type HookPayload = { toolName: string; toolInput: Record<string, unknown> }`
  - `function parseHookPayload(raw: string): HookPayload | undefined`
  - `function readStringField(obj: Record<string, unknown>, key: string): string | undefined`
  - `function extractQuote(text: string, index: number, maxLength?: number): string`
  - `function formatReason(outcome: LintOutcome): string`
  - `function preToolUseDeny(reason: string): string`
  - `function preToolUseAdvisory(context: string): string`
  - `function postToolUseBlock(reason: string): string`
  - `function postToolUseAdvisory(context: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/hook-io.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  extractQuote,
  formatReason,
  parseHookPayload,
  postToolUseAdvisory,
  postToolUseBlock,
  preToolUseAdvisory,
  preToolUseDeny,
  readStringField,
  type LintOutcome,
} from "./hook-io.ts";

describe("parseHookPayload", () => {
  test("tool_name と tool_input を取り出す", () => {
    const raw = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/a.ts" } });
    expect(parseHookPayload(raw)).toEqual({ toolName: "Edit", toolInput: { file_path: "/a.ts" } });
  });

  test("JSON として壊れていれば undefined", () => {
    expect(parseHookPayload("{")).toBeUndefined();
  });

  test("tool_name が無ければ undefined", () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: {} }))).toBeUndefined();
  });

  test("tool_input が無ければ空オブジェクトを補う", () => {
    expect(parseHookPayload(JSON.stringify({ tool_name: "Bash" }))).toEqual({
      toolName: "Bash",
      toolInput: {},
    });
  });
});

describe("readStringField", () => {
  test("文字列なら返す", () => {
    expect(readStringField({ a: "x" }, "a")).toBe("x");
  });

  test("文字列以外なら undefined", () => {
    expect(readStringField({ a: 1 }, "a")).toBeUndefined();
    expect(readStringField({}, "a")).toBeUndefined();
  });
});

describe("extractQuote", () => {
  test("指摘位置を含む文を句点まで切り出す", () => {
    const text = "最初の文です。ユーザの情報を取得する。最後の文です。";
    expect(extractQuote(text, text.indexOf("ユーザ"))).toBe("ユーザの情報を取得する。");
  });

  test("句点が無ければ行末まで切り出す", () => {
    const text = "前の行\n句点の無い行\n次の行";
    expect(extractQuote(text, text.indexOf("句点"))).toBe("句点の無い行");
  });

  test("長い文は前後を省略記号で切り詰める", () => {
    const text = `${"あ".repeat(40)}X${"い".repeat(40)}。`;
    const quote = extractQuote(text, 40, 20);
    expect(quote.length).toBeLessThanOrEqual(22);
    expect(quote).toContain("X");
    expect(quote.startsWith("…")).toBe(true);
    expect(quote.endsWith("…")).toBe(true);
  });
});

describe("formatReason", () => {
  test("error のみのとき件数と一覧を出す", () => {
    const outcome: LintOutcome = {
      errors: [
        { ruleId: "ja-technical-writing/ja-no-redundant-expression", message: "冗長です", quote: "取得を行う。" },
        { ruleId: "prh", message: "ユーザの => ユーザーの", quote: "ユーザの一覧を表示する。" },
      ],
      infos: [],
    };
    expect(formatReason(outcome)).toBe(
      [
        "ja-lint: 日本語の文章に修正が必要です（error 2 件）",
        "- 「取得を行う。」 [ja-technical-writing/ja-no-redundant-expression] 冗長です",
        "- 「ユーザの一覧を表示する。」 [prh] ユーザの => ユーザーの",
      ].join("\n"),
    );
  });

  test("info のみのとき参考セクションだけを出す", () => {
    const outcome: LintOutcome = {
      errors: [],
      infos: [{ ruleId: "ai-writing/ai-tech-writing-guideline", message: "簡潔にできます", quote: "まず最初に。" }],
    };
    expect(formatReason(outcome)).toBe(
      ["参考（info 1 件）", "- 「まず最初に。」 [ai-writing/ai-tech-writing-guideline] 簡潔にできます"].join("\n"),
    );
  });

  test("error と info が両方あるとき空行で区切る", () => {
    const outcome: LintOutcome = {
      errors: [{ ruleId: "prh", message: "ユーザの => ユーザーの", quote: "ユーザの。" }],
      infos: [{ ruleId: "ai-writing/ai-tech-writing-guideline", message: "簡潔に", quote: "まず最初に。" }],
    };
    expect(formatReason(outcome)).toBe(
      [
        "ja-lint: 日本語の文章に修正が必要です（error 1 件）",
        "- 「ユーザの。」 [prh] ユーザの => ユーザーの",
        "",
        "参考（info 1 件）",
        "- 「まず最初に。」 [ai-writing/ai-tech-writing-guideline] 簡潔に",
      ].join("\n"),
    );
  });

  test("どちらも無ければ空文字", () => {
    expect(formatReason({ errors: [], infos: [] })).toBe("");
  });

  test("改行を含むメッセージは 1 行目だけにする", () => {
    const outcome: LintOutcome = {
      errors: [{ ruleId: "prh", message: "1 行目\n解説: https://example.com", quote: "あ。" }],
      infos: [],
    };
    expect(formatReason(outcome)).toContain("[prh] 1 行目");
    expect(formatReason(outcome)).not.toContain("解説");
  });
});

describe("出力 JSON", () => {
  test("preToolUseDeny", () => {
    expect(JSON.parse(preToolUseDeny("理由"))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "理由",
      },
    });
  });

  test("preToolUseAdvisory", () => {
    expect(JSON.parse(preToolUseAdvisory("参考"))).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "参考" },
    });
  });

  test("postToolUseBlock は上位の decision と reason を使う", () => {
    expect(JSON.parse(postToolUseBlock("理由"))).toEqual({ decision: "block", reason: "理由" });
  });

  test("postToolUseAdvisory", () => {
    expect(JSON.parse(postToolUseAdvisory("参考"))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "参考" },
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/hook-io.test.ts`

Expected: FAIL（`./hook-io.ts` が存在せず解決できない）

- [ ] **Step 3: 最小実装**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/hook-io.ts`:

```ts
/** textlint の 1 件の指摘を、行番号ではなく引用文で位置を示す形に落としたもの */
export type Finding = {
  ruleId: string;
  message: string;
  /** 指摘位置を含む文。長い場合は前後を省略記号で切り詰めてある */
  quote: string;
};

/** lint 結果を block 対象（error）と参考情報（info）に分けたもの */
export type LintOutcome = {
  errors: Finding[];
  infos: Finding[];
};

export type HookPayload = {
  toolName: string;
  toolInput: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** stdin の JSON を解析する。壊れていた場合は hook を素通しさせるため undefined を返す */
export function parseHookPayload(raw: string): HookPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const toolName = parsed["tool_name"];
  if (typeof toolName !== "string") return undefined;
  const toolInput = parsed["tool_input"];
  return { toolName, toolInput: isRecord(toolInput) ? toolInput : {} };
}

export function readStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

const SENTENCE_BOUNDARY = /[。\n]/;

/**
 * 指摘位置を含む「文」を切り出す。
 * Edit の new_string からはファイル上の行番号が分からないため、位置は引用で示す。
 */
export function extractQuote(text: string, index: number, maxLength = 60): string {
  const clamped = Math.min(Math.max(index, 0), Math.max(text.length - 1, 0));

  let start = 0;
  for (let i = clamped; i > 0; i--) {
    if (SENTENCE_BOUNDARY.test(text[i - 1] ?? "")) {
      start = i;
      break;
    }
  }

  let end = text.length;
  for (let i = clamped; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "\n") {
      end = i;
      break;
    }
    if (ch === "。") {
      end = i + 1;
      break;
    }
  }

  const sentence = text.slice(start, end).trim();
  if (sentence.length <= maxLength) return sentence;

  const offset = Math.min(Math.max(clamped - start, 0), sentence.length);
  const half = Math.floor(maxLength / 2);
  const from = Math.max(offset - half, 0);
  const to = Math.min(from + maxLength, sentence.length);
  const head = from > 0 ? "…" : "";
  const tail = to < sentence.length ? "…" : "";
  return `${head}${sentence.slice(from, to)}${tail}`;
}

function renderFinding(finding: Finding): string {
  const firstLine = finding.message.split("\n")[0] ?? finding.message;
  return `- 「${finding.quote}」 [${finding.ruleId}] ${firstLine}`;
}

export function formatReason(outcome: LintOutcome): string {
  const sections: string[] = [];
  if (outcome.errors.length > 0) {
    sections.push(
      [
        `ja-lint: 日本語の文章に修正が必要です（error ${outcome.errors.length} 件）`,
        ...outcome.errors.map(renderFinding),
      ].join("\n"),
    );
  }
  if (outcome.infos.length > 0) {
    sections.push(
      [`参考（info ${outcome.infos.length} 件）`, ...outcome.infos.map(renderFinding)].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function preToolUseDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function preToolUseAdvisory(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
  });
}

/** PostToolUse は hookSpecificOutput ではなく上位の decision / reason で Claude に理由を渡す */
export function postToolUseBlock(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

export function postToolUseAdvisory(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
  });
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/hook-io.test.ts`

Expected: PASS（18 件）

コミットはユーザーの指示があるまで行わない。

---

### Task 3: comments.ts

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/comments.ts`
- Test: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/comments.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `function containsJapanese(text: string): boolean`
  - `function addedLines(oldString: string, newString: string): string[]`
  - `function extractCommentBlocks(filePath: string, lines: string[]): string[]`

`extractCommentBlocks` は拡張子が対象外なら空配列を返す。返す各要素は「連続するコメント行を連結した 1 段落」である。

- [ ] **Step 1: 失敗するテストを書く**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/comments.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { addedLines, containsJapanese, extractCommentBlocks } from "./comments.ts";

describe("containsJapanese", () => {
  test("ひらがな", () => {
    expect(containsJapanese("これ")).toBe(true);
  });
  test("カタカナ", () => {
    expect(containsJapanese("ユーザー")).toBe(true);
  });
  test("漢字", () => {
    expect(containsJapanese("取得")).toBe(true);
  });
  test("英数字と記号のみ", () => {
    expect(containsJapanese("const foo = 1; // TODO: fix")).toBe(false);
  });
  test("長音記号のみは日本語と見なさない", () => {
    expect(containsJapanese("---")).toBe(false);
  });
});

describe("addedLines", () => {
  test("new_string にあって old_string に無い行だけを返す", () => {
    expect(addedLines("a\nb\n", "a\nb\nc\n")).toEqual(["c"]);
  });

  test("多重集合の差なので重複行は回数ぶんだけ差が出る", () => {
    expect(addedLines("x\nx", "x\nx\nx")).toEqual(["x"]);
  });

  test("削除しかない場合は空", () => {
    expect(addedLines("a\nb", "a")).toEqual([]);
  });

  test("old_string が空なら全行が追加行", () => {
    expect(addedLines("", "a\nb")).toEqual(["a", "b"]);
  });
});

describe("extractCommentBlocks", () => {
  test("対象外の拡張子は空配列", () => {
    expect(extractCommentBlocks("/a/b.md", ["// 日本語のコメント"])).toEqual([]);
    expect(extractCommentBlocks("/a/b", ["// 日本語のコメント"])).toEqual([]);
  });

  test("ts の行コメント", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1; // ユーザーを取得する"])).toEqual([
      "ユーザーを取得する",
    ]);
  });

  test("py の # コメント", () => {
    expect(extractCommentBlocks("/a/b.py", ["# ユーザーを取得する"])).toEqual(["ユーザーを取得する"]);
  });

  test("yml の # コメント", () => {
    expect(extractCommentBlocks("/a/b.yml", ["# 設定を書く"])).toEqual(["設定を書く"]);
  });

  test("sql の -- コメント", () => {
    expect(extractCommentBlocks("/a/b.sql", ["-- 件数を数える"])).toEqual(["件数を数える"]);
  });

  test("html の <!-- --> コメント", () => {
    expect(extractCommentBlocks("/a/b.html", ["<!-- 見出しである -->"])).toEqual(["見出しである"]);
  });

  test("vue は // も <!-- --> も拾う", () => {
    expect(
      extractCommentBlocks("/a/b.vue", [
        "<!-- テンプレートである -->",
        "</template>",
        "const a = 1; // 処理である",
      ]),
    ).toEqual(["テンプレートである", "処理である"]);
  });

  test("php は // も # も拾う", () => {
    expect(extractCommentBlocks("/a/b.php", ["// 前半である", "# 後半である"])).toEqual([
      "前半である後半である",
    ]);
  });

  test("ブロックコメントの各行から先頭の * を除去する", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["/**", " * ユーザーを取得する", " * 失敗したら例外を投げる", " */"]),
    ).toEqual(["ユーザーを取得する失敗したら例外を投げる"]);
  });

  test("JSDoc のタグ行はタグと識別子を除いた説明部分だけを対象にする", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["/**", " * @param {string} name 利用者の名前である", " */"]),
    ).toEqual(["利用者の名前である"]);
  });

  test("型注釈の無い JSDoc タグも識別子を除く", () => {
    expect(extractCommentBlocks("/a/b.ts", ["/**", " * @returns 取得した件数である", " */"])).toEqual([
      "取得した件数である",
    ]);
  });

  test("連続するコメント行は 1 段落に連結する", () => {
    expect(extractCommentBlocks("/a/b.ts", ["// 前半である", "// 後半である"])).toEqual([
      "前半である後半である",
    ]);
  });

  test("コード行を挟むと別の段落になる", () => {
    expect(
      extractCommentBlocks("/a/b.ts", ["// 前半である", "const a = 1;", "// 後半である"]),
    ).toEqual(["前半である", "後半である"]);
  });

  test("日本語を含まない行は除外する", () => {
    expect(extractCommentBlocks("/a/b.ts", ["// TODO: fix", "// 日本語である"])).toEqual([
      "日本語である",
    ]);
  });

  test("コメントが無ければ空配列", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1;"])).toEqual([]);
  });

  test("1 行に閉じたブロックコメント", () => {
    expect(extractCommentBlocks("/a/b.ts", ["const a = 1; /* 補足である */ const b = 2;"])).toEqual([
      "補足である",
    ]);
  });

  test("大文字の拡張子も扱う", () => {
    expect(extractCommentBlocks("/a/B.TS", ["// 日本語である"])).toEqual(["日本語である"]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/comments.test.ts`

Expected: FAIL（`./comments.ts` が存在しない）

- [ ] **Step 3: 最小実装**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/comments.ts`:

```ts
const JAPANESE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u;

/** ひらがな・カタカナ・漢字を 1 文字でも含むか。textlint を読み込む前の足切りに使う */
export function containsJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/**
 * new_string にあって old_string に無い行を多重集合の差として返す。
 * Edit で書き換えられなかった既存行まで lint すると、無関係な既存コメントで差し戻しが起きるため。
 */
export function addedLines(oldString: string, newString: string): string[] {
  const remaining = new Map<string, number>();
  for (const line of oldString.split("\n")) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of newString.split("\n")) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      continue;
    }
    added.push(line);
  }
  return added;
}

type CommentSyntax = {
  line: string[];
  block: Array<readonly [string, string]>;
};

const SLASH: CommentSyntax = { line: ["//"], block: [["/*", "*/"]] };
const HASH: CommentSyntax = { line: ["#"], block: [] };
const MARKUP: CommentSyntax = { line: [], block: [["<!--", "-->"]] };
const DASH: CommentSyntax = { line: ["--"], block: [] };

function merge(...syntaxes: CommentSyntax[]): CommentSyntax {
  return {
    line: syntaxes.flatMap((s) => s.line),
    block: syntaxes.flatMap((s) => s.block),
  };
}

const SYNTAX_BY_EXTENSION: Record<string, CommentSyntax> = {
  ts: SLASH,
  tsx: SLASH,
  js: SLASH,
  jsx: SLASH,
  mjs: SLASH,
  cjs: SLASH,
  css: SLASH,
  scss: SLASH,
  go: SLASH,
  rs: SLASH,
  java: SLASH,
  kt: SLASH,
  swift: SLASH,
  vue: merge(SLASH, MARKUP),
  php: merge(SLASH, HASH),
  html: MARKUP,
  yml: HASH,
  yaml: HASH,
  sh: HASH,
  bash: HASH,
  zsh: HASH,
  py: HASH,
  rb: HASH,
  toml: HASH,
  sql: DASH,
};

function syntaxFor(filePath: string): CommentSyntax | undefined {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return SYNTAX_BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}

/** `@param {T} name 説明` のようなタグ行から説明部分だけを取り出す */
const DOC_TAG = /^@[A-Za-z-]+(?:\s+\{[^}]*\})?(?:\s+\$?[A-Za-z_$][\w.$[\]-]*)?\s*(.*)$/;

function normalizeCommentText(raw: string): string {
  // ブロックコメント本文の行頭に付く装飾の `*` は文章ではないため落とす
  const stripped = raw.replace(/^\s*\*+\s?/, "").trim();
  const tag = DOC_TAG.exec(stripped);
  if (tag !== null) return (tag[1] ?? "").trim();
  return stripped;
}

type Extracted = { index: number; text: string };

function extractFromLine(
  line: string,
  syntax: CommentSyntax,
  openBlock: readonly [string, string] | undefined,
): { texts: string[]; openBlock: readonly [string, string] | undefined } {
  const texts: string[] = [];
  let rest = line;
  let current = openBlock;

  for (;;) {
    if (current !== undefined) {
      const closeAt = rest.indexOf(current[1]);
      if (closeAt < 0) {
        texts.push(rest);
        return { texts, openBlock: current };
      }
      texts.push(rest.slice(0, closeAt));
      rest = rest.slice(closeAt + current[1].length);
      current = undefined;
      continue;
    }

    let best: { at: number; marker: string; block?: readonly [string, string] } | undefined;
    for (const marker of syntax.line) {
      const at = rest.indexOf(marker);
      if (at >= 0 && (best === undefined || at < best.at)) best = { at, marker };
    }
    for (const block of syntax.block) {
      const at = rest.indexOf(block[0]);
      if (at >= 0 && (best === undefined || at < best.at)) best = { at, marker: block[0], block };
    }
    if (best === undefined) return { texts, openBlock: undefined };

    const after = rest.slice(best.at + best.marker.length);
    if (best.block === undefined) {
      texts.push(after);
      return { texts, openBlock: undefined };
    }
    rest = after;
    current = best.block;
  }
}

/**
 * 行ベースの正規表現でコメント本文を抽出し、連続するコメント行を 1 段落に連結して返す。
 * 段落に連結するのは、行をまたぐ助詞の重複などが文単位で判定されるようにするためである。
 */
export function extractCommentBlocks(filePath: string, lines: string[]): string[] {
  const syntax = syntaxFor(filePath);
  if (syntax === undefined) return [];

  const extracted: Extracted[] = [];
  let openBlock: readonly [string, string] | undefined;
  lines.forEach((line, index) => {
    const result = extractFromLine(line, syntax, openBlock);
    openBlock = result.openBlock;
    for (const raw of result.texts) {
      const text = normalizeCommentText(raw);
      if (text === "" || !containsJapanese(text)) continue;
      extracted.push({ index, text });
    }
  });

  const blocks: string[] = [];
  let previousIndex: number | undefined;
  let buffer = "";
  for (const item of extracted) {
    const contiguous = previousIndex !== undefined && item.index - previousIndex <= 1;
    if (contiguous) {
      buffer += item.text;
    } else {
      if (buffer !== "") blocks.push(buffer);
      buffer = item.text;
    }
    previousIndex = item.index;
  }
  if (buffer !== "") blocks.push(buffer);
  return blocks;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/comments.test.ts`

Expected: PASS（26 件）

コミットはユーザーの指示があるまで行わない。

---

### Task 4: commands.ts

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/commands.ts`
- Test: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/commands.test.ts`

**Interfaces:**
- Consumes: なし（`LintContext` は Task 5 で `textlint-config.ts` に置くが、循環を避けるためこのモジュールでは文字列リテラル型 `"comment" | "commit" | "pr"` をローカルに定義して export する）
- Produces:
  - `type TargetContext = "comment" | "commit" | "pr"`
  - `type LintTarget = { text: string; context: TargetContext }`
  - `function extractLintTargets(command: string, readFile: (path: string) => string | undefined): LintTarget[]`

- [ ] **Step 1: 失敗するテストを書く**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/commands.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractLintTargets } from "./commands.ts";

const noFiles = () => undefined;

describe("対象外コマンド", () => {
  test("ls は空", () => {
    expect(extractLintTargets("ls -la", noFiles)).toEqual([]);
  });
  test("git status は空", () => {
    expect(extractLintTargets("git status", noFiles)).toEqual([]);
  });
  test("gh pr view は空", () => {
    expect(extractLintTargets("gh pr view 12", noFiles)).toEqual([]);
  });
  test("git commit だがメッセージ指定が無ければ空", () => {
    expect(extractLintTargets("git commit --amend --no-edit", noFiles)).toEqual([]);
  });
});

describe("git commit", () => {
  test("-m 1 つ", () => {
    expect(extractLintTargets('git commit -m "feat: ユーザーを追加する"', noFiles)).toEqual([
      { text: "feat: ユーザーを追加する", context: "commit" },
    ]);
  });

  test("-m 複数は空行で連結する", () => {
    expect(
      extractLintTargets('git commit -m "feat: 追加する" -m "詳細な説明である"', noFiles),
    ).toEqual([{ text: "feat: 追加する\n\n詳細な説明である", context: "commit" }]);
  });

  test("--message も拾う", () => {
    expect(extractLintTargets('git commit --message "説明である"', noFiles)).toEqual([
      { text: "説明である", context: "commit" },
    ]);
  });

  test("--message=VALUE 形式", () => {
    expect(extractLintTargets("git commit --message=説明である", noFiles)).toEqual([
      { text: "説明である", context: "commit" },
    ]);
  });

  test("heredoc の本文を取る", () => {
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      "feat: 追加する",
      "",
      "詳細な説明である",
      "EOF",
      ')"',
    ].join("\n");
    expect(extractLintTargets(command, noFiles)).toEqual([
      { text: "feat: 追加する\n\n詳細な説明である", context: "commit" },
    ]);
  });

  test("-F はファイル内容を読む", () => {
    const readFile = (path: string) => (path === "/tmp/msg.txt" ? "ファイルの本文である" : undefined);
    expect(extractLintTargets("git commit -F /tmp/msg.txt", readFile)).toEqual([
      { text: "ファイルの本文である", context: "commit" },
    ]);
  });

  test("--file はファイル内容を読む", () => {
    const readFile = (path: string) => (path === "msg.txt" ? "本文である" : undefined);
    expect(extractLintTargets("git commit --file msg.txt", readFile)).toEqual([
      { text: "本文である", context: "commit" },
    ]);
  });

  test("読めないファイルは無視する", () => {
    expect(extractLintTargets("git commit -F /tmp/missing.txt", noFiles)).toEqual([]);
  });
});

describe("gh pr", () => {
  test("--title は commit 文脈、--body は pr 文脈", () => {
    expect(
      extractLintTargets('gh pr create --title "ユーザー追加" --body "詳細な説明である。"', noFiles),
    ).toEqual([
      { text: "ユーザー追加", context: "commit" },
      { text: "詳細な説明である。", context: "pr" },
    ]);
  });

  test("短縮形 -t と -b", () => {
    expect(extractLintTargets('gh pr create -t "題名" -b "本文である。"', noFiles)).toEqual([
      { text: "題名", context: "commit" },
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("--body-file はファイル内容を pr 文脈で読む", () => {
    const readFile = (path: string) => (path === "body.md" ? "本文である。" : undefined);
    expect(extractLintTargets("gh pr create --body-file body.md", readFile)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("gh pr の -F は --body-file の短縮形として扱う", () => {
    const readFile = (path: string) => (path === "body.md" ? "本文である。" : undefined);
    expect(extractLintTargets("gh pr create -F body.md", readFile)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });

  test("gh pr edit も対象", () => {
    expect(extractLintTargets('gh pr edit 12 --body "修正した本文である。"', noFiles)).toEqual([
      { text: "修正した本文である。", context: "pr" },
    ]);
  });

  test("body の heredoc", () => {
    const command = ["gh pr create --body \"$(cat <<'EOF'", "本文である。", "EOF", ')"'].join("\n");
    expect(extractLintTargets(command, noFiles)).toEqual([{ text: "本文である。", context: "pr" }]);
  });

  test("値が空文字なら対象にしない", () => {
    expect(extractLintTargets('gh pr create --title "" --body "本文である。"', noFiles)).toEqual([
      { text: "本文である。", context: "pr" },
    ]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/commands.test.ts`

Expected: FAIL（`./commands.ts` が存在しない）

- [ ] **Step 3: 最小実装**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/commands.ts`:

```ts
export type TargetContext = "comment" | "commit" | "pr";

export type LintTarget = {
  text: string;
  context: TargetContext;
};

/** heredoc 本文をトークナイズ前に退避するための番兵。シェルのコマンド文字列には現れない */
const PLACEHOLDER_PREFIX = "\u0000ja-lint-heredoc-";
const PLACEHOLDER_SUFFIX = "\u0000";

const HEREDOC = /\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n\2\s*\)/g;

function extractHeredocs(command: string): { command: string; bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  let counter = 0;
  const replaced = command.replace(HEREDOC, (_match, _quote: string, _tag: string, body: string) => {
    const key = `${PLACEHOLDER_PREFIX}${counter}${PLACEHOLDER_SUFFIX}`;
    counter += 1;
    bodies.set(key, body);
    return key;
  });
  return { command: replaced, bodies };
}

/** クォートを解いた素のトークン列に分解する。シェルの完全な文法は扱わない */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;

  for (const ch of command) {
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function resolve(value: string, bodies: Map<string, string>): string {
  const body = bodies.get(value);
  return body !== undefined ? body : value;
}

type Kind = "git-commit" | "gh-pr" | undefined;

function classify(tokens: string[]): Kind {
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a === "git" && b === "commit") return "git-commit";
    if (a === "gh" && b === "pr") {
      const c = tokens[i + 2];
      if (c === "create" || c === "edit") return "gh-pr";
    }
  }
  return undefined;
}

type Flag = { names: string[]; slot: string };

function collectFlags(
  tokens: string[],
  bodies: Map<string, string>,
  flags: Flag[],
): Map<string, string[]> {
  const collected = new Map<string, string[]>();
  const push = (slot: string, value: string) => {
    if (value === "") return;
    const list = collected.get(slot) ?? [];
    list.push(value);
    collected.set(slot, list);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    for (const flag of flags) {
      if (flag.names.includes(token)) {
        const value = tokens[i + 1];
        if (value !== undefined) {
          push(flag.slot, resolve(value, bodies));
          i += 1;
        }
        break;
      }
      const withEquals = flag.names.find((name) => name.startsWith("--") && token.startsWith(`${name}=`));
      if (withEquals !== undefined) {
        push(flag.slot, resolve(token.slice(withEquals.length + 1), bodies));
        break;
      }
    }
  }
  return collected;
}

/**
 * Bash コマンドから lint 対象の文字列を取り出す。
 * ファイル読み込みは呼び出し側から注入してテストで実ファイルを触らずに済ませる。
 */
export function extractLintTargets(
  command: string,
  readFile: (path: string) => string | undefined,
): LintTarget[] {
  const { command: stripped, bodies } = extractHeredocs(command);
  const tokens = tokenize(stripped);
  const kind = classify(tokens);
  if (kind === undefined) return [];

  if (kind === "git-commit") {
    const collected = collectFlags(tokens, bodies, [
      { names: ["-m", "--message"], slot: "message" },
      { names: ["-F", "--file"], slot: "file" },
    ]);
    const messages = collected.get("message") ?? [];
    if (messages.length > 0) {
      return [{ text: messages.join("\n\n"), context: "commit" }];
    }
    for (const path of collected.get("file") ?? []) {
      const content = readFile(path);
      if (content !== undefined && content !== "") {
        return [{ text: content, context: "commit" }];
      }
    }
    return [];
  }

  const collected = collectFlags(tokens, bodies, [
    { names: ["-t", "--title"], slot: "title" },
    { names: ["-b", "--body"], slot: "body" },
    { names: ["-F", "--body-file"], slot: "body-file" },
  ]);
  const targets: LintTarget[] = [];
  for (const title of collected.get("title") ?? []) {
    targets.push({ text: title, context: "commit" });
  }
  const bodiesFound = collected.get("body") ?? [];
  if (bodiesFound.length > 0) {
    for (const body of bodiesFound) targets.push({ text: body, context: "pr" });
    return targets;
  }
  for (const path of collected.get("body-file") ?? []) {
    const content = readFile(path);
    if (content !== undefined && content !== "") {
      targets.push({ text: content, context: "pr" });
    }
  }
  return targets;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/commands.test.ts`

Expected: PASS（19 件）

コミットはユーザーの指示があるまで行わない。

---

### Task 5: textlint-config.ts + lint.ts + rules/prh.yml

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/rules/prh.yml`
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/textlint-config.ts`
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/lint.ts`
- Test: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/lint.test.ts`

**Interfaces:**
- Consumes:
  - `type Finding`, `type LintOutcome`, `function extractQuote(text: string, index: number, maxLength?: number): string`（`./hook-io.ts`）
  - `type TargetContext = "comment" | "commit" | "pr"`（`./commands.ts`）
- Produces:
  - `const INFO_RULE_IDS: ReadonlySet<string>`（`textlint-config.ts`）
  - `async function buildDescriptor(context: TargetContext): Promise<TextlintKernelDescriptor>`（`textlint-config.ts`）
  - `async function lintJapanese(text: string, context: TargetContext): Promise<LintOutcome>`（`lint.ts`）
  - `async function lintAll(texts: string[], context: TargetContext): Promise<LintOutcome>`（`lint.ts`。複数の段落をまとめて lint して 1 つの LintOutcome に畳み込む）

- [ ] **Step 1: rules/prh.yml を書く**

辞書は `textlint-rule-prh` が依存する `prh` パッケージ（MIT）に同梱されている `prh-rules/media/WEB+DB_PRESS.yml` を `imports` で読み込む。ファイルをコピーしないので、`bun install` で入った版がそのまま使われる。

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/rules/prh.yml`:

```yaml
# 辞書は prh パッケージ（MIT）同梱の技術書向けルールセットを読み込んで使う。
# imports の相対パスは、この prh.yml 自身の位置を基準に解決される。
version: 1
imports:
  - ../node_modules/prh/prh-rules/media/WEB+DB_PRESS.yml
rules: []
```

`rules: []` は空のまま置く。プロジェクト固有の表記ゆれを足したくなったらここに追記する。

- [ ] **Step 2: 辞書が読み込まれることを確認する**

Run:

```
bun run --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint -e 'const { createLinter } = await import("textlint"); const { TextlintKernelDescriptor } = await import("@textlint/kernel"); const { moduleInterop } = await import("@textlint/module-interop"); const tp = await import("@textlint/textlint-plugin-text"); const prh = await import("textlint-rule-prh"); const l = createLinter({ descriptor: new TextlintKernelDescriptor({ rules: [{ ruleId: "prh", rule: moduleInterop(prh.default ?? prh), options: { rulePaths: ["/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/rules/prh.yml"] } }], filterRules: [], plugins: [{ pluginId: "text", plugin: moduleInterop(tp.default ?? tp), options: true }] }) }); const r = await l.lintText("ユーザの一覧を表示する。", "/x.txt"); console.log(r.messages.map((m) => m.message).join("|"));'
```

Expected: `ユーザの => ユーザーの` と出力される。エラーが出て `imports` の相対パスが解決できない場合は、`rules/prh.yml` から `imports` を外し、代わりに Step 5 の `textlint-config.ts` で `rulePaths` に `rules/prh.yml` と `node_modules/prh/prh-rules/media/WEB+DB_PRESS.yml` の絶対パスを 2 本並べる方式へ切り替える（どちらも `new URL(..., import.meta.url).pathname` で組み立てる）。

- [ ] **Step 3: 失敗するテストを書く**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/lint.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { lintJapanese } from "./lint.ts";

function ruleIds(findings: { ruleId: string }[]): string[] {
  return findings.map((f) => f.ruleId);
}

describe("comment 文脈", () => {
  test("句点の無い文は通る", async () => {
    const outcome = await lintJapanese("句点のない一文です", "comment");
    expect(ruleIds(outcome.errors)).toEqual([]);
  });

  test("冗長表現は error になる", async () => {
    const outcome = await lintJapanese("ユーザーの情報の取得を行う。", "comment");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/ja-no-redundant-expression");
  });

  test("誇張表現は error になる", async () => {
    const outcome = await lintJapanese("これは革命的な実装です。", "comment");
    expect(ruleIds(outcome.errors)).toContain("ai-writing/no-ai-hype-expressions");
  });

  test("ai-tech-writing-guideline は無効", async () => {
    const outcome = await lintJapanese("まず最初に設定する。", "comment");
    expect(ruleIds(outcome.errors)).not.toContain("ai-writing/ai-tech-writing-guideline");
    expect(ruleIds(outcome.infos)).not.toContain("ai-writing/ai-tech-writing-guideline");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "comment");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });

  test("問題の無い文は error も info も 0 件", async () => {
    const outcome = await lintJapanese("ユーザー情報を取得する。", "comment");
    expect(outcome.errors).toEqual([]);
    expect(outcome.infos).toEqual([]);
  });
});

describe("commit 文脈", () => {
  test("句点の無いコミットメッセージは通る", async () => {
    const outcome = await lintJapanese("feat: ユーザー一覧を追加する", "commit");
    expect(ruleIds(outcome.errors)).not.toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("feat: ユーザの一覧を追加する", "commit");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });
});

describe("pr 文脈", () => {
  test("句点の無い文は error になる", async () => {
    const outcome = await lintJapanese("句点のない一文です", "pr");
    expect(ruleIds(outcome.errors)).toContain("ja-technical-writing/ja-no-mixed-period");
  });

  test("ai-tech-writing-guideline は info に分類される", async () => {
    const outcome = await lintJapanese("まず最初に設定する。", "pr");
    expect(ruleIds(outcome.infos)).toContain("ai-writing/ai-tech-writing-guideline");
    expect(ruleIds(outcome.errors)).not.toContain("ai-writing/ai-tech-writing-guideline");
  });

  test("prh が効く", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "pr");
    expect(ruleIds(outcome.errors)).toContain("prh");
  });
});

describe("Finding の中身", () => {
  test("指摘位置を含む文が quote に入る", async () => {
    const outcome = await lintJapanese("最初の文である。ユーザの一覧を表示する。", "comment");
    const prh = outcome.errors.find((f) => f.ruleId === "prh");
    expect(prh?.quote).toBe("ユーザの一覧を表示する。");
  });

  test("message が空でない", async () => {
    const outcome = await lintJapanese("ユーザの一覧を表示する。", "comment");
    const prh = outcome.errors.find((f) => f.ruleId === "prh");
    expect(prh?.message).toContain("ユーザー");
  });
});
```

- [ ] **Step 4: テストを実行して失敗を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/lint.test.ts`

Expected: FAIL（`./lint.ts` が存在しない）

- [ ] **Step 5: textlint-config.ts を実装する**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/textlint-config.ts`:

```ts
import type { TextlintKernelDescriptor, TextlintKernelRule } from "@textlint/kernel";
import type { TargetContext } from "./commands.ts";

/**
 * severity オプションが効かないルールの ruleId 集合。
 * ai-tech-writing-guideline は RuleError ではなくプレーンオブジェクトで報告するため、
 * textlint 側で severity が error に固定される。info 扱いはこちらで判定する。
 */
export const INFO_RULE_IDS: ReadonlySet<string> = new Set(["ai-writing/ai-tech-writing-guideline"]);

const PRH_PATH = new URL("../../rules/prh.yml", import.meta.url).pathname;

type Preset = {
  rules: Record<string, unknown>;
  rulesConfig: Record<string, unknown>;
};

function isPreset(value: unknown): value is Preset {
  return (
    typeof value === "object" &&
    value !== null &&
    "rules" in value &&
    "rulesConfig" in value &&
    typeof (value as { rules: unknown }).rules === "object"
  );
}

/**
 * プリセットを kernel が受け取れる TextlintKernelRule[] に展開する。
 * @textlint/kernel はプリセットを解釈しないため、ここで自前で展開する必要がある。
 * overrides に false を指定したルールは配列に入れないことで無効化する。
 */
function expandPreset(
  namespace: string,
  presetModule: unknown,
  overrides: Record<string, unknown>,
  interop: <T>(m: T) => T,
): TextlintKernelRule[] {
  const preset = interop(presetModule);
  if (!isPreset(preset)) return [];
  const rules: TextlintKernelRule[] = [];
  for (const [name, rule] of Object.entries(preset.rules)) {
    const options = name in overrides ? overrides[name] : preset.rulesConfig[name];
    if (options === false) continue;
    rules.push({
      ruleId: `${namespace}/${name}`,
      // as: kernel の TextlintRuleModule 型は各ルールの実体型を保持しないため、
      // 動的 import した値をここで受け渡す際に型情報を落とす必要がある
      rule: rule as TextlintKernelRule["rule"],
      options: options as TextlintKernelRule["options"],
    });
  }
  return rules;
}

/** 文脈ごとの descriptor を組み立てる。textlint 系は起動コスト回避のため動的 import する */
export async function buildDescriptor(context: TargetContext): Promise<TextlintKernelDescriptor> {
  const [kernel, interopModule, textPluginModule, jaTechModule, aiWritingModule, prhModule] =
    await Promise.all([
      import("@textlint/kernel"),
      import("@textlint/module-interop"),
      import("@textlint/textlint-plugin-text"),
      import("textlint-rule-preset-ja-technical-writing"),
      import("@textlint-ja/textlint-rule-preset-ai-writing"),
      import("textlint-rule-prh"),
    ]);

  const interop = interopModule.moduleInterop;

  // 句点は PR 本文だけで必須にする。コメントやコミットメッセージでは体言止めを許す
  const jaOverrides: Record<string, unknown> =
    context === "pr" ? {} : { "ja-no-mixed-period": false };

  // Markdown 構造を前提とする 4 ルールは、コメントやコミットメッセージでは誤検知になる
  const aiOverrides: Record<string, unknown> =
    context === "pr"
      ? {}
      : {
          "no-ai-list-formatting": false,
          "no-ai-emphasis-patterns": false,
          "no-ai-colon-continuation": false,
          "ai-tech-writing-guideline": false,
        };

  const rules: TextlintKernelRule[] = [
    ...expandPreset("ja-technical-writing", jaTechModule.default ?? jaTechModule, jaOverrides, interop),
    ...expandPreset("ai-writing", aiWritingModule.default ?? aiWritingModule, aiOverrides, interop),
    {
      ruleId: "prh",
      rule: interop(prhModule.default ?? prhModule) as TextlintKernelRule["rule"],
      options: { rulePaths: [PRH_PATH] },
    },
  ];

  return new kernel.TextlintKernelDescriptor({
    rules,
    filterRules: [],
    plugins: [
      {
        pluginId: "text",
        // as: plugin モジュールの型は動的 import では解決できないため受け渡し時に落とす
        plugin: interop(textPluginModule.default ?? textPluginModule) as never,
        options: true,
      },
    ],
  });
}
```

- [ ] **Step 6: lint.ts を実装する**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/lint.ts`:

```ts
import type { TargetContext } from "./commands.ts";
import { extractQuote, type Finding, type LintOutcome } from "./hook-io.ts";
import { buildDescriptor, INFO_RULE_IDS } from "./textlint-config.ts";

/** TextlintRuleSeverityLevelKeys.error の値 */
const SEVERITY_ERROR = 2;

/** プレーンテキストとして lint するための擬似パス。text plugin は拡張子で選ばれる */
const VIRTUAL_PATH = "/ja-lint/input.txt";

/**
 * 与えた文字列を文脈に応じて lint し、error と info に振り分けて返す。
 * textlint の読み込みは呼び出された時点で初めて行われる。
 */
export async function lintJapanese(text: string, context: TargetContext): Promise<LintOutcome> {
  const { createLinter } = await import("textlint");
  const descriptor = await buildDescriptor(context);
  const linter = createLinter({ descriptor });
  const result = await linter.lintText(text, VIRTUAL_PATH);

  const errors: Finding[] = [];
  const infos: Finding[] = [];
  for (const message of result.messages) {
    const finding: Finding = {
      ruleId: message.ruleId,
      message: message.message,
      quote: extractQuote(text, message.index),
    };
    const isInfo = INFO_RULE_IDS.has(message.ruleId) || message.severity !== SEVERITY_ERROR;
    if (isInfo) {
      infos.push(finding);
    } else {
      errors.push(finding);
    }
  }
  return { errors, infos };
}

/** 複数の文字列をまとめて lint し、結果を 1 つに畳み込む */
export async function lintAll(texts: string[], context: TargetContext): Promise<LintOutcome> {
  const merged: LintOutcome = { errors: [], infos: [] };
  for (const text of texts) {
    const outcome = await lintJapanese(text, context);
    merged.errors.push(...outcome.errors);
    merged.infos.push(...outcome.infos);
  }
  return merged;
}
```

- [ ] **Step 7: テストを実行して成功を確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib/lint.test.ts`

Expected: PASS（13 件）

失敗した場合、まず `bun run --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint -e 'const { buildDescriptor } = await import("./hooks/lib/textlint-config.ts"); const d = await buildDescriptor("pr"); console.log(JSON.stringify(d.toJSON().rule.map((r) => r.id)));'` で descriptor に載ったルール一覧を確認する。

- [ ] **Step 8: 全 lib テストが通ることを確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib`

Expected: PASS（hook-io 18 件 + comments 26 件 + commands 19 件 + lint 13 件 = 76 件）

コミットはユーザーの指示があるまで行わない。

---

### Task 6: post-edit.ts

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts`

**Interfaces:**
- Consumes:
  - `function parseHookPayload(raw: string): HookPayload | undefined`, `function readStringField(obj: Record<string, unknown>, key: string): string | undefined`, `function formatReason(outcome: LintOutcome): string`, `function postToolUseBlock(reason: string): string`, `function postToolUseAdvisory(context: string): string`（`./lib/hook-io.ts`）
  - `function containsJapanese(text: string): boolean`, `function addedLines(oldString: string, newString: string): string[]`, `function extractCommentBlocks(filePath: string, lines: string[]): string[]`（`./lib/comments.ts`）
  - `async function lintAll(texts: string[], context: TargetContext): Promise<LintOutcome>`（`./lib/lint.ts`、動的 import する）
- Produces: 実行可能な hook スクリプト。後続タスクからは参照されない

- [ ] **Step 1: 実装する**

自動テストは lib 側に寄せる方針のため、このタスクはテストファーストではなく実装 → 手動疎通（Step 2・3）で確認する。

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts`:

```ts
import { addedLines, containsJapanese, extractCommentBlocks } from "./lib/comments.ts";
import {
  formatReason,
  parseHookPayload,
  postToolUseAdvisory,
  postToolUseBlock,
  readStringField,
} from "./lib/hook-io.ts";

function targetLines(toolName: string, toolInput: Record<string, unknown>): string[] {
  if (toolName === "Write") {
    const content = readStringField(toolInput, "content");
    return content === undefined ? [] : content.split("\n");
  }
  if (toolName === "Edit") {
    const oldString = readStringField(toolInput, "old_string") ?? "";
    const newString = readStringField(toolInput, "new_string");
    return newString === undefined ? [] : addedLines(oldString, newString);
  }
  return [];
}

async function main(): Promise<void> {
  const payload = parseHookPayload(await Bun.stdin.text());
  if (payload === undefined) return;

  const filePath = readStringField(payload.toolInput, "file_path");
  if (filePath === undefined) return;

  const lines = targetLines(payload.toolName, payload.toolInput);
  if (lines.length === 0) return;

  const blocks = extractCommentBlocks(filePath, lines);
  if (blocks.length === 0) return;

  // 日本語が 1 文字も無ければ textlint を読み込まずに終わる。辞書読み込みで待たせないため
  if (!blocks.some(containsJapanese)) return;

  const { lintAll } = await import("./lib/lint.ts");
  const outcome = await lintAll(blocks, "comment");
  const reason = formatReason(outcome);
  if (reason === "") return;

  console.log(outcome.errors.length > 0 ? postToolUseBlock(reason) : postToolUseAdvisory(reason));
}

try {
  await main();
} catch (e) {
  // hook 自身の不調で編集を止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`ja-lint post-edit: ${message}\n`);
}
process.exit(0);
```

`node_modules` が無い場合は `import("./lib/lint.ts")` の中の `import("textlint")` が失敗し、この catch に落ちて stderr に 1 行出して exit 0 になる。

- [ ] **Step 2: 日本語コメントありの Edit で疎通確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/a.ts","old_string":"const a = 1;","new_string":"// ユーザの情報の取得を行う\nconst a = 1;"},"tool_output":"ok"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts
```

Expected: stdout に 1 行の JSON が出る。上位の `decision` が `"block"`、`reason` が `ja-lint: 日本語の文章に修正が必要です（error 2 件）` で始まり、`[prh] ユーザの => ユーザーの` と `[ja-technical-writing/ja-no-redundant-expression]` の 2 行を含む。`hookSpecificOutput` は含まれない。exit code は 0。

- [ ] **Step 3: 日本語なしの Edit で何も出ないことを確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/a.ts","old_string":"const a = 1;","new_string":"// TODO: fix later\nconst a = 1;"},"tool_output":"ok"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts
```

Expected: stdout は空、exit code 0。

- [ ] **Step 4: 対象外拡張子で何も出ないことを確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/a.md","content":"ユーザの情報の取得を行う"},"tool_output":"ok"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts
```

Expected: stdout は空、exit code 0。

- [ ] **Step 5: 壊れた stdin で落ちないことを確認**

Run: `echo 'not json' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/post-edit.ts`

Expected: stdout は空、exit code 0。

コミットはユーザーの指示があるまで行わない。

---

### Task 7: pre-bash.ts

**Files:**
- Create: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts`

**Interfaces:**
- Consumes:
  - `function parseHookPayload(raw: string): HookPayload | undefined`, `function readStringField(obj: Record<string, unknown>, key: string): string | undefined`, `function formatReason(outcome: LintOutcome): string`, `function preToolUseDeny(reason: string): string`, `function preToolUseAdvisory(context: string): string`（`./lib/hook-io.ts`）
  - `function extractLintTargets(command: string, readFile: (path: string) => string | undefined): LintTarget[]`（`./lib/commands.ts`）
  - `function containsJapanese(text: string): boolean`（`./lib/comments.ts`）
  - `async function lintJapanese(text: string, context: TargetContext): Promise<LintOutcome>`（`./lib/lint.ts`、動的 import する）
- Produces: 実行可能な hook スクリプト

- [ ] **Step 1: 実装する**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts`:

```ts
import { readFileSync } from "node:fs";
import { extractLintTargets } from "./lib/commands.ts";
import { containsJapanese } from "./lib/comments.ts";
import {
  formatReason,
  parseHookPayload,
  preToolUseAdvisory,
  preToolUseDeny,
  readStringField,
  type LintOutcome,
} from "./lib/hook-io.ts";

function readFileSafely(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const payload = parseHookPayload(await Bun.stdin.text());
  if (payload === undefined || payload.toolName !== "Bash") return;

  const command = readStringField(payload.toolInput, "command");
  if (command === undefined) return;

  const targets = extractLintTargets(command, readFileSafely);
  if (targets.length === 0) return;

  // 日本語が 1 文字も無ければ textlint を読み込まずに終わる
  if (!targets.some((t) => containsJapanese(t.text))) return;

  const { lintJapanese } = await import("./lib/lint.ts");
  const merged: LintOutcome = { errors: [], infos: [] };
  for (const target of targets) {
    if (!containsJapanese(target.text)) continue;
    const outcome = await lintJapanese(target.text, target.context);
    merged.errors.push(...outcome.errors);
    merged.infos.push(...outcome.infos);
  }

  const reason = formatReason(merged);
  if (reason === "") return;

  console.log(merged.errors.length > 0 ? preToolUseDeny(reason) : preToolUseAdvisory(reason));
}

try {
  await main();
} catch (e) {
  // hook 自身の不調でコマンド実行を止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`ja-lint pre-bash: ${message}\n`);
}
process.exit(0);
```

- [ ] **Step 2: git commit の deny を疎通確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: ユーザの設定の変更を行う\""},"tool_use_id":"t1"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout に 1 行の JSON。`hookSpecificOutput.hookEventName` が `"PreToolUse"`、`permissionDecision` が `"deny"`、`permissionDecisionReason` が `ja-lint: 日本語の文章に修正が必要です（error 2 件）` で始まり `[prh] ユーザの => ユーザーの` と `[ja-technical-writing/ja-no-redundant-expression]` を含む。exit code 0。

- [ ] **Step 3: 句点なしコミットメッセージが通ることを確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: ユーザー一覧を追加する\""},"tool_use_id":"t1"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout は空、exit code 0。

- [ ] **Step 4: PR 本文の句点なしが deny されることを確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"gh pr create --title \"ユーザー一覧を追加する\" --body \"一覧画面を追加しました\""},"tool_use_id":"t1"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout の `permissionDecisionReason` に `[ja-technical-writing/ja-no-mixed-period]` を含む行がある（タイトルは commit 文脈なので句点を求められず、本文だけが指摘される）。exit code 0。

- [ ] **Step 5: heredoc 形式のコミットメッセージを確認**

Run:

```
printf '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \\"$(cat <<%sEOF%s\\nfeat: 追加する\\n\\nユーザの情報を取得する処理である\\nEOF\\n)\\""},"tool_use_id":"t1"}' "'" "'" | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout の `permissionDecisionReason` に `[prh] ユーザの => ユーザーの` を含む。exit code 0。

- [ ] **Step 6: 対象外コマンドで何も出ないことを確認**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls -la"},"tool_use_id":"t1"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout は空、exit code 0。

コミットはユーザーの指示があるまで行わない。

---

### Task 8: 実環境での疎通確認と README の仕上げ

**Files:**
- Modify: `/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/README.md`

**Interfaces:**
- Consumes: Task 1〜7 で作ったすべてのファイル
- Produces: なし（最終タスク）

- [ ] **Step 1: 全テストが通ることを確認**

Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib`

Expected: PASS（76 件）。1 件でも失敗したら、そのテストの Task に戻って直す。

- [ ] **Step 2: node_modules を退避して依存欠落時の挙動を確認**

Run: `mv /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/node_modules /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/node_modules.bak`

続けて Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: ユーザの設定の変更を行う\""},"tool_use_id":"t1"}' | bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts
```

Expected: stdout は空、stderr に `ja-lint pre-bash: ` で始まる 1 行、exit code 0。

- [ ] **Step 3: node_modules を戻す**

Run: `mv /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/node_modules.bak /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/node_modules`

続けて Run: `bun test --cwd /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint hooks/lib`

Expected: PASS（76 件）。復帰できたことの確認である。

- [ ] **Step 4: hook の実行時間を測る**

Run:

```
echo '{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"feat: ユーザの設定の変更を行う\""},"tool_use_id":"t1"}' > /tmp/ja-lint-input.json
```

続けて Run: `/usr/bin/time -p bun run /Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/pre-bash.ts < /tmp/ja-lint-input.json`

Expected: `real` が hooks.json の timeout 30 秒を大きく下回る（事前調査では lint 本体で約 0.5 秒）。30 秒に近い場合は timeout の見直しをユーザーに相談する。

- [ ] **Step 5: README を仕上げる**

`/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/README.md` を次の内容で置き換える（外側の 4 連バッククォートは囲みであり、README には含めない）。

````markdown
# ja-lint

Claude Code が書く日本語を textlint で検査するプラグインである。

## 検査対象

- Edit / Write で書かれたソースコード内のコメント（Edit は追加行のみ）
- `git commit` のコミットメッセージ（`-m` / `--message` / `-F` / `--file` / heredoc）
- `gh pr create` / `gh pr edit` のタイトルと本文（`--title` / `--body` / `--body-file`）

Claude の応答文そのもの、Markdown ファイルの本文、人間が直接書いた文章は対象外である。

## 対象拡張子

- `//` と `/* */`: ts, tsx, js, jsx, mjs, cjs, vue, php, css, scss, go, rs, java, kt, swift
- `#`: yml, yaml, sh, bash, zsh, py, rb, toml, php
- `<!-- -->`: vue, html
- `--`: sql

## 文脈別のルール構成

- comment（コード内コメント）: ja-technical-writing 一式（`ja-no-mixed-period` を除く） + ai-writing の `no-ai-hype-expressions` + prh
- commit（コミットメッセージ、PR タイトル）: comment と同じ
- pr（PR 本文）: ja-technical-writing 一式（`ja-no-mixed-period` を含む） + ai-writing 5 ルール全部 + prh。`ai-tech-writing-guideline` だけは info 扱い

文末の句点「。」を必須にするのは pr 文脈だけである。

## 挙動

- `git commit` / `gh pr` は PreToolUse で検査し、error があれば `permissionDecision: "deny"` でコマンド実行を拒否する。info だけなら `additionalContext` で参考情報として返す
- Edit / Write は PostToolUse で検査し、error があれば上位の `decision: "block"` と `reason` で指摘を返す。info だけなら `additionalContext` で返す。PostToolUse はツール実行後に走るため編集自体は取り消されないが、reason は修正指示として Claude に届く
- 日本語（ひらがな・カタカナ・漢字）を 1 文字も含まない場合は textlint を読み込まずに終了する
- hook 自身が失敗した場合は stderr に 1 行残して何も返さない（ツール実行は止めない）

出力例:

```
ja-lint: 日本語の文章に修正が必要です（error 2 件）
- 「ユーザの情報の取得を行う」 [prh] ユーザの => ユーザーの
- 「ユーザの情報の取得を行う」 [ja-technical-writing/ja-no-redundant-expression] 【dict5】 "取得を行う"は冗長な表現です。"取得する"など簡潔な表現にすると文章が明瞭になります。
```

## 調整方法

- 表記ゆれ辞書: `rules/prh.yml`。prh パッケージ（MIT）同梱の `prh-rules/media/WEB+DB_PRESS.yml` を `imports` で読み込んでいる。独自項目は同ファイルの `rules:` に追記する
- ルールの有効・無効、固有名詞などの例外（各ルールの `allows`）: `hooks/lib/textlint-config.ts` の `jaOverrides` / `aiOverrides`
- 依存は `package.json` と `bun.lock` に基づき、プラグインのキャッシュ作成時に `bun install --frozen-lockfile --ignore-scripts` で自動インストールされる

## テスト

Run: `bun test --cwd ja-lint hooks/lib`
````

Task 5 Step 2 で `imports` が使えず `rulePaths` 2 本立て方式に切り替えた場合は、「調整方法」の記述をその方式に合わせて直す。

- [ ] **Step 6: README の記述がコードと一致しているか確認**

Run: `bun -e 'const m = await import("/Users/otto/workspace/mgzl-claude-code-plugin/ja-lint/hooks/lib/textlint-config.ts"); for (const c of ["comment", "commit", "pr"]) { const d = await m.buildDescriptor(c); console.log(c, d.toJSON().rule.map((r) => r.id).join(" ")); }'`

Expected: comment と commit の行に `ja-technical-writing/ja-no-mixed-period` と `ai-writing/ai-tech-writing-guideline` が含まれず、pr の行には両方が含まれる。3 行とも末尾が `prh` である。README の「文脈別のルール構成」と食い違っていたら README を直す。

コミットはユーザーの指示があるまで行わない。
