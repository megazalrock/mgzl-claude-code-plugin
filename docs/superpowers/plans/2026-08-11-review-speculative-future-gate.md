# cbo レビュアー「投機的未来ゲート」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cbo のコードレビュー系サブエージェント 4 種が「今は実装されていないが将来 X が追加されたら壊れる」という YAGNI 違反の指摘を出さないようにし、真の将来リスクは型・テストへの振替として `[1]` 上限で報告させる。

**Architecture:** 全レビュアーに同一文面の「投機的未来ゲート」を埋め込み、指摘の前提が「今日存在する入力・実行経路」であることを必須にする。そのうえで、ゲートと綱引きする既存条項（`reviewer-for-design` の Open/Closed、`reviewer-for-logic` の `a plausible edge case`）を直接書き換えて矛盾の根を絶つ。`reviewer-for-test-code` はゲートの適用対象であると同時に振替の受け皿でもあるため、両方の役割を明記する。自動テストの無い領域のため、各タスクの検証は `rg -F` によるアンカー文字列の存在・不在確認で行う。

**Tech Stack:** Markdown（Claude Code Agent 定義）、`rg`（検証）、`git`

## Global Constraints

- 設計書は `docs/superpowers/specs/2026-08-11-review-speculative-future-gate-design.md`
- 変更対象は `cbo/agents/` 配下の 4 ファイルのみ。`cbo/skills/` 配下・スクリプト・`marketplace.json`・`cbo/style-rule.md` は変更しない
- **挿入する文面はすべて英語**（対象 4 ファイルはいずれも英語で書かれている）。ただし Severity ラベル `軽微` / `推奨` / `ブロッキング` は既存どおり日本語のまま
- **共通ゲートの文面は 4 ファイルで完全に同一**にする。下の「共通ゲート文面（正本）」を逐語コピーすること。1 文字でも差があると Task 5 の同一性検証で落ちる
- Edit の位置指定は**行番号でなく既存文言のアンカー**で行う。ファイルは随時更新されうる
- **作業ブランチは `feat/cbo-review-speculative-future-gate`**。`main` へ直接コミットしない
- **各タスクは自身の変更をコミットして終える**（タスク末尾のコミットステップは必須）
- コミットメッセージは Conventional Commits 形式（`feat:` / `fix:` / `refactor:` / `chore:`）
- 計画書（`docs/superpowers/plans/`）・設計書（`docs/superpowers/specs/`）はコミット対象に含めない。各タスクは `cbo/agents/` 配下の変更のみを `git add` する
- `cbo/.claude-plugin/plugin.json` に `version` を追加しない（プロジェクト方針: プラグインのバージョンは管理しない）

### 設計書に無い追加（実装者向けの申し送り）

各レビュアーの Review process 末尾にある **Self-review 工程へゲートの再確認を 1 行足す**（Task 1 Step 6 / Task 2 Step 7 / Task 3 Step 3 / Task 4 Step 7）。設計書には明記されていないが、ゲートは「applies to every finding」であり、Self-review が唯一の全指摘横断チェックポイントであるため、ここに掛けないとゲートが実効を持たない。ユーザーがこの追加を望まない場合は該当ステップのみスキップしてよく、他ステップへの影響は無い。

---

## 共通ゲート文面（正本）

Task 1〜4 はこのブロックを**逐語コピー**して各ファイルへ挿入する。挿入位置は各ファイルの `Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.` の直後（空行を 1 つ挟む）。

```markdown
## Speculative-future gate (applies to every finding)

Before writing any finding, answer this: *does the defect reproduce with an input or execution path that exists in the codebase today?*

- **Yes** → report it normally.
- **No** → it is a speculative-future finding. Do **not** ask for defensive code in the implementation.

A finding is speculative-future when its premise is "if someone later adds X" / "if a new value is introduced" / "if this gets reused elsewhere" — the breakage requires a change that has not been made.

### Exceptions — defensive code IS legitimate here

1. **External boundaries.** API / HTTP responses, URL query and path params, `localStorage` / `sessionStorage` / cookies, user input, `postMessage`, environment variables. The declared type is a claim, not a proof; runtime handling of unexpected values is required behavior, not speculation.
2. **Planned extensions.** The extension is written down concretely — an implementation plan under review, a `TODO` in the diff, or a ticket referenced in the code. A documented plan is not a hypothetical.

### Redirect rule

A real future-breakage risk that fails the gate and matches no exception is neither dropped silently nor turned into a guard. Convert it into either:

- **a type-level obligation** — make the compiler the enforcer (exhaustive `switch` with a `never` check, discriminated union, `satisfies`), so adding a case fails the build instead of failing silently; or
- **a test-level obligation** — pin current behavior so a future change turns the test red.

Report the redirected finding at **`[1]` 軽微 — this is a hard cap** — and state explicitly that the implementation must not be hardened for the hypothetical.
```

