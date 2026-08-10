# cbo プラグイン「牽制コメント」抑止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「これを消すと壊れる」型の牽制コメントを cbo プラグインのエージェントが生成しないようにし、同時に検知側が同じ類型を削除指摘として拾えるようにする。

**Architecture:** 「壊れ方を書け」という書き方の指示を、「そもそも書くか」を問う担保ゲート（型・制御フロー・エラーメッセージ・テストのいずれかが既に担保していないか）へ置き換える。検知側 `reviewer-for-comments` を先に固めて概念の基準点とし、生成側 2 ファイルを同じ概念で追随させ、最後に計画書経由の波及を塞ぐ。自動テストが存在しない領域のため、各タスクの検証は `rg` によるアンカー文字列の存在・不在確認で行う。

**Tech Stack:** Markdown（Claude Code Agent 定義）、`rg`（検証）、`git`

## Global Constraints

- 設計書は `docs/superpowers/specs/2026-08-11-cbo-comment-deterrent-rules-design.md`
- 出典メモ `/Users/otto/workspace/craftbank/arrangement-env/front/.mgzl/memo/20260811-042922-comment-verbosity-recurrence-lessons.md` は**読み取り専用**。編集しない
- 変更対象は `cbo/agents/*.md` のみ。`cbo/skills/` 配下・スクリプト・`marketplace.json` は変更しない
- **各ファイルの記述言語を変えない。挿入する文面はそのファイルの既存言語で書く**
  - `reviewer-for-comments.md` — **英語**で書く。ただし既存ファイルの流儀に合わせ、次のものは日本語のまま残す: コメント例・レビュー対象文の引用（`「undefined を渡すとクエリから削除される」` 等）、日本語固有の表現、Severity ラベル（`推奨` / `軽微`）、レポートテンプレート
  - `code-implementer.md` / `test-implementer.md` / `implementation-plan-creator.md` — **日本語**で書く
- **担保ゲートの 4 語は全ファイルで統一する**: 型・制御フロー・エラーメッセージ・テスト（英語側は type system / control flow / error message / test）
- `reviewer-for-comments.md` の既存 criterion 番号 1〜7 は**変更しない**。本文中に `see criterion 4` / `criterion 7` の参照が存在する
- 「コメント行が全体の 20% を超えたら過剰を疑う」という比率ルールは**採用しない**（設計書の判断）
- Edit の位置指定は**行番号でなく既存文言のアンカー**で行う。ファイルは随時更新されうる
- **作業ブランチは `feat/cbo-comment-deterrent-rules`**。`main` へ直接コミットしない
- **各タスクは自身の変更をコミットして終える**（タスク末尾のコミットステップは必須）
- コミットメッセージは Conventional Commits 形式（`feat:` / `fix:` / `refactor:` / `chore:`）
- 計画書（`docs/superpowers/plans/`）・設計書（`docs/superpowers/specs/`）・SDD 作業ファイル（`.superpowers/`）はコミット対象に含めない。各タスクは `cbo/agents/` 配下の変更のみを `git add` する
- `cbo/.claude-plugin/plugin.json` に `version` を追加しない（プロジェクト方針: プラグインのバージョンは管理しない）

---

## File Structure

- `cbo/agents/reviewer-for-comments.md` — **検知側**。担保ゲートと保護類型 A / B の基準点。他タスクの概念の出所
- `cbo/agents/code-implementer.md` — **生成側（本体コード）**。「コメント・ドキュメント」節 + 整理節の新設
- `cbo/agents/test-implementer.md` — **生成側（テストコード）**。同上。テスト固有の保持事項を維持
- `cbo/agents/implementation-plan-creator.md` — **波及元**。計画書のサンプルコードは実装者が写経する

### 変更しないもの（判断根拠）

- `cbo/agents/knowledge-distiller.md` — コメントから外した情報の退避先という記述は今回も有効
- `cbo/agents/reviewer-for-test-code.md` — characterization テストへのコメント追加要求は別責務として維持
- `cbo/skills/review__diff/SKILL.md`, `cbo/skills/review__fix/SKILL.md` — レビュアーを起動するフローのみで判断基準を持たない
- `cbo/style-rule.md` — 適用方法未確定の保管文書。コメント規約を含まない

---

## Task 1: `reviewer-for-comments` に担保ゲート・保護類型の再定義・削除類型 A-7 を入れる

**Files:**
- Modify: `cbo/agents/reviewer-for-comments.md`

**言語:** このタスクで挿入する文面は**英語**。コメント例の引用のみ日本語のまま。

**Interfaces:**
- Consumes: なし（先行タスクなし）
- Produces: 後続タスクが対応づける概念を確定する（英語呼称 → 後続タスクの日本語呼称）
  - 担保ゲート: `the coverage gate` → 担保ゲート（type system / control flow / error message / test → 型 / 制御フロー / エラーメッセージ / テスト）
  - 保護類型 A: `Facts that exist only outside the code` → コードの外にしか存在しない事実（外部の挙動 / 実際に踏んだ不具合 / 仕様上の制約・既知の乖離条件 / 複数箇所共通ポリシー）
  - 保護類型 B: `Things whose absence the code cannot show` → コードを読んでも「無い」ことが分からないもの（担保していない範囲 / 意図的に違う作りにしている理由 / 協調相手の責務）
  - 削除類型 A-7: `Deterrent comments aimed at future editors` → 将来の編集者への牽制コメント（3 形: 実装順序の牽制 / 型が既に守っているものの牽制 / 直後のエラーメッセージと同内容）