---

## File Structure

- `cbo/agents/reviewer-for-design.md` — **矛盾の中心**。ゲート + Open/Closed 条項の限定 + severity `[3]` の抜け道封じ + YAGNI との優先関係の明示
- `cbo/agents/reviewer-for-logic.md` — **第二の発生源**。ゲート + エッジケースの到達可能性要求 + `a plausible edge case` の撤去
- `cbo/agents/reviewer-for-security-performance.md` — ゲートのみ。既存条項に「将来」前提のものが無い
- `cbo/agents/reviewer-for-test-code.md` — **ゲートの適用対象 かつ 振替の受け皿**。ゲート + テスト用スコープ注記 + 冗長判定の叩き返し防止 + 5.5 の `[1]` 降格

### 変更しないもの（判断根拠）

- `cbo/agents/implementation-plan-reviewer.md` — 同種の矛盾がありうるが今回は非スコープ（設計書の合意事項）
- `cbo/agents/knowledge-distiller.md` — 振替指摘が `[1]` 上限になることで教訓化経路（severity 2 以上のみ）が自動的に塞がるため、逆流防止弁は不要
- `cbo/agents/reviewer-for-comments.md` — コメントレビューでは投機的未来を前提とする指摘が出にくい
- `cbo/skills/review__diff/SKILL.md` — 統合段階でのフィルタは二重管理になるため導入しない

### 作業順序の根拠

Task 1（design）を先頭に置くのは、ゲートと最も強く綱引きする条項を持つファイルだからである。Task 2〜4 は Task 1 と独立して実行できるが、ゲート文面の正本は本計画書にあるため、順序を入れ替えても文面は一致する。

---

## Task 0: 作業ブランチの作成

**Files:**
- Modify: なし

**Interfaces:**
- Consumes: なし
- Produces: 作業ブランチ `feat/cbo-review-speculative-future-gate`

- [ ] **Step 1: 作業ツリーがクリーンであることを確認**

Run: `git -C /Users/otto/workspace/mgzl-claude-code-plugin status --porcelain`

Expected: 出力が空、または `docs/superpowers/` 配下の未追跡ファイルのみ。`cbo/` 配下に未コミットの変更があれば先にユーザーへ確認する。

- [ ] **Step 2: ブランチを作成して切り替え**

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin switch -c feat/cbo-review-speculative-future-gate
```

- [ ] **Step 3: ブランチが切り替わったことを確認**

Run: `git -C /Users/otto/workspace/mgzl-claude-code-plugin branch --show-current`

Expected: `feat/cbo-review-speculative-future-gate`

---

## Task 1: `reviewer-for-design` の YAGNI / Open-Closed 矛盾を解消する

**Files:**
- Modify: `cbo/agents/reviewer-for-design.md`

**Interfaces:**
- Consumes: 本計画書の「共通ゲート文面（正本）」
- Produces: なし（各タスクは独立）

このファイルは 82 行目で「仮定的な未来のための追加を叩け」（YAGNI）と命じながら、79 行目で「予見しうる拡張に備えていない設計を叩け」（Open/Closed）と命じている。どちらに転んでもレビュアーは「指示に従った」と正当化できるため、ゲートを足すだけでは不十分で、Open/Closed 側の文面そのものを限定する必要がある。

- [ ] **Step 1: 置換対象のアンカーが存在することを確認**

Run:

```bash
rg -n -F -e "Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading." -e "Flag designs that force shotgun-surgery for foreseeable extensions." -e "#### YAGNI (You Aren't Gonna Need It)" -e "severe responsibility breakdown that will block future work" -e "7. **Self-review** the draft report and drop anything outside design territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-design.md
```

Expected: 5 行すべてヒットする。ヒットしない語があればファイルが更新されているので、該当箇所を Read して置換対象を特定し直す。

- [ ] **Step 2: 共通ゲートを挿入**

`Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.` の行を、以下で置換する（元の行を残したうえで、空行を挟んでゲート全文を続ける）。

```markdown
Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.

## Speculative-future gate (applies to every finding)

Before writing any finding, answer this: *does the defect reproduce with an input or execution path that exists in the codebase today?*

- **Yes** → report it normally.
- **No** → it is a speculative-future finding. Do **not** ask for defensive code in the implementation.

A finding is speculative-future when its premise is "if someone later adds X" / "if a new value is introduced" / "if this gets reused elsewhere" — the breakage requires a change that has not been made.

### Exceptions — defensive code IS legitimate here

1. **External boundaries.** API / HTTP responses, URL query and path params, `localStorage` / `sessionStorage` / cookies, user input, `postMessage`, environment variables. The declared type is a claim, not a proof; runtime handling of unexpected values is required behavior, not speculation.
2. **Planned extensions.** The extension is written down concretely — an implementation plan under review, a `TODO` in the diff, or a ticket referenced in the code. A documented plan is not a hypothetical.

### Redirect rule

A real future-breakage risk that fails the gate and matches no exception is neither dropped silently nor turned into a guard. Convert it into either:

- **a type-level obligation** — make the compiler the enforcer (exhaustive `switch` with a `never` check, discriminated union, `satisfies`), so adding a case fails the build instead of failing silently; or
- **a test-level obligation** — pin current behavior so a future change turns the test red.

Report the redirected finding at **`[1]` 軽微 — this is a hard cap** — and state explicitly that the implementation must not be hardened for the hypothetical.
```

- [ ] **Step 3: Open/Closed 条項を「計画済み拡張」に限定**

置換前:

```markdown
- **Open/Closed**: adding new behavior should not require modifying every consumer. Flag designs that force shotgun-surgery for foreseeable extensions.
```

置換後:

```markdown
- **Open/Closed**: adding new behavior should not require modifying every consumer. Flag shotgun-surgery designs **only when the extension is already planned** (named in an implementation plan under review, a `TODO` in the diff, or a referenced ticket). "Someone might add a case later" is a YAGNI-violating premise — route it through the speculative-future gate.
```

- [ ] **Step 4: YAGNI 条項へゲートとの優先関係を追記**

置換前:

```markdown
#### YAGNI (You Aren't Gonna Need It)
- Flag speculative configuration, parameters, or abstractions added for hypothetical futures
```

置換後:

```markdown
#### YAGNI (You Aren't Gonna Need It)
- Flag speculative configuration, parameters, or abstractions added for hypothetical futures
- This is the mirror image of the speculative-future gate: the gate stops **you** from demanding hypothetical-future code, YAGNI stops the **author** from shipping it. When both could apply, the gate wins — never demand a guard to satisfy Open/Closed
```

- [ ] **Step 5: severity `[3]` の抜け道を塞ぐ**

置換前（テーブル 1 行の末尾部分）:

```
severe responsibility breakdown that will block future work |
```

置換後:

```
severe responsibility breakdown demonstrable in the current diff (e.g. one file now owns fetching, presentation, and business rules) |
```

- [ ] **Step 6: Self-review 工程へゲートの再確認を追加**

置換前:

```markdown
7. **Self-review** the draft report and drop anything outside design territory
```

置換後:

```markdown
7. **Self-review** the draft report and drop (a) anything outside design territory, and (b) every finding that fails the speculative-future gate and matches none of its exceptions — unless you have already converted it into a type-level or test-level obligation capped at `[1]`
```

- [ ] **Step 7: 旧文言が消えたことを検証**

Run:

```bash
rg -n -F -e "foreseeable extensions" -e "will block future work" -e "drop anything outside design territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-design.md
```

Expected: ヒット 0 件（終了コード 1）。ヒットしたら該当ステップの置換が適用されていない。

- [ ] **Step 8: 新文言が入ったことを検証**

Run:

```bash
rg -c -F -e "Speculative-future gate (applies to every finding)" -e "only when the extension is already planned" -e "the mirror image of the speculative-future gate" -e "demonstrable in the current diff" -e "drop (a) anything outside design territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-design.md
```

Expected: `5`

- [ ] **Step 9: 構造が壊れていないことを目視確認**

Read で `## Out of scope (do not report)` から `### 1. Coding principles` までを読み、次を確認する。

1. `## Out of scope (do not report)` → `## Speculative-future gate (applies to every finding)` → `## Review criteria` → `### 1. Coding principles` の順で並んでいること
2. ゲート内の見出しが `### Exceptions — defensive code IS legitimate here` と `### Redirect rule` の 2 つで、いずれも h3 であること
3. フロントマターが壊れていないこと（`rg -c "^name: " <file>` が `1`）