このタスクは削除類型 A-7 の追加と保護類型 A / B の再定義を**必ず同時に入れる**。削除方向の基準だけを先に入れると、レビューが過剰削除へ振れる。

**旧保護例 3 件を落とす判断について（実装者向けの背景）**: criterion 7 の旧筆頭にあった 3 例のうち、`route: false が必須` は新しい保護類型 A（外部の挙動）で拾われ、3.1 の library-internals の calibration 文にも既に登場するため失われない。`手書きスタブへ戻さないこと` は今回禁止する牽制コメントそのものであり、意図的に落とす。`回数だけが唯一の差になる` は保護類型 B（意図的に違う作りにしている理由）で拾う。

- [ ] **Step 1: 現行のアンカー文言が存在することを確認**

Run: `rg -n "What breaks if this is removed or changed|Precedent citations|Full chains of inference|Exceeding the guideline is not by itself|\*\*Consolidation\*\*|Scan for removal patterns, volume, and placement" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: 6 行以上ヒットする（`Precedent citations` は 3.1 の箇条書きと Severity scale の双方に出現しうる）。ヒットしない語があれば、ファイルが更新されているので該当箇所を Read して置換対象を特定し直す。

- [ ] **Step 2: criterion 7 の保護リストを担保ゲート + 類型 A / B へ置換**

置換前:

```markdown
The past cleanup did **not** remove comments indiscriminately. Never suggest deleting or shortening the following. If a draft finding targets one of these, delete the finding outright — do not merely lower its severity.

- **What breaks if this is removed or changed** — 「手書きスタブへ戻さないこと」, 「route: false が必須」, 「回数だけが唯一の差になる」
- **What is *not* covered** — a gap where the test stays green regardless: 「イベント名の改名は emit テストでは検知できない」
- **Why the code is deliberately built differently from its counterpart** — e.g. why a fake assembles values in the opposite direction from the real store
- **The responsibilities of a runtime collaborator** — 「年月は `useYearAndMonthSelectStore` のセッターが直接 push する」
```

置換後:

```markdown
The past cleanup did **not** remove comments indiscriminately. Never suggest deleting or shortening the following. If a draft finding targets one of these, delete the finding outright — do not merely lower its severity.

**The coverage gate.** Before judging any comment — in either direction — ask whether the **type system**, the **control flow**, an **error message**, or a **test** already carries the same information. If one of them does, the comment is redundant (`[2]` under criterion 3) however short it is. Only what survives this gate can qualify for the protections below.

**A. Facts that exist only outside the code**

- **External behavior** of a library, framework, or browser that reading the code cannot reveal — 「undefined を渡すとクエリから削除される」
- **A bug actually hit**, and why this workaround was chosen over the alternatives
- **A spec constraint or a known divergence condition** — 「URL → ストアの同期は 1 回きり」
- **A policy shared across several call sites** — e.g. the push / replace policy common to the three 買掛 screens

**B. Things whose *absence* the code cannot show**

- **What is *not* covered** — a gap where the test stays green regardless: 「イベント名の改名は emit テストでは検知できない」
- **Why the code is deliberately built differently from its counterpart** — e.g. why a fake assembles values in the opposite direction from the real store
- **The responsibilities of a runtime collaborator** — 「年月は `useYearAndMonthSelectStore` のセッターが直接 push する」

**"What breaks if this is removed" is not itself a reason to keep a comment.** Every line of code breaks something when it is deleted, so saying so carries no information. Even an accurate description of the breakage must go when the type system, the control flow, an error message, or a test already guards it — see the deterrent pattern in 3.1.
```

- [ ] **Step 3: 3.1 の precedent citations の代替案を付け替える**

置換前（`Precedent citations` 行の末尾部分のみ）:

```
Suggest rewriting the rationale as "what breaks here if this changes"
```

置換後:

```
Suggest replacing the rationale with a fact that survives the coverage gate in criterion 7 — an external behavior, a bug actually hit, or a spec constraint — or with nothing at all
```

- [ ] **Step 4: 3.1 に削除類型 A-7 を追加し、full chains の代替案を付け替える**

置換前:

```markdown
- **Full chains of inference** — comments that spell out every intermediate step ("demoted to a fallthrough attribute → no longer present in `props()` → …"). Suggest compressing to a single "conclusion + how it breaks" pair