- [ ] **Step 10: コミット**

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin add cbo/agents/reviewer-for-design.md
git -C /Users/otto/workspace/mgzl-claude-code-plugin commit -m "fix: reviewer-for-design の YAGNI と Open/Closed の矛盾を投機的未来ゲートで解消"
```

---

## Task 2: `reviewer-for-logic` のエッジケース基準へ到達可能性を課す

**Files:**
- Modify: `cbo/agents/reviewer-for-logic.md`

**Interfaces:**
- Consumes: 本計画書の「共通ゲート文面（正本）」
- Produces: なし

このファイルはエッジケースの列挙（空配列・null・ゼロ・最大値…）を求めるだけで、その入力が現在の型・呼び出し元・API 契約から到達しうるかを問うていない。加えて severity `[2]` の定義に `a plausible edge case` とあり、想像できるだけで `[2]` を撃てる。

- [ ] **Step 1: 置換対象のアンカーが存在することを確認**

Run:

```bash
rg -n -F -e "Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading." -e "### 2. Edge-case coverage" -e "a plausible edge case" -e "3. **Enumerate edge cases** — for each input, list which boundary conditions matter" -e "7. **Self-review** the draft report and drop anything outside logic territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-logic.md
```

Expected: 5 行すべてヒットする。

- [ ] **Step 2: 共通ゲートを挿入**

`Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.` の行を、以下で置換する。

```markdown
Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.

## Speculative-future gate (applies to every finding)

Before writing any finding, answer this: *does the defect reproduce with an input or execution path that exists in the codebase today?*

- **Yes** → report it normally.
- **No** → it is a speculative-future finding. Do **not** ask for defensive code in the implementation.

A finding is speculative-future when its premise is "if someone later adds X" / "if a new value is introduced" / "if this gets reused elsewhere" — the breakage requires a change that has not been made.

### Exceptions — defensive code IS legitimate here

1. **External boundaries.** API / HTTP responses, URL query and path params, `localStorage` / `sessionStorage` / cookies, user input, `postMessage`, environment variables. The declared type is a claim, not a proof; runtime handling of unexpected values is required behavior, not speculation.
2. **Planned extensions.** The extension is written down concretely — an implementation plan under review, a `TODO` in the diff, or a ticket referenced in the code. A documented plan is not a hypothetical.

### Redirect rule

A real future-breakage risk that fails the gate and matches no exception is neither dropped silently nor turned into a guard. Convert it into either:

- **a type-level obligation** — make the compiler the enforcer (exhaustive `switch` with a `never` check, discriminated union, `satisfies`), so adding a case fails the build instead of failing silently; or
- **a test-level obligation** — pin current behavior so a future change turns the test red.

Report the redirected finding at **`[1]` 軽微 — this is a hard cap** — and state explicitly that the implementation must not be hardened for the hypothetical.
```

- [ ] **Step 3: エッジケース節の冒頭へ到達可能性の要求を挿入**

置換前:

```markdown
### 2. Edge-case coverage

- Empty arrays, empty strings, `null`, `undefined`, zero, negative numbers
```

置換後:

```markdown
### 2. Edge-case coverage

Every edge case you list must be traced to an input that can occur today — check the declared type, every call site in the diff, and the API contract. An input the type system forbids and no call site produces is not an edge case; it is a speculative future.

- Empty arrays, empty strings, `null`, `undefined`, zero, negative numbers
```

- [ ] **Step 4: severity `[2]` から `a plausible edge case` を撤去**

置換前（テーブル 1 行の本文部分）:

```
A likely correctness issue, a significant unhandled edge case, a plausible edge case, or a possible performance concern on growing data — should be fixed before merge
```

置換後:

```
A likely correctness issue, a significant unhandled edge case reachable from an input that exists today, or a possible performance concern on growing data — should be fixed before merge
```

- [ ] **Step 5: Review process Step 3 へ到達可能性の破棄工程を追加**

置換前:

```markdown
3. **Enumerate edge cases** — for each input, list which boundary conditions matter
```

置換後:

```markdown
3. **Enumerate edge cases** — for each input, list which boundary conditions matter, then discard every case whose triggering input cannot occur today. Reachability is part of the finding, not an afterthought
```

- [ ] **Step 6: Self-review 工程へゲートの再確認を追加**

置換前:

```markdown
7. **Self-review** the draft report and drop anything outside logic territory
```

置換後:

```markdown
7. **Self-review** the draft report and drop (a) anything outside logic territory, and (b) every finding that fails the speculative-future gate and matches none of its exceptions — unless you have already converted it into a type-level or test-level obligation capped at `[1]`
```

- [ ] **Step 7: 旧文言が消えたことを検証**

Run:

```bash
rg -n -F -e "a plausible edge case" -e "drop anything outside logic territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-logic.md
```

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 8: 新文言が入ったことを検証**

Run:

```bash
rg -c -F -e "Speculative-future gate (applies to every finding)" -e "must be traced to an input that can occur today" -e "reachable from an input that exists today" -e "Reachability is part of the finding" -e "drop (a) anything outside logic territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-logic.md
```

Expected: `5`

- [ ] **Step 9: 構造が壊れていないことを目視確認**

Read で `## Out of scope (do not report)` から `### 3. Exception handling` までを読み、次を確認する。

1. `## Out of scope` → `## Speculative-future gate` → `## Review criteria` → `### 1. Logic correctness` → `### 2. Edge-case coverage` の順で並んでいること
2. `### 2. Edge-case coverage` の既存 5 項目（空配列 / 最大値 / 並行トリガー / 初回レンダー / ネットワーク失敗）が 1 つも失われていないこと
3. `### 3. Exception handling` 配下の埋め込みルール（`AxiosError` パターンとコード例）が無傷であること

- [ ] **Step 10: コミット**

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin add cbo/agents/reviewer-for-logic.md
git -C /Users/otto/workspace/mgzl-claude-code-plugin commit -m "fix: reviewer-for-logic のエッジケース指摘に到達可能性の要件を課す"
```

---

## Task 3: `reviewer-for-security-performance` へ共通ゲートを入れる

**Files:**
- Modify: `cbo/agents/reviewer-for-security-performance.md`

**Interfaces:**
- Consumes: 本計画書の「共通ゲート文面（正本）」
- Produces: なし

このファイルには「将来」を前提とする条項が無いため、変更はゲートの挿入と Self-review への 1 行追加のみ。`Memory-leak risk` / `Possibility of unnecessary re-renders` は現在のコードで起こる事象を指しているので**変更しない**。

- [ ] **Step 1: 置換対象のアンカーが存在することを確認**

Run:

```bash
rg -n -F -e "Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading." -e "7. **Self-review** the draft report — confirm each finding is genuinely a security/performance issue and not better suited to another reviewer" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-security-performance.md
```

Expected: 2 行ともヒットする。

- [ ] **Step 2: 共通ゲートを挿入**

`Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.` の行を、以下で置換する。

```markdown
Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.

## Speculative-future gate (applies to every finding)

Before writing any finding, answer this: *does the defect reproduce with an input or execution path that exists in the codebase today?*

- **Yes** → report it normally.
- **No** → it is a speculative-future finding. Do **not** ask for defensive code in the implementation.

A finding is speculative-future when its premise is "if someone later adds X" / "if a new value is introduced" / "if this gets reused elsewhere" — the breakage requires a change that has not been made.

### Exceptions — defensive code IS legitimate here

1. **External boundaries.** API / HTTP responses, URL query and path params, `localStorage` / `sessionStorage` / cookies, user input, `postMessage`, environment variables. The declared type is a claim, not a proof; runtime handling of unexpected values is required behavior, not speculation.
2. **Planned extensions.** The extension is written down concretely — an implementation plan under review, a `TODO` in the diff, or a ticket referenced in the code. A documented plan is not a hypothetical.

### Redirect rule

A real future-breakage risk that fails the gate and matches no exception is neither dropped silently nor turned into a guard. Convert it into either:

- **a type-level obligation** — make the compiler the enforcer (exhaustive `switch` with a `never` check, discriminated union, `satisfies`), so adding a case fails the build instead of failing silently; or
- **a test-level obligation** — pin current behavior so a future change turns the test red.

Report the redirected finding at **`[1]` 軽微 — this is a hard cap** — and state explicitly that the implementation must not be hardened for the hypothetical.
```

- [ ] **Step 3: Self-review 工程へゲートの再確認を追加**

置換前:

```markdown
7. **Self-review** the draft report — confirm each finding is genuinely a security/performance issue and not better suited to another reviewer
```

置換後:

```markdown
7. **Self-review** the draft report — confirm each finding is genuinely a security/performance issue and not better suited to another reviewer, and drop every finding that fails the speculative-future gate and matches none of its exceptions unless it has been converted into a type-level or test-level obligation capped at `[1]`
```

- [ ] **Step 4: 新文言が入ったことを検証**

Run:

```bash
rg -c -F -e "Speculative-future gate (applies to every finding)" -e "and drop every finding that fails the speculative-future gate" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-security-performance.md
```

Expected: `2`

- [ ] **Step 5: 既存の検出条項が失われていないことを検証**

Run:

```bash
rg -c -F -e "Credential exposure" -e "XSS vulnerabilities" -e "Path traversal" -e "CSRF vulnerabilities" -e "Unsafe dependencies" -e "Memory-leak risk" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-security-performance.md
```

Expected: `6` 以上（`Detection checklist` にも同語が出現するため 6 を下回らない）

- [ ] **Step 6: コミット**

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin add cbo/agents/reviewer-for-security-performance.md
git -C /Users/otto/workspace/mgzl-claude-code-plugin commit -m "feat: reviewer-for-security-performance に投機的未来ゲートを追加"
```