#### 3.2 Volume guideline
```

置換後:

```markdown
- **Full chains of inference** — comments that spell out every intermediate step ("demoted to a fallthrough attribute → no longer present in `props()` → …"). Suggest compressing to the conclusion alone, and dropping even that when the type system, the control flow, an error message, or a test already carries it
- **Deterrent comments aimed at future editors** — comments written to forbid an edit rather than to help a reader understand the code. In the user's own words: 「コメントがないと消してしまう可能性がある、という意味のコメントは完全に不要」. Every line breaks something when deleted, so stating it carries no information. Three forms recur:
  1. **Deterring a reordering** — 「コミットは await の前。後ろに置くと、待っている間に flush された watch が冪等ガードをすり抜ける」. An ordering that must hold belongs in a test, not a comment
  2. **Deterring a change the type system already blocks** — 「三項の else 落としと違い、mode に値が増えたら Router のメソッド解決で型エラーになる」. The compiler already reports this
  3. **Restating the error message on the next line** — 「スコープが取れないと上記の生存ガードが無言で効かなくなるため即時に失敗させる」 sitting directly above a `throw new Error(...)` that says the same thing

  Decision test: does this comment help a reader understand the code, or does it only assert that an edit is forbidden? If the latter, flag it. **Being short is no defense** — most comments removed under this pattern were 1–2 lines