---

## Task 4: `reviewer-for-test-code` をゲート適用対象かつ振替の受け皿にする

**Files:**
- Modify: `cbo/agents/reviewer-for-test-code.md`

**Interfaces:**
- Consumes: 本計画書の「共通ゲート文面（正本）」
- Produces: なし

このファイルだけは役割が二重になる。**ゲートの適用対象**（テストコード自身が将来壊れるという指摘は投機）であると同時に、**他レビュアーからの振替の受け皿**（「テストで固定せよ」と振り替えられたテストを冗長と叩き返さない）でもある。加えて §5.5 が投機的条項そのものなので `[1]` へ降格する（4 箇所を同期して変更）。

- [ ] **Step 1: 置換対象のアンカーが存在することを確認**

Run:

```bash
rg -n -F -e "Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading." -e "- Snapshot tests that do not produce meaningful value" -e "#### 5.5 Module-level mutable state as a future footgun" -e "#### 5.6 Characterization tests must annotate intent" -e "single-slot \`afterEach\` cleanup target |" -e "6. **Self-review** the draft report — ensure each finding is appropriate and necessary" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: 6 行すべてヒットする。`- Snapshot tests that do not produce meaningful value` は §2 と `#### [1] 軽微` の両方に類似行があるため、Read で §2 側（`### 2. Test-redundancy detection` 配下）を特定してから置換すること。

- [ ] **Step 2: 共通ゲートとテスト用スコープ注記を挿入**

`Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.` の行を、以下で置換する。ゲート本文は他 3 ファイルと**完全に同一**で、その後ろにテスト固有のスコープ注記が続く。

```markdown
Do **not** run eslint, tsc, or any other static-analysis CLI. Review by reading.

## Speculative-future gate (applies to every finding)

Before writing any finding, answer this: *does the defect reproduce with an input or execution path that exists in the codebase today?*

- **Yes** → report it normally.
- **No** → it is a speculative-future finding. Do **not** ask for defensive code in the implementation.

A finding is speculative-future when its premise is "if someone later adds X" / "if a new value is introduced" / "if this gets reused elsewhere" — the breakage requires a change that has not been made.

### Exceptions — defensive code IS legitimate here

1. **External boundaries.** API / HTTP responses, URL query and path params, `localStorage` / `sessionStorage` / cookies, user input, `postMessage`, environment variables. The declared type is a claim, not a proof; runtime handling of unexpected values is required behavior, not speculation.
2. **Planned extensions.** The extension is written down concretely — an implementation plan under review, a `TODO` in the diff, or a ticket referenced in the code. A documented plan is not a hypothetical.

### Redirect rule

A real future-breakage risk that fails the gate and matches no exception is neither dropped silently nor turned into a guard. Convert it into either:

- **a type-level obligation** — make the compiler the enforcer (exhaustive `switch` with a `never` check, discriminated union, `satisfies`), so adding a case fails the build instead of failing silently; or
- **a test-level obligation** — pin current behavior so a future change turns the test red.

Report the redirected finding at **`[1]` 軽微 — this is a hard cap** — and state explicitly that the implementation must not be hardened for the hypothetical.

### Scope note for test code

A test that exists to catch a *future* change to the implementation is the whole point of testing — never gate it, and never call it redundant. The gate applies only to findings about the **test code itself** breaking in the future ("if a future test calls setup twice", "if someone adds a case here later"). Those are speculative and capped at `[1]`.
```

- [ ] **Step 3: §2 Test-redundancy detection へ叩き返し防止を追記**

`### 2. Test-redundancy detection` 配下の箇条書き末尾を置換する。

置換前:

```markdown
- Snapshot tests that do not produce meaningful value

### 3. Test-file organization
```

置換後:

```markdown
- Snapshot tests that do not produce meaningful value

Tests that pin current behavior against a future change — characterization tests (§5.6), and tests redirected here by another reviewer's speculative-future gate — are **not** redundant. Do not flag them under this section.

### 3. Test-file organization
```

これが無いと、`reviewer-for-logic` が「テストで固定せよ」と振り替えた先で `reviewer-for-test-code` が「冗長なテスト」として叩き落とす事故が起きる。

- [ ] **Step 4: §5.5 の見出しから "future footgun" を外し、本文末尾へ `[1]` 上限を明記**

置換前（見出し行）:

```markdown
#### 5.5 Module-level mutable state as a future footgun
```

置換後:

```markdown
#### 5.5 Module-level single-slot cleanup targets
```

続けて、§5.5 のコード例の閉じフェンス直後（`#### 5.6 Characterization tests must annotate intent` の直前）へ 1 段落を挿入する。

置換前:

```markdown
#### 5.6 Characterization tests must annotate intent
```

置換後:

```markdown
Under the speculative-future gate this is a speculative finding — no test calls setup twice today. Report it as a test-level obligation and cap it at `[1]`.

#### 5.6 Characterization tests must annotate intent
```

- [ ] **Step 5: 検出チェックリストの該当項目を `[2]` から `[1]` へ移動**

置換前:

```markdown
- [ ] Module-level single-slot variable (`let scope`, `let controller`, etc.) used to hold an `afterEach` cleanup target — convert to an array

#### [1] 軽微
- [ ] Room to improve `describe` block structure
```

置換後:

```markdown

#### [1] 軽微
- [ ] Module-level single-slot variable (`let scope`, `let controller`, etc.) used to hold an `afterEach` cleanup target — convert to an array
- [ ] Room to improve `describe` block structure
```

置換後の先頭は**空行**であることに注意（`#### [2] 推奨` 側の最後の項目と `#### [1] 軽微` 見出しの間の空行を維持するため）。

- [ ] **Step 6: Severity reference テーブルの例示を移す**

置換前（`[2]` 行の末尾部分）:

```
parametrization / assertion granularity inconsistency, single-slot `afterEach` cleanup target |
```

置換後:

```
parametrization / assertion granularity inconsistency |
```

続けて、`[1]` 行の末尾部分を置換する。

置換前:

```
| `[1]` | 軽微 | Optional refinement | `describe` structure, naming, low-value snapshot, uncommented characterization test |
```

置換後:

```
| `[1]` | 軽微 | Optional refinement | `describe` structure, naming, low-value snapshot, uncommented characterization test, single-slot `afterEach` cleanup target |
```

- [ ] **Step 7: Self-review 工程へゲートの再確認を追加**

置換前:

```markdown
6. **Self-review** the draft report — ensure each finding is appropriate and necessary
```

置換後:

```markdown
6. **Self-review** the draft report — ensure each finding is appropriate and necessary, and confirm that every finding about the test code breaking in the future is capped at `[1]` per the speculative-future gate
```

- [ ] **Step 8: 旧文言が消えたことを検証**

Run:

```bash
rg -n -F -e "Module-level mutable state as a future footgun" -e "granularity inconsistency, single-slot" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 9: 新文言が入ったことを検証**

Run:

```bash
rg -c -F -e "Speculative-future gate (applies to every finding)" -e "Scope note for test code" -e "are **not** redundant. Do not flag them under this section." -e "Module-level single-slot cleanup targets" -e "Report it as a test-level obligation and cap it at" -e "capped at \`[1]\` per the speculative-future gate" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: `6`

- [ ] **Step 10: `[2]` / `[1]` チェックリストの配置を検証**

Run:

```bash
rg -n -F -e "#### [3] ブロッキング" -e "#### [2] 推奨" -e "#### [1] 軽微" -e "Module-level single-slot variable" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: `Module-level single-slot variable` の行番号が `#### [1] 軽微` より**大きい**こと。`#### [2] 推奨` と `#### [1] 軽微` の間に入っていたら Step 5 の置換が崩れている。

- [ ] **Step 11: 構造が壊れていないことを目視確認**

Read で §5.4 から §5.6 までと `## Detection checklist` 全体を読み、次を確認する。

1. §5.5 のコード例（Bad / Good 双方）が無傷であること
2. §5.6 の内容が変わっていないこと（§2 の新規文が `(§5.6)` として参照している）
3. `#### [1] 軽微` の項目が 5 件になっていること（既存 4 件 + 移設 1 件）
4. Severity reference テーブルの `[2]` 行と `[1]` 行がいずれもテーブル記法として壊れていないこと（先頭・末尾の `|` が残っている）