#### 3.2 Volume guideline
```

- [ ] **Step 5: 3.2 に「収まっていることは残す理由にならない」を追加**

置換前:

```markdown
- **Exceeding the guideline is not by itself a reason to report.** Flag only when you can point to specific content that can be cut
```

置換後:

```markdown
- **Exceeding the guideline is not by itself a reason to report.** Flag only when you can point to specific content that can be cut
- **Staying inside the guideline is not a reason to keep a comment either.** A one-line comment that fails the coverage gate in criterion 7 is still `[2]`. Volume is a trigger for suspicion, never a certificate
```

- [ ] **Step 6: criterion 6 の Consolidation を反転**

置換前:

```markdown
- **Consolidation** — when the same explanation is repeated in prose across several places, suggest consolidating it into one location (typically a JSDoc block) as a bulleted list, leaving 1–2 lines at each site. **A JSDoc block growing longer through this consolidation is acceptable** and takes precedence over 3.2 — the goal is not "make it shorter" but "stop writing the same thing in prose over and over" (`[2]`)
```

置換後:

```markdown
- **Deletion before consolidation** — when the same explanation is repeated across several places, first ask whether all of them can go. As long as an explanation sits at each site, a summary block is not needed. **Never suggest adding a summary block that coexists with the on-site explanations** — that creates two places to maintain, not one. A consolidated JSDoc block introduced by one cleanup was deleted wholesale by the next, so treat "consolidate it" as a last resort. Consolidation is acceptable only when the on-site explanations are **removed** and moved into the single location (`[2]`)
```

- [ ] **Step 7: Severity scale の `[2]` 行へ A-7 を追記**

置換前（`[2]` 行の末尾部分のみ）:

```
and full chains of inference) and the placement / shape violations in criterion 6.** |
```

置換後:

```
full chains of inference, and deterrent comments aimed at future editors) and the placement / shape violations in criterion 6.** |
```

- [ ] **Step 8: Review process へ担保ゲート工程を挿入し、以降を採番し直す**

置換前:

```markdown
5. **Scan for removal patterns, volume, and placement** — find the five 3.1 patterns (precedent citations / cross-references to other comments / explanations of library internals / spec descriptions reaching into another file's internals / full chains of inference). Check volume against 3.2 (1–3 lines, JSDoc 3–4 lines), and check placement and "one sentence, one fact" against criterion 6
6. **Japanese-comment readability** — check subject–predicate agreement, sentence length (the 50 / 80 character thresholds in criterion 5), double negation, mixed 敬体/常体, and circumlocution (criterion 5)
7. **Classify** every finding using the severity scale above
8. **Self-review** the draft report and drop (a) anything outside comment territory (logic, design, style, security, tests), (b) every finding that recommends adding a new comment, and (c) **every finding whose target falls under the protections in criterion 7**
```

置換後:

```markdown
5. **Run the coverage gate on every comment** (criterion 7) — ask whether the type system, the control flow, an error message, or a test already carries the same information. If one of them does, the comment is redundant (`[2]`) however short it is
6. **Scan for removal patterns, volume, and placement** — find the six 3.1 patterns (precedent citations / cross-references to other comments / explanations of library internals / spec descriptions reaching into another file's internals / full chains of inference / deterrent comments aimed at future editors). Check volume against 3.2 (1–3 lines, JSDoc 3–4 lines), and check placement and "one sentence, one fact" against criterion 6
7. **Japanese-comment readability** — check subject–predicate agreement, sentence length (the 50 / 80 character thresholds in criterion 5), double negation, mixed 敬体/常体, and circumlocution (criterion 5)
8. **Classify** every finding using the severity scale above
9. **Self-review** the draft report and drop (a) anything outside comment territory (logic, design, style, security, tests), (b) every finding that recommends adding a new comment, and (c) **every finding whose target falls under the protections in criterion 7**
```

- [ ] **Step 9: 旧文言が消えたことを検証**

Run: `rg -n "What breaks if this is removed or changed|what breaks here if this changes|conclusion \+ how it breaks|A JSDoc block growing longer through this consolidation is acceptable" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: ヒット 0 件（終了コード 1）。ヒットしたら該当ステップの置換が適用されていない。

- [ ] **Step 10: 新文言が入ったことを検証**

Run: `rg -c "The coverage gate|Deterrent comments aimed at future editors|Deletion before consolidation|Staying inside the guideline is not a reason to keep a comment either|is not itself a reason to keep a comment" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `5`（各 1 行、計 5 行）

- [ ] **Step 11: Review process の採番が 1〜9 で連続していることを検証**

Run: `rg -n "^[0-9]\. \*\*" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `1.` から `9.` までが 1 つずつ、この順で並ぶ。重複や欠番があれば Step 7 の置換が崩れている。

- [ ] **Step 12: criterion 番号の参照が壊れていないことを検証**

Run: `rg -n "criterion 3|criterion 4|criterion 5|criterion 7" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `criterion 4`（コメント追加禁止）・`criterion 5`（日本語可読性）・`criterion 7`（保護 + 担保ゲート）への参照が残っている。criterion の見出し自体は `### 1.` 〜 `### 7.` の 7 個のまま。

- [ ] **Step 13: 挿入文面の言語を目視確認**

Read で criterion 7 と 3.1 の新規箇所を読み、次を確認する。

1. 説明文がすべて英語で書かれていること
2. 日本語が残っているのは、コメント例の引用（「undefined を渡すとクエリから削除される」等）とユーザー発言の引用に限られること
3. 既存 criterion 1〜6 の英語のトーン（`Flag ...` / `Suggest ...`）から浮いていないこと

- [ ] **Step 14: コミット**

```bash
git add cbo/agents/reviewer-for-comments.md
git commit -m "feat: reviewer-for-comments に担保ゲートと牽制コメント削除類型を追加"
```

---

## Task 2: `code-implementer` のコメント規約を担保ゲート方式へ差し替え

**Files:**
- Modify: `cbo/agents/code-implementer.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 1 が確定した担保ゲート・保護類型 A / B・削除類型 A-7 の概念
- Produces: Task 3 が複製する共通本文（「書く前の担保ゲート」「残すもの」「削るもの」「量・配置・表現」「正確さ」「コメント整理を指示された場合」の構成）

- [ ] **Step 1: 置換対象の存在を確認**

Run: `rg -n "残す価値があるのは次の 4 つ|この集約で JSDoc が長くなるのは許容する|結論 \+ 壊れ方|^## 報告形式$" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: 4 行すべてヒットする。

- [ ] **Step 2: 「残すもの / 削るもの」ブロックを全置換**

`**残すもの / 削るもの**` の見出し行から、その直後の箇条書きの末尾（`- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。再利用価値のある前例・内部挙動はナレッジ側へ移す` の行）までを、以下で置換する。

```markdown
**書く前の担保ゲート**

コメントを書く前に必ずこの順で問う。

1. その情報は**型・制御フロー・エラーメッセージ・テスト**のいずれかが既に担保していないか。担保されていれば書かない
2. 担保されていないとして、それは**コードを読む助け**か、**将来の編集者への禁止・牽制**か。後者なら書かない。守りたい挙動はテストで守る
3. 残るのは「コードからは読み取れない事実」だけ。これを 1〜3 行で書く

**残すもの**

A. コードの外にしか存在しない事実

- 外部の挙動（ライブラリ・フレームワーク・ブラウザ）でコードを読んでも分からないもの（`undefined を渡すとクエリから削除される` 等）
- 実際に踏んだ不具合と、その回避策を選んだ理由
- 仕様上の制約・既知の乖離条件（`URL → ストアの同期は 1 回きり` 等）
- 複数箇所にまたがる共通ポリシー

B. コードを読んでも「無い」ことが分からないもの

- 担保していない範囲（緑のまま通ってしまう穴）
- 実装と意図的に違う作りにしている理由
- 実行時に協調する相手の責務

**削るもの**

- **「これを外す・変えると何が壊れるか」は、それ自体では残す理由にならない**。どの行も消せば何かが壊れるのだから情報量がない。壊れ方の記述が正確でも、型・制御フロー・エラーメッセージ・テストが担保していれば削る
- **将来の編集者への牽制コメントを書かない**。実装の正しさではなく編集の禁止を主張するもの。よく出る 3 形:
  1. 実装順序の牽制（`コミットは await の前。後ろに置くと…`）→ 守りたい順序はテストで守る
  2. 型が既に守っているものの牽制（`値が増えたら型エラーになる`）→ コンパイラが報告する
  3. 直後の `throw` メッセージと同内容の説明 → エラーメッセージが担保している

  短く書けていることは免罪符にならない。この類型で削られたコメントの多くは 1〜2 行だった
- 「何をするか」の言い換えは削る。ただしコードから読めるのは *何をしているか* だけであり、*なぜそうしたか* は実装が単純でも残す
- 「前例: <ファイル>.ts の <シンボル>」型の出典表記を書かない。前例があることは今のコードが正しい根拠にならず、参照先の改名・削除で腐る。根拠を書くなら担保ゲートを通る事実（外部の挙動・実際に踏んだ不具合・仕様上の制約）だけにする。**実行時に責務を分担している相手への参照（`year/month は useYearAndMonthSelectStore が書く`）は残してよい**
- 他のコメントを指す相互参照（「上のケースと同じ理由」「詳細はそちらを参照」）を書かない。各コメントはその場で完結させる
- ライブラリ・フレームワークの内部挙動の解説を書かない。残すのは「この設定が必要な理由」まで
- 他ファイル・他コンポーネントの内部実装（相手の `watch` が何を emit するか等）に踏み込んだ仕様説明を書かない。呼び出し元の事情は呼び出し元に書く。他ファイルの制約へ暗黙依存する実装では、依存している前提だけを 1 行で明示する
- 推論の連鎖を全部書かない。中間の機序は落とし結論だけを残す。その結論も担保ゲートを通らなければ書かない
- 編集経緯・一過性プロセス成果物への参照（「旧挙動から変更」「Step N 対応」「本 PR では対応しない」「カナリア検証で判明」等）を残さない。履歴は git log / PR 説明へ、未着手は追跡情報付き `TODO:` へ
- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。守りたい挙動はテストへ、再利用価値のある前例・内部挙動はナレッジ側へ移す
```

- [ ] **Step 3: 分量目安に「収まっていることは残す理由にならない」を追記**

置換前:

```markdown
- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う
```

置換後:

```markdown
- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う。**収まっていることは残す理由にならない**。1 行でも担保ゲートを通らなければ削る
```

- [ ] **Step 4: 集約規則を反転**

置換前:

```markdown
- 同じ説明を複数箇所に散文で書かない。1 箇所へ集約し、集約先は箇条書きにする。現場の行には 1〜2 行だけ残す（この集約で JSDoc が長くなるのは許容する）
```

置換後:

```markdown
- 同じ説明が複数箇所にあるときは、まず**全部消せないか**を見る。現地に説明がある限りサマリは要らない。集約先を新設して現地にも残す形（＝二重管理）にしない。集約してよいのは、現地の説明を**削除して** 1 箇所へ移す場合だけ
```

- [ ] **Step 5: 「コメント整理を指示された場合」節を新設**

`## 報告形式` 見出しの直前へ、以下を挿入する（`**正確さ**` ブロックの末尾 `- 関数 JSDoc は全責務を列挙し、責務が増えたら更新する` の次に空行を置いてから続ける）。

````markdown
### コメント整理を指示された場合

- リライトではなく**削除**を第一候補にする。短く言い換えただけの差分は整理とみなさない
- 整理タスク中に**新しいコメントを追加しない**。散在する説明の「集約」もしない（現地にある説明が正）
- 判断の単位は「短くできるか」ではなく「**消せるか**」。上の担保ゲートを 1 件ずつ通す
- コメント削除がコードの挙動を変えていないことを確認してからコミットする。次のコマンドの出力が空であること

```bash
git diff -U0 <path> | grep -E '^[-+]' | grep -vE '^[-+]\s*(//|\*|/\*\*|\*/|<!--|-->)'
```
````

- [ ] **Step 6: 旧文言が消えたことを検証**

Run: `rg -n "残す価値があるのは次の 4 つ|この集約で JSDoc が長くなるのは許容する|結論 \+ 壊れ方|この場所で何が壊れるか" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 7: 新基準が入ったことを検証**

Run: `rg -c "書く前の担保ゲート|将来の編集者への牽制コメントを書かない|収まっていることは残す理由にならない|コメント整理を指示された場合" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: `4`

- [ ] **Step 8: 節の前後が壊れていないことを確認**

Read で `### コメント・ドキュメント` 節の先頭から `## 報告形式` までを読み、次を確認する。

1. 「書く前の担保ゲート」「残すもの」「削るもの」「量・配置・表現」「正確さ」「コメント整理を指示された場合」がこの順で並んでいること
2. 直前が `### Vue リアクティビティ・テンプレート` 節の末尾、直後が `## 報告形式` 見出しであること
3. 「正確さ」ブロックの既存 7 項目が 1 つも失われていないこと

- [ ] **Step 9: コミット**

```bash
git add cbo/agents/code-implementer.md
git commit -m "feat: code-implementer のコメント規約を担保ゲート方式へ差し替え"
```

---

## Task 3: `test-implementer` のコメント規約を担保ゲート方式へ差し替え

**Files:**
- Modify: `cbo/agents/test-implementer.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 2 が確定した構成（「書く前の担保ゲート」「残すもの」「削るもの」）
- Produces: なし

Task 2 との差分は、テスト固有の記述（AAA コメント保護・モックのデフォルト値・環境要因の回避策・ヘルパーの一元化）を保持することと、削除類型の例をテスト文脈へ寄せることの 2 点。

- [ ] **Step 1: 置換対象の存在を確認**

Run: `rg -n "残す価値があるのは次の 4 つ|この集約で JSDoc が長くなるのは許容する|結論 \+ 壊れ方|^### テストコード$" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: 4 行すべてヒットする。

- [ ] **Step 2: 「残すもの / 削るもの」ブロックを全置換**

`**残すもの / 削るもの**` の見出し行から、その直後の箇条書きの末尾（`- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。再利用価値のある前例・内部挙動はナレッジ側へ移す` の行）までを、以下で置換する。

```markdown
**書く前の担保ゲート**

コメントを書く前に必ずこの順で問う。

1. その情報は**型・制御フロー・エラーメッセージ・テスト名・Assert**のいずれかが既に担保していないか。担保されていれば書かない
2. 担保されていないとして、それは**コードを読む助け**か、**将来の編集者への禁止・牽制**か。後者なら書かない。守りたい挙動はテストで守る
3. 残るのは「コードからは読み取れない事実」だけ。これを 1〜3 行で書く

**残すもの**

A. コードの外にしか存在しない事実

- 外部の挙動（ライブラリ・テストフレームワーク・実行環境）でコードを読んでも分からないもの
- 実際に踏んだ不具合と、その回避策を選んだ理由
- 仕様上の制約・既知の乖離条件
- 複数箇所にまたがる共通ポリシー

B. コードを読んでも「無い」ことが分からないもの

- 担保していない範囲（緑のまま通ってしまう穴）
- 実装と意図的に違う作りにしている理由
- 実行時に協調する相手の責務

**削るもの**

- **「これを外す・変えると何が壊れるか」は、それ自体では残す理由にならない**。どの行も消せば何かが壊れるのだから情報量がない。壊れ方の記述が正確でも、型・制御フロー・エラーメッセージ・テスト名・Assert が担保していれば削る
- **将来の編集者への牽制コメントを書かない**。テストの正しさではなく編集の禁止を主張するもの。よく出る 3 形:
  1. 実装順序の牽制（`この行は setup の後でなければならない`）→ 守りたい順序はテスト自体で守る
  2. 型が既に守っているものの牽制（`値が増えたら型エラーになる`）→ コンパイラが報告する
  3. 直後の `expect` やテスト名と同内容の説明 → Assert が担保している

  短く書けていることは免罪符にならない。この類型で削られたコメントの多くは 1〜2 行だった
- **AAA コメント（`// Arrange` / `// Act` / `// Assert`）は自明に見えても削らない**。プロジェクト規約として維持する。削る対象は AAA ラベルそのものではなく、その脇に添える説明文のうちテスト名・Assert から自明なもの
- 「何をするか」の言い換えは削る。ただしコードから読めるのは *何をしているか* だけであり、*なぜそうしたか* は実装が単純でも残す
- 「前例: <ファイル>.test.ts の <シンボル>」型の出典表記を書かない。前例があることは今のテストが正しい根拠にならず、参照先の改名・削除で腐る。根拠を書くなら担保ゲートを通る事実（外部の挙動・実際に踏んだ不具合・仕様上の制約）だけにする。**実行時に責務を分担している相手への参照は残してよい**
- 他のコメントを指す相互参照（「上のケースと同じ理由」「詳細はそちらを参照」「下のテストと対称に見る」）を書かない。各コメントはその場で完結させる
- ライブラリ・テストフレームワークの内部挙動の解説を書かない。残すのは「この設定が必要な理由」まで
- SUT や他コンポーネントの内部実装に踏み込んだ仕様説明を書かない。相手の実装が変われば嘘になる
- 推論の連鎖を全部書かない。中間の機序は落とし結論だけを残す。その結論も担保ゲートを通らなければ書かない
- 編集経緯・一過性プロセス成果物への参照（「Step N 対応」「本 PR では対応しない」「以前は」等）を残さない
- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。守りたい挙動はテストへ、再利用価値のある前例・内部挙動はナレッジ側へ移す
```

- [ ] **Step 3: 分量目安に「収まっていることは残す理由にならない」を追記**

置換前:

```markdown
- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う
```

置換後:

```markdown
- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う。**収まっていることは残す理由にならない**。1 行でも担保ゲートを通らなければ削る
```

- [ ] **Step 4: 集約規則を反転**

置換前:

```markdown
- 同じ説明を複数箇所に散文で書かない。1 箇所（describe 先頭・`beforeEach`・ヘルパー名）へ集約し、集約先は箇条書きにする。現場の行には 1〜2 行だけ残す（この集約で JSDoc が長くなるのは許容する）
```

置換後:

```markdown
- 同じ説明が複数箇所にあるときは、まず**全部消せないか**を見る。現地に説明がある限りサマリは要らない。集約先（describe 先頭・`beforeEach`・ヘルパー名）を新設して現地にも残す形（＝二重管理）にしない。集約してよいのは、現地の説明を**削除して** 1 箇所へ移す場合だけ
```

- [ ] **Step 5: 「コメント整理を指示された場合」節を新設**

`### テストコード` 見出しの直前へ、以下を挿入する（`**正確さ**` ブロックの末尾 `- ヘルパーの詳細説明は定義側コメントへ一元化する` の次に空行を置いてから続ける）。

````markdown
### コメント整理を指示された場合

- リライトではなく**削除**を第一候補にする。短く言い換えただけの差分は整理とみなさない
- 整理タスク中に**新しいコメントを追加しない**。散在する説明の「集約」もしない（現地にある説明が正）
- 判断の単位は「短くできるか」ではなく「**消せるか**」。上の担保ゲートを 1 件ずつ通す
- AAA コメントと characterization コメントは整理対象外。規約として維持する
- コメント削除がコードの挙動を変えていないことを確認してからコミットする。次のコマンドの出力が空であること

```bash
git diff -U0 <path> | grep -E '^[-+]' | grep -vE '^[-+]\s*(//|\*|/\*\*|\*/|<!--|-->)'
```
````

- [ ] **Step 6: 旧文言が消えたことを検証**

Run: `rg -n "残す価値があるのは次の 4 つ|この集約で JSDoc が長くなるのは許容する|結論 \+ 壊れ方|この場所で何が壊れるか" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 7: 新基準とテスト固有の保持事項を検証**

Run: `rg -c "書く前の担保ゲート|将来の編集者への牽制コメントを書かない|収まっていることは残す理由にならない|コメント整理を指示された場合" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: `4`

Run: `rg -c "AAA コメント|AAA ラベル|モックのデフォルト値|ヘルパーの詳細説明は定義側コメントへ一元化する" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: `4` 以上（AAA 関連が「削るもの」「コメント整理を指示された場合」「テストコード」節に分散するため 4 を下回らない）

- [ ] **Step 8: 節の前後が壊れていないことを確認**

Read で `### コメント・ドキュメント` 節の先頭から `### テストコード` までを読み、次を確認する。

1. 「書く前の担保ゲート」「残すもの」「削るもの」「量・配置・表現」「正確さ」「コメント整理を指示された場合」がこの順で並んでいること
2. 直前が `### 設計・責務分離` 節の末尾、直後が `### テストコード` 見出しであること
3. 「正確さ」ブロックの既存項目（モックのデフォルト値・characterization の 3 観点・ヘルパー一元化）が 1 つも失われていないこと

- [ ] **Step 9: コミット**

```bash
git add cbo/agents/test-implementer.md
git commit -m "feat: test-implementer のコメント規約を担保ゲート方式へ差し替え"
```

---

## Task 4: `implementation-plan-creator` の計画書経由の波及を塞ぐ

**Files:**
- Modify: `cbo/agents/implementation-plan-creator.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 2 が確定した担保ゲートの 4 語と牽制コメントの呼称
- Produces: なし

このファイルの現行記述は**牽制コメントを明示的に推奨している**。「コードコメントとして残すなら『順序を変えると何が壊れるか』の形へ書き換える」がそれで、計画書のサンプルコードは実装者が写経するため、そのまま製品コードへ流出する。

- [ ] **Step 1: 置換対象の存在を確認**

Run: `rg -n "サンプルコードに書くコメントも本体のコメント規約に従う|計画書にのみ書いた非自明な制約|順序を変えると何が壊れるか" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: 3 行ヒットする。

- [ ] **Step 2: サンプルコードのコメント規約へ牽制コメント禁止を追記**

置換前:

```markdown
- サンプルコードに書くコメントも本体のコメント規約に従う。前例としての出典表記・他のコメントを指す相互参照・ライブラリの内部挙動の解説・他ファイルの内部実装に踏み込んだ仕様説明・推論の連鎖の全記述を書かない。通常 1〜3 行 / JSDoc 3〜4 行に収め、説明はそれが効いている行の直上に置く。**実装者は写経するため、計画書側の冗長コメントはそのまま製品コードへ残る**
```

置換後:

```markdown
- サンプルコードに書くコメントも本体のコメント規約に従う。前例としての出典表記・他のコメントを指す相互参照・ライブラリの内部挙動の解説・他ファイルの内部実装に踏み込んだ仕様説明・推論の連鎖の全記述を書かない。通常 1〜3 行 / JSDoc 3〜4 行に収め、説明はそれが効いている行の直上に置く。**実装者は写経するため、計画書側の冗長コメントはそのまま製品コードへ残る**
- サンプルコードに**将来の編集者への牽制コメント**（「これを消すと壊れる」「ここは変更しないこと」「この行を移動すると〜になる」）を書かない。型・制御フロー・エラーメッセージ・テストのいずれかが既に担保している情報もコメントにしない。守りたい挙動はコメントでなく回帰テストで固定するステップを計画へ含める
```

- [ ] **Step 3: インラインコメント追加指示へ担保ゲートを掛ける**

置換前:

```markdown
- 計画書にのみ書いた非自明な制約は、防御コード近傍へのインラインコメント追加もステップに組み込む
```

置換後:

```markdown
- 計画書にのみ書いた非自明な制約のうち、担保ゲート（型・制御フロー・エラーメッセージ・テストのいずれも担保していない）を通るものだけ、防御コード近傍へのインラインコメント追加をステップに組み込む。テストで固定できる制約はコメントでなくテスト追加のステップにする
```

- [ ] **Step 4: ステップ番号コメントの指示から牽制形を除去**

置換前:

```markdown
- 既存パターン踏襲時は順序根拠を明文化する。ただし**ステップ番号をサンプルコード内のコメントへ書かない**（写経で「Step N 対応」が製品コードに残り、編集経緯を残さないルールに反する）。順序根拠は計画書の本文側に書き、コードコメントとして残すなら「順序を変えると何が壊れるか」の形へ書き換える
```

置換後:

```markdown
- 既存パターン踏襲時は順序根拠を明文化する。ただし**ステップ番号をサンプルコード内のコメントへ書かない**（写経で「Step N 対応」が製品コードに残り、編集経緯を残さないルールに反する）。順序根拠は計画書の本文側にのみ書き、**コードコメントとして残さない**（順序の壊れ方を書く形は牽制コメントであり、写経で製品コードへ流出する）。守りたい順序は回帰テストで固定するステップを計画へ含める
```

- [ ] **Step 5: 旧文言が消えたことを検証**

Run: `rg -n "順序を変えると何が壊れるか" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 6: 追記が入ったことを検証**

Run: `rg -c "将来の編集者への牽制コメント|担保ゲート（型・制御フロー・エラーメッセージ・テストのいずれも担保していない）|コードコメントとして残さない" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: `3`

- [ ] **Step 7: コミット**

```bash
git add cbo/agents/implementation-plan-creator.md
git commit -m "fix: implementation-plan-creator の牽制コメント推奨を是正"
```

---

## Task 5: クロスファイル整合の最終検証

**Files:**
- Modify: なし（検証のみ。不整合が見つかった場合は該当タスクへ戻る）

**Interfaces:**
- Consumes: Task 1〜4 のすべての変更
- Produces: なし

検知側（英語）と生成側（日本語）で記述言語が異なるため、検証は言語ごとに分けて行う。

- [ ] **Step 1: 旧基準が cbo 配下から消えたことを検証**

Run: `rg -n "残す価値があるのは次の 4 つ|この集約で JSDoc が長くなるのは許容する|結論 \+ 壊れ方|この場所で何が壊れるか|順序を変えると何が壊れるか|What breaks if this is removed or changed|what breaks here if this changes|conclusion \+ how it breaks|A JSDoc block growing longer through this consolidation is acceptable" /Users/otto/workspace/mgzl-claude-code-plugin/cbo`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 2: 担保ゲートが生成側 3 ファイルに入ったことを検証**

Run: `rg -l "担保ゲート" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents`

Expected: `code-implementer.md`, `test-implementer.md`, `implementation-plan-creator.md` の 3 ファイル（`reviewer-for-comments.md` は英語のため含まれない）

- [ ] **Step 3: 牽制コメント禁止が生成側 3 ファイルに入ったことを検証**

Run: `rg -l "将来の編集者への牽制" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents`

Expected: `code-implementer.md`, `test-implementer.md`, `implementation-plan-creator.md` の 3 ファイル

- [ ] **Step 4: 検知側に担保ゲートと A-7 が入ったことを検証**

Run: `rg -c "The coverage gate|Deterrent comments aimed at future editors" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `2`

- [ ] **Step 5: 保護類型が両側で保たれていることを検証**

Run: `rg -c "担保していない範囲|実装と意図的に違う作りにしている理由|実行時に協調する相手の責務" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: 両ファイルとも `3`

- [ ] **Step 6: 検知側と生成側の対応を目視確認**

Read で `cbo/agents/reviewer-for-comments.md` の criterion 7 / 3.1 と、`cbo/agents/code-implementer.md` の「コメント・ドキュメント」節を並べて読み、次を確認する。

1. 担保ゲートの 4 要素が両側で一致していること（type system / control flow / error message / test ↔ 型 / 制御フロー / エラーメッセージ / テスト）
2. 保護類型 A の 4 項目・B の 3 項目が両側で 1 対 1 に対応していること（言語は違っても内容が一致していること）
3. A-7 の 3 形（実装順序の牽制 / 型が既に守っているものの牽制 / 直後のエラーメッセージと同内容）が両側で一致していること
4. 検知側の 3.1「precedent citations」と criterion 7「runtime collaborator」の切り分けが、生成側の「実行時に責務を分担している相手への参照は残してよい」と矛盾しないこと

- [ ] **Step 7: エージェント定義のフロントマターが壊れていないことを検証**

Run: `rg -c "^name: " /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: 全 4 ファイルが `1`

- [ ] **Step 8: 差分の全体像を確認**

Run: `git -C /Users/otto/workspace/mgzl-claude-code-plugin diff main...HEAD --stat`

Expected: `cbo/agents/` 配下の 4 ファイルのみが変更されている。`cbo/skills/` 配下や `marketplace.json`、`docs/` に変更が出ていたら誤編集。

---

## 実行後の後始末

- [ ] 本計画書 `docs/superpowers/plans/2026-08-11-cbo-comment-deterrent-rules.md` と設計書 `docs/superpowers/specs/2026-08-11-cbo-comment-deterrent-rules-design.md` の扱いをユーザーに確認する（リポジトリへ残す / 削除する）