- [ ] **Step 12: コミット**

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin add cbo/agents/reviewer-for-test-code.md
git -C /Users/otto/workspace/mgzl-claude-code-plugin commit -m "feat: reviewer-for-test-code を投機的未来ゲートの受け皿とし 5.5 を軽微へ降格"
```

---

## Task 5: クロスファイル整合の最終検証

**Files:**
- Modify: なし（検証のみ。不整合が見つかった場合は該当タスクへ戻る）

**Interfaces:**
- Consumes: Task 1〜4 のすべての変更
- Produces: なし

ゲート文面が 4 ファイルで完全一致していることが本タスクの主眼。1 ファイルだけ表現が揺れると、レビュアー間で判断基準がずれる。

- [ ] **Step 1: ゲートが 4 ファイルすべてに入ったことを検証**

Run:

```bash
rg -l -F "Speculative-future gate (applies to every finding)" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents
```

Expected: 次の 4 ファイルのみ。

- `reviewer-for-design.md`
- `reviewer-for-logic.md`
- `reviewer-for-security-performance.md`
- `reviewer-for-test-code.md`

- [ ] **Step 2: ゲート文面が 4 ファイルで同一であることを検証**

Run:

```bash
rg -c -F -e "does the defect reproduce with an input or execution path that exists in the codebase today" -e "it is a speculative-future finding. Do **not** ask for defensive code in the implementation." -e "**External boundaries.**" -e "**Planned extensions.**" -e "is neither dropped silently nor turned into a guard" -e "this is a hard cap" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-design.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-logic.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-security-performance.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: 4 ファイルすべてが `6`。ここで使う 6 語はいずれもゲート内にしか現れないため、1 つでも欠けていればゲートの逐語コピーに失敗している。

**注意**: `a type-level obligation` / `a test-level obligation` は Self-review 工程の追記文にも現れるため、同一性の検証には使えない。上の 6 語を使うこと。

- [ ] **Step 3: 旧基準が cbo 配下から消えたことを検証**

Run:

```bash
rg -n -F -e "foreseeable extensions" -e "will block future work" -e "a plausible edge case" -e "Module-level mutable state as a future footgun" -e "drop anything outside design territory" -e "drop anything outside logic territory" /Users/otto/workspace/mgzl-claude-code-plugin/cbo
```

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 4: 非スコープのファイルが変更されていないことを検証**

Run:

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin diff main...HEAD --stat
```

Expected: `cbo/agents/` 配下の 4 ファイルのみが変更されている。`cbo/skills/`・`marketplace.json`・`docs/`・`cbo/agents/implementation-plan-reviewer.md`・`cbo/agents/knowledge-distiller.md`・`cbo/agents/reviewer-for-comments.md` に変更が出ていたら誤編集。

- [ ] **Step 5: フロントマターが壊れていないことを検証**

Run:

```bash
rg -c "^name: " /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-design.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-logic.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-security-performance.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-test-code.md
```

Expected: 全 4 ファイルが `1`

- [ ] **Step 6: 教訓化経路が塞がることを設計どおり確認**

Read で `cbo/skills/review__diff/SKILL.md` の Step 10 を読み、`severity` が 2 以上の指摘がある場合のみ `@knowledge-distiller` を起動する条件が変わっていないことを確認する。振替指摘が `[1]` 上限であることと合わせ、投機的指摘が `implementation-lessons.md` へ到達しない経路になっていることを確認する。

このステップは**読み取りのみ**。`review__diff/SKILL.md` を変更してはならない。

- [ ] **Step 7: ゲートと既存 Out of scope の役割分担を目視確認**

Read で 4 ファイルそれぞれの `## Out of scope (do not report)` と `## Speculative-future gate` を並べて読み、次を確認する。

1. `Out of scope` が**観点の縦割り**（logic の話 / design の話）のみを扱い、ゲートが**指摘の適格性**を扱う、という役割分担になっていること
2. ゲートの例外 1（External boundaries）が、`reviewer-for-security-performance` の「ユーザー入力の検証」系の指摘を殺していないこと
3. `reviewer-for-test-code` のスコープ注記が、「実装の将来変更を検知するテスト」を保護し、「テストコード自身の将来の破損」だけをゲート対象にしていること

- [ ] **Step 8: 差分の全体像を最終確認**

Run:

```bash
git -C /Users/otto/workspace/mgzl-claude-code-plugin diff main...HEAD
```

差分を通読し、意図しない行の削除・インデント崩れ・テーブル記法の破損が無いことを確認する。

---

## 実行後の後始末

- [ ] 本計画書 `docs/superpowers/plans/2026-08-11-review-speculative-future-gate.md` と設計書 `docs/superpowers/specs/2026-08-11-review-speculative-future-gate-design.md` の扱いをユーザーに確認する（リポジトリへ残す / 削除する）
- [ ] ブランチ `feat/cbo-review-speculative-future-gate` を `main` へマージするか、PR を作成するかをユーザーに確認する
- [ ] 変更後のレビュアーを実際の差分に対して 1 回走らせ、投機的指摘が出なくなったか・逆に必要な外部境界の指摘まで落ちていないかをユーザーと確認する
