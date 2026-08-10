# cbo プラグイン コメント規約反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 技術メモ `20260810-102544-code-comment-writing-rules.md` から抽出したコメント記述ルールを、cbo プラグインのレビュアー・実装エージェント定義へ反映し、コメントの生成側と検知側の基準を一致させる。

**Architecture:** 変更対象は cbo プラグインのエージェント定義（Markdown）のみ。検知側（`reviewer-for-comments`）を先に固め、生成側（`code-implementer` / `test-implementer`）を同じ概念で追随させ、最後に計画書経由の波及（`implementation-plan-creator`）を塞ぐ。自動テストが存在しない領域のため、各タスクの検証は `rg` によるアンカー文字列の存在・不在確認で行う。

**Tech Stack:** Markdown（Claude Code Agent 定義）、`rg`（検証）、`git`

## Global Constraints

- 出典メモ `/Users/otto/workspace/craftbank/arrangement-env/front/.mgzl/memo/20260810-102544-code-comment-writing-rules.md` は**読み取り専用**。編集しない
- 変更対象は `cbo/agents/*.md` のみ。`cbo/skills/` 配下・スクリプト・`marketplace.json` は変更しない
- **各ファイルの記述言語を変えない。挿入する文面はそのファイルの既存言語で書く**
  - `reviewer-for-comments.md` — **英語**で書く。ただし既存ファイルの流儀に合わせ、次のものは日本語のまま残す: コメント例・レビュー対象文の引用（`（前例: utils/useStorage.ts の decodeValue）` 等）、日本語固有の表現（「また」「ただし」「敬体/常体」等）、Severity ラベル（`推奨` / `軽微`）、レポートテンプレート
  - `code-implementer.md` / `test-implementer.md` / `implementation-plan-creator.md` / `knowledge-distiller.md` — **日本語**で書く
- **文長基準は全ファイルで統一する**: 主基準は「1 文 1 事実」、補助基準は 50 文字超で分割検討・80 文字超で分割
- `reviewer-for-comments.md` の既存 criterion 番号 1〜5 は**変更しない**。本文中に `see criterion 4` / `use criterion 5` の参照が存在するため、新設分は 6・7 として末尾に採番する
- Edit の位置指定は**行番号でなく既存文言のアンカー**で行う。ファイルは随時更新されうる
- **作業ブランチは `feat/cbo-comment-writing-rules`**。`main` へ直接コミットしない
- **各タスクは自身の変更をコミットして終える**（タスク末尾のコミットステップは必須）。タスク単位で差分が分離されることがレビューの前提
- コミットメッセージは Conventional Commits 形式（`feat:` / `fix:` / `refactor:` / `chore:`）
- 計画書（`docs/superpowers/plans/`）と SDD 作業ファイル（`.superpowers/`）はコミット対象に含めない。各タスクは `cbo/agents/` 配下の変更のみを `git add` する

---

## File Structure

- `cbo/agents/reviewer-for-comments.md` — **検知側**。削除すべき類型・保護すべき類型・分量・配置の基準を持つ。他の全タスクの概念の基準点
- `cbo/agents/code-implementer.md` — **生成側（本体コード）**。「コメント・ドキュメント」節が唯一の変更対象
- `cbo/agents/test-implementer.md` — **生成側（テストコード）**。「コメント・ドキュメント」節 + AAA コメント保護
- `cbo/agents/implementation-plan-creator.md` — **波及元**。計画書のサンプルコードは実装者が写経するため、ここのコメント規約が製品コードへ流出する
- `cbo/agents/knowledge-distiller.md` — **退避先**。コメントから外した情報の受け皿カテゴリを明示（任意タスク）

### 変更しないもの（判断根拠）

- `cbo/skills/review__diff/SKILL.md`, `cbo/skills/review__fix/SKILL.md` — レビュアーを起動するフローのみで、判断基準を持たない
- `cbo/agents/reviewer-for-test-code.md` — characterization テストへのコメント**追加要求**は別責務として維持する
- `cbo/style-rule.md` — 冒頭に「適用方法は未確定で一旦この文書に保管しているだけ」とあり、コメント規約も含まない

---

## Task 1: `reviewer-for-comments` に削除類型・分量・配置・保護基準を追加

**Files:**
- Modify: `cbo/agents/reviewer-for-comments.md`

**言語:** このタスクで挿入する文面は**英語**。コメント例・日本語固有表現・Severity ラベルのみ日本語のまま。

**Interfaces:**
- Consumes: なし（先行タスクなし）
- Produces: 後続タスクが対応づける概念と基準値を確定する（英語呼称 → 後続タスクの日本語呼称）
  - 削除類型 5 種: `Precedent citations` → 前例としての出典表記 / `Cross-references to other comments` → 他のコメントを指す相互参照 / `Explanations of library / framework internals` → ライブラリ・フレームワークの内部挙動の解説 / `Spec descriptions that reach into another file's internals` → 他ファイルの内部実装に踏み込んだ仕様説明 / `Full chains of inference` → 推論の連鎖の全記述
  - 保護類型 4 種: `What breaks if this is removed or changed` / `What is not covered` / `Why the code is deliberately built differently` / `The responsibilities of a runtime collaborator`
  - 分量の目安: 通常コメント 1–3 行 / JSDoc 3–4 行
  - 文長基準: 50 文字超で分割検討・80 文字超で分割
  - 新設セクション名: `#### 3.1 Empirically confirmed removal patterns`, `#### 3.2 Volume guideline`, `### 6. Comment placement and shape`, `### 7. Comments that must be preserved`

このタスクは 3.1（削除類型の追加）と criterion 7（保護リスト）を**必ず同時に入れる**。削除方向の基準だけを先に入れると、レビューが過剰削除へ振れるため分割しない。

- [ ] **Step 1: 現行のアンカー文言が存在することを確認**

Run: `rg -n "Absence of comments|Other redundant commentary|Sentence length|Explicit out-of-scope reminders|Japanese-comment readability" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: 5 行すべてヒットする。ヒットしない行があれば、ファイルが更新されているので該当箇所を Read して置換対象を特定し直す。

- [ ] **Step 2: Out of scope に AAA コメントの保護を追加**

置換前:

```markdown
- Absence of comments — never suggest adding a new comment (see criterion 4)
```

置換後:

```markdown
- Absence of comments — never suggest adding a new comment (see criterion 4)
- AAA comments (`// Arrange` / `// Act` / `// Assert`) — they look redundant under criterion 3, but the project has agreed to keep them. Never flag them (see criterion 7)
```

- [ ] **Step 3: criterion 3 の末尾に小節 3.1 / 3.2 を追加**

置換前:

```markdown
- Other redundant commentary whose removal would not impair a reader's understanding
```

置換後:

````markdown
- Other redundant commentary whose removal would not impair a reader's understanding

#### 3.1 Empirically confirmed removal patterns

The following types were removed wholesale when a human cleaned up Claude-authored comments. Each is `[2]`.

- **Precedent citations** — a parenthetical that cites a prior example as the reason the code was written this way, e.g. `（前例: utils/useStorage.ts の decodeValue）` or `（前例: useIndexStore.test.ts の reactive な mockRoute）`. The existence of a precedent is not evidence that the current code is correct, and the note rots the moment the cited symbol is renamed or deleted. **Flag these even when the cited file and symbol do exist** — this is a different reason from criterion 2 (unresolvable reference). Suggest rewriting the rationale as "what breaks here if this changes"
- **Cross-references to other comments** — e.g. `（下の月送りのテストと同じ理由。詳細はそちらのコメントを参照）` or `（上の setSupplierId(99) のケースと対称に見る）`. They depend on reading order, so deleting one side or reordering the file strands the reader. Every comment must stand on its own
- **Explanations of library / framework internals** — e.g. `（@nuxt/test-utils の runtime-utils）`, `（vm.$emit は vnode の onXxx を引くだけ）`, `（型は RouteLocationRaw | false）`. Keep only as far as "why this setting is required". Explaining the mechanism is not the comment's job
- **Spec descriptions that reach into another file's or component's internals** — e.g. what the callee's `watch` emits. This becomes a lie as soon as the other side changes. The caller's circumstances belong in the caller
- **Full chains of inference** — comments that spell out every intermediate step ("demoted to a fallthrough attribute → no longer present in `props()` → …"). Suggest compressing to a single "conclusion + how it breaks" pair

#### 3.2 Volume guideline

- An ordinary comment should be at most **1–3 lines**; a JSDoc / TSDoc block at most **3–4 lines**
- When a comment exceeds this, check whether one of the 3.1 patterns is mixed in. If so, flag that part; if not, suggest restructuring it as a bulleted list
- **Exceeding the guideline is not by itself a reason to report.** Flag only when you can point to specific content that can be cut
````

- [ ] **Step 4: criterion 5 の文長項目を統一基準へ差し替え**

置換前:

```markdown
- **Sentence length** — sentences longer than ~50 Japanese characters are suspect; check whether they can be split using connectors such as 「また」, 「そして」, or 「ただし」
```

置換後:

```markdown
- **Sentence length** — a sentence over 50 Japanese characters should be split where possible (`[1]`); over 80 characters, split it (`[2]`). Use connectors such as 「また」, 「そして」, or 「ただし」. The primary test is "one sentence, one fact" (criterion 6); the character count is secondary
```

- [ ] **Step 5: criterion 6 / 7 を追加**

置換前:

```markdown
### Explicit out-of-scope reminders
```

置換後:

```markdown
### 6. Comment placement and shape

- **Placement** — an explanation belongs directly above the line it governs. When a block has been stacked at the top of a function, or in front of a group of assertions, suggest moving it down to the line where it actually takes effect (`[2]`)
- **Consolidation** — when the same explanation is repeated in prose across several places, suggest consolidating it into one location (typically a JSDoc block) as a bulleted list, leaving 1–2 lines at each site. **A JSDoc block growing longer through this consolidation is acceptable** and takes precedence over 3.2 — the goal is not "make it shorter" but "stop writing the same thing in prose over and over"
- **One sentence, one fact** — suggest splitting sentences that stack causes on top of each other (「〜のため、〜なので、〜だから」)
- **What syntax can express** — when a comment explains something the syntax itself could carry (e.g. a paragraph explaining that a call is deliberately not awaited), suggest replacing it with the syntax (`void`) and keeping only the reason in the comment (`[1]`)

### 7. Comments that must be preserved

The past cleanup did **not** remove comments indiscriminately. Never suggest deleting or shortening the following. If a draft finding targets one of these, delete the finding outright — do not merely lower its severity.

- **What breaks if this is removed or changed** — 「手書きスタブへ戻さないこと」, 「route: false が必須」, 「回数だけが唯一の差になる」
- **What is *not* covered** — a gap where the test stays green regardless: 「イベント名の改名は emit テストでは検知できない」
- **Why the code is deliberately built differently from its counterpart** — e.g. why a fake assembles values in the opposite direction from the real store
- **The responsibilities of a runtime collaborator** — 「年月は `useYearAndMonthSelectStore` のセッターが直接 push する」

**How this differs from the "precedent citations" pattern in 3.1.** Naming another file in a comment is not banned across the board.

- ✗ Remove: a reference to a **prior example** as the reason for the chosen approach (`（前例: xxx.ts の yyy）`)
- ○ Keep: a reference to a **collaborator that shares responsibility at runtime** (`year/month は useYearAndMonthSelectStore が書く`)

**Be conservative about the "obvious" judgment in criterion 3.** What the code reveals is *what it does*, never *why it was done that way*. Even for a one-line implementation, keep the *why* — such as the reason that value is exposed separately from its neighbor.

**AAA comments** (`// Arrange` / `// Act` / `// Assert`) are a project convention. Never flag them, however redundant they look.

### Explicit out-of-scope reminders
```

- [ ] **Step 6: Severity scale の `[2]` 行へ追記**

置換前（`[2]` 行の末尾部分のみ）:

```
otherwise redundant comments; comments that are clearly hard to read |
```

置換後:

```
otherwise redundant comments; comments that are clearly hard to read. **Also includes the removal patterns in 3.1 (precedent citations, cross-references to other comments, explanations of library internals, spec descriptions reaching into another file's internals, and full chains of inference) and the placement / shape violations in criterion 6.** |
```

- [ ] **Step 7: Review process へ工程を追加し、self-review に保護対象の除外を追加**

置換前:

```markdown
5. **Japanese-comment readability** — check subject–predicate agreement, sentence length (~50-character threshold), double negation, mixed 敬体/常体, and circumlocution (criterion 5)
6. **Classify** every finding using the severity scale above
7. **Self-review** the draft report and drop (a) anything outside comment territory (logic, design, style, security, tests) and (b) every finding that recommends adding a new comment
```

置換後:

```markdown
5. **Scan for removal patterns, volume, and placement** — find the five 3.1 patterns (precedent citations / cross-references to other comments / explanations of library internals / spec descriptions reaching into another file's internals / full chains of inference). Check volume against 3.2 (1–3 lines, JSDoc 3–4 lines), and check placement and "one sentence, one fact" against criterion 6
6. **Japanese-comment readability** — check subject–predicate agreement, sentence length (the 50 / 80 character thresholds in criterion 5), double negation, mixed 敬体/常体, and circumlocution (criterion 5)
7. **Classify** every finding using the severity scale above
8. **Self-review** the draft report and drop (a) anything outside comment territory (logic, design, style, security, tests), (b) every finding that recommends adding a new comment, and (c) **every finding whose target falls under the protections in criterion 7**
```

- [ ] **Step 8: 追加内容の存在を検証**

Run: `rg -c "3.1 Empirically confirmed removal patterns|3.2 Volume guideline|6. Comment placement and shape|7. Comments that must be preserved" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `4`

- [ ] **Step 9: 旧文長基準が残っていないことを検証**

Run: `rg -n "sentences longer than" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: ヒット 0 件（終了コード 1）。ヒットした場合は Step 4 の置換が適用されていない。

- [ ] **Step 10: criterion 番号の参照が壊れていないことを検証**

Run: `rg -n "criterion 4|criterion 5|criterion 7" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `criterion 4` が「Never suggest adding comments」を指す参照として、`criterion 5` が「Japanese readability」を指す参照として残っている。`criterion 7` が Out of scope の AAA 行と self-review の (c) から参照されている。

- [ ] **Step 11: 挿入文面の言語を目視確認**

Read で 3.1 / 3.2 / criterion 6 / criterion 7 を読み、次を確認する。

1. 説明文がすべて英語で書かれていること
2. 日本語が残っているのは、コメント例（`（前例: ...）` 等）・保護類型の引用（「手書きスタブへ戻さないこと」等）・日本語固有表現（「また」「ただし」）に限られること
3. 既存 criterion 1〜5 の英語のトーン（`Flag ...` / `must be ...`）から浮いていないこと

- [ ] **Step 12: コミット**

```bash
git add cbo/agents/reviewer-for-comments.md
git commit -m "feat: reviewer-for-comments にコメント削除類型と保護基準を追加"
```

---

## Task 2: `code-implementer` の「コメント・ドキュメント」節を差し替え

**Files:**
- Modify: `cbo/agents/code-implementer.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 1 が確定した削除類型 5 種・保護類型 4 種の概念、分量の目安（1〜3 行 / 3〜4 行）、文長基準（50 / 80）
- Produces: Task 3 が複製する共通本文（「残すもの / 削るもの」「量・配置・表現」「正確さ」の 3 ブロック構成）

このタスクは既存記述との衝突を 2 件解消する。

1. 現行の「説明コメントは**意図とメカニズム**を明示し」は、メモ A-3（ライブラリ内部挙動の解説を削る）・A-6（推論の連鎖を圧縮する）と正面衝突するため削除する
2. 現行の「参照は追跡可能な形（シンボル名・実体）で書き」は前例参照を許容してしまうため、前例参照（禁止）と責務分担相手（許可）の切り分けへ置換する

- [ ] **Step 1: 置換対象の範囲を確認**

Run: `rg -n "^### コメント・ドキュメント$|^## 報告形式$" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: 2 行ヒットする。前者の見出し行の次の行から、後者の見出し行の直前までが置換範囲。

- [ ] **Step 2: 節の本文を全置換**

`### コメント・ドキュメント` 見出しの直後から `## 報告形式` 見出しの直前までを、以下で置換する（見出し行 `### コメント・ドキュメント` 自体は残す）。

```markdown
**残すもの / 削るもの**

- 残す価値があるのは次の 4 つ: ①これを外す・変えると何が壊れるか ②担保していない範囲（緑のまま通ってしまう穴） ③実装と意図的に違う作りにしている理由 ④実行時に協調する相手の責務
- 「何をするか」の言い換えは削る。ただしコードから読めるのは *何をしているか* だけであり、*なぜそうしたか* は実装が単純でも残す
- 「前例: <ファイル>.ts の <シンボル>」型の出典表記を書かない。前例があることは今のコードが正しい根拠にならず、参照先の改名・削除で腐る。根拠は「この場所で何が壊れるか」で書く。**実行時に責務を分担している相手への参照（`year/month は useYearAndMonthSelectStore が書く`）は残してよい**
- 他のコメントを指す相互参照（「上のケースと同じ理由」「詳細はそちらを参照」）を書かない。各コメントはその場で完結させる
- ライブラリ・フレームワークの内部挙動の解説を書かない。残すのは「この設定が必要な理由」まで
- 他ファイル・他コンポーネントの内部実装（相手の `watch` が何を emit するか等）に踏み込んだ仕様説明を書かない。呼び出し元の事情は呼び出し元に書く。他ファイルの制約へ暗黙依存する実装では、依存している前提だけを 1 行で明示する
- 推論の連鎖を全部書かない。中間の機序は落とし「結論 + 壊れ方」の 1 セットへ圧縮する
- 編集経緯・一過性プロセス成果物への参照（「旧挙動から変更」「Step N 対応」「本 PR では対応しない」「カナリア検証で判明」等）を残さない。履歴は git log / PR 説明へ、未着手は追跡情報付き `TODO:` へ
- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。再利用価値のある前例・内部挙動はナレッジ側へ移す

**量・配置・表現**

- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う
- 説明はそれが効いている行の直上に置く。関数冒頭にまとめて積み上げない。非標準記法の理由コメントも対象記法の直近に置く
- 同じ説明を複数箇所に散文で書かない。1 箇所へ集約し、集約先は箇条書きにする。現場の行には 1〜2 行だけ残す（この集約で JSDoc が長くなるのは許容する）
- 1 文 1 事実。「〜のため、〜なので、〜だから」と因果を積み重ねない。50 文字を超えたら分割を検討し、80 文字を超えたら分割する
- コメントより構文で示せるものは構文へ寄せる（意図的に `await` しないなら `void` を付け、コメントには理由だけ残す）
- 丸数字（①②③）・連番ベース参照は使わない。使用例は 5 行以下
- 日本語コメントに未定着の英単語を混入しない。語彙はコードベースの既定表現を Grep で確認してから採用する

**正確さ**

- キャスト等の理由コメントは宣言箇所に 1 箇所だけ書き、使用箇所へ繰り返さない
- コメント移動時は移動先の文脈に合わせて書き直す。責務移動時は旧 JSDoc を同一 PR 内で更新し doc rot を防ぐ
- コメント・describe が参照する実装事実（処理の所在・シンボル名・コピー方式・破壊性等の技術用語）は実装と必ず突合する。コピペ流用時は参照シンボルを必ず更新する
- 因果・効果方向・境界条件（`=== 0` / `>= 2` 等）を実装と厳密一致させる。兄弟実装との差分・制御フローの内外は実コード照合後に書く（憶測記述禁止）。例外分類の説明は投げ得る全経路を確認して網羅する。UI 操作は記号でなく操作意味で書き、似た名前が並ぶ箇所では主語を省略しない
- 現状受容コメント（characterization・暫定対応・回避策）には why / 運用上の前提 / 将来の修正方針の 3 観点を揃える。環境要因の回避策は理由を必ずコメント化し、環境名（DOM 実装等）は設定ファイルで実値を確認してから書く
- 関数 JSDoc は全責務を列挙し、責務が増えたら更新する
```

- [ ] **Step 3: 衝突していた旧表現が消えたことを検証**

Run: `rg -n "意図とメカニズムを明示|参照は追跡可能な形|80〜100 文字" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 4: 新基準が入ったことを検証**

Run: `rg -c "前例: <ファイル>.ts|1 文 1 事実|1〜3 行、JSDoc は 3〜4 行" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md`

Expected: `3`

- [ ] **Step 5: 節の前後が壊れていないことを確認**

Read で `### コメント・ドキュメント` 節の前後 5 行を確認する。直前が `### Vue リアクティビティ・テンプレート` 節の末尾、直後が `## 報告形式` 見出しであること。誤って隣接節を巻き込んで削除していないかを見る。

- [ ] **Step 6: コミット**

```bash
git add cbo/agents/code-implementer.md
git commit -m "feat: code-implementer のコメント規約をメモ由来の基準へ更新"
```

---

## Task 3: `test-implementer` の「コメント・ドキュメント」節を差し替え

**Files:**
- Modify: `cbo/agents/test-implementer.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 2 が確定した 3 ブロック構成の本文
- Produces: なし（後続タスクはこの内容を参照しない）

Task 2 との差分は、テスト固有の記述（モックのデフォルト値・環境要因の回避策・ヘルパーの一元化）を保持することと、**AAA コメントの保護**を明記することの 2 点。

- [ ] **Step 1: 置換対象の範囲を確認**

Run: `rg -n "^### コメント・ドキュメント$|^### テストコード$" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: 2 行ヒットする。前者の見出し行の次の行から、後者の見出し行の直前までが置換範囲。

- [ ] **Step 2: 節の本文を全置換**

`### コメント・ドキュメント` 見出しの直後から `### テストコード` 見出しの直前までを、以下で置換する（見出し行 `### コメント・ドキュメント` 自体は残す）。

```markdown
**残すもの / 削るもの**

- 残す価値があるのは次の 4 つ: ①これを外す・変えると何が壊れるか ②担保していない範囲（緑のまま通ってしまう穴） ③実装と意図的に違う作りにしている理由 ④実行時に協調する相手の責務
- 「何をするか」の言い換えは削る。ただしコードから読めるのは *何をしているか* だけであり、*なぜそうしたか* は実装が単純でも残す
- **AAA コメント（`// Arrange` / `// Act` / `// Assert`）は自明に見えても削らない**。プロジェクト規約として維持する。削る対象は AAA ラベルそのものではなく、その脇に添える説明文のうちテスト名・Assert から自明なもの
- 「前例: <ファイル>.test.ts の <シンボル>」型の出典表記を書かない。前例があることは今のテストが正しい根拠にならず、参照先の改名・削除で腐る。根拠は「この場所で何が壊れるか」で書く。**実行時に責務を分担している相手への参照は残してよい**
- 他のコメントを指す相互参照（「上のケースと同じ理由」「詳細はそちらを参照」「下のテストと対称に見る」）を書かない。各コメントはその場で完結させる
- ライブラリ・テストフレームワークの内部挙動の解説を書かない。残すのは「この設定が必要な理由」まで
- SUT や他コンポーネントの内部実装に踏み込んだ仕様説明を書かない。相手の実装が変われば嘘になる
- 推論の連鎖を全部書かない。中間の機序は落とし「結論 + 壊れ方」の 1 セットへ圧縮する
- 編集経緯・一過性プロセス成果物への参照（「Step N 対応」「本 PR では対応しない」「以前は」等）を残さない
- 削った情報の価値がゼロなのではなく、置き場所がコメントではないというだけ。再利用価値のある前例・内部挙動はナレッジ側へ移す

**量・配置・表現**

- 通常コメントは 1〜3 行、JSDoc は 3〜4 行が上限の目安。超えたら上記の削る類型が混ざっていないか疑う
- 説明はそれが効いている行の直上に置く。アサート群の手前へまとめて積み上げず、各 `expect` の直上へ置く
- 同じ説明を複数箇所に散文で書かない。1 箇所（describe 先頭・`beforeEach`・ヘルパー名）へ集約し、集約先は箇条書きにする（この集約で JSDoc が長くなるのは許容する）
- 1 文 1 事実。「〜のため、〜なので、〜だから」と因果を積み重ねない。50 文字を超えたら分割を検討し、80 文字を超えたら分割する
- コメントより構文で示せるものは構文へ寄せる（意図的に `await` しないなら `void` を付け、コメントには理由だけ残す）
- 丸数字（①②③）・連番ベース参照は使わない
- 日本語コメントに未定着の英単語を混入しない。語彙は既存の既定表現を Grep で確認してから採用する

**正確さ**

- キャスト等の理由コメントは宣言箇所に 1 箇所だけ書き、使用箇所へ繰り返さない
- コメント移動時は移動先の文脈に合わせて書き直す
- コメント・describe が参照する実装事実（所在・シンボル名・コピー方式・破壊性等）は実装と必ず突合する。コピペ流用時は参照シンボルを必ず更新する
- 因果・効果方向・境界条件を実装と厳密一致させる。兄弟実装との差分は実コード照合後に書く（憶測記述禁止）
- モックのデフォルト値は実際の値を正確に書き、分岐が期待側へ落ちる理由まで明示する
- 現状受容コメント（characterization・暫定対応）には why / 運用上の前提 / 将来の修正方針の 3 観点を揃える。環境要因の回避策（`vi.mock('heic2any')` が Node で動作しない等）は理由を必ずコメント化し、環境名は `vitest.config.ts` 等で実値を確認してから書く
- ヘルパーの詳細説明は定義側コメントへ一元化する
```

- [ ] **Step 3: 「テストコード」節の AAA 関連記述を明確化**

現行の「テストコード」節に、AAA ラベル自体の禁止と読める余地のある記述がある。置換前:

```markdown
カナリア的な pin を配置する場合は describe 冒頭に同期義務を明示する。代表象限のみカバーする場合は省略した象限と理由を NOTE で明示する。fixture の JSDoc に「唯一の真実源」等の絶対的断言を書かない。テスト名・Assert から自明な Act/Assert 直前コメントは書かない
```

置換後:

```markdown
カナリア的な pin を配置する場合は describe 冒頭に同期義務を明示する。代表象限のみカバーする場合は省略した象限と理由を NOTE で明示する。fixture の JSDoc に「唯一の真実源」等の絶対的断言を書かない。テスト名・Assert から自明な説明コメントは書かない（`// Arrange` / `// Act` / `// Assert` の AAA ラベル自体は規約として残す）
```

- [ ] **Step 4: 新基準と AAA 保護が入ったことを検証**

Run: `rg -c "AAA ラベル|1 文 1 事実|1〜3 行、JSDoc は 3〜4 行" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md`

Expected: `4`（`AAA ラベル` が Step 2 と Step 3 の 2 箇所、残り 2 語が各 1 箇所）

- [ ] **Step 5: 節の前後が壊れていないことを確認**

Read で `### コメント・ドキュメント` 節の前後 5 行を確認する。直前が `### 設計・責務分離` 節の末尾、直後が `### テストコード` 見出しであること。

- [ ] **Step 6: コミット**

```bash
git add cbo/agents/test-implementer.md
git commit -m "feat: test-implementer のコメント規約更新と AAA コメント保護の明記"
```

---

## Task 4: `implementation-plan-creator` の計画書経由の波及を塞ぐ

**Files:**
- Modify: `cbo/agents/implementation-plan-creator.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 2 が確定した削る類型の呼称、分量の目安
- Produces: なし

計画書のサンプルコードは実装者が写経するため、計画書側の冗長コメントはそのまま製品コードへ残る。あわせて、現行の「順序根拠をステップ番号付きコメントで明文化する」が `code-implementer` の「Step N 対応を残さない」および同ファイルの「変更差分ベースの一時コメントを製品コードへ持ち込まない」と衝突しているため是正する。

- [ ] **Step 1: 置換対象の存在を確認**

Run: `rg -n "計画書のサンプルコードもプロジェクト規約|既存パターン踏襲時は順序根拠" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: 2 行ヒットする。

- [ ] **Step 2: サンプルコード内コメントの規約準拠を追記**

置換前:

```markdown
- 計画書のサンプルコードもプロジェクト規約（ネスト三項禁止・`==` 禁止・`!` 理由コメント必須等）に完全準拠させる（実装者は写経する）
```

置換後:

```markdown
- 計画書のサンプルコードもプロジェクト規約（ネスト三項禁止・`==` 禁止・`!` 理由コメント必須等）に完全準拠させる（実装者は写経する）
- サンプルコードに書くコメントも本体のコメント規約に従う。前例としての出典表記・ライブラリの内部挙動の解説・推論の連鎖の全記述を書かない。通常 1〜3 行 / JSDoc 3〜4 行に収め、説明はそれが効いている行の直上に置く。**実装者は写経するため、計画書側の冗長コメントはそのまま製品コードへ残る**
```

- [ ] **Step 3: ステップ番号付きコメントの指示を是正**

置換前:

```markdown
- 既存パターン踏襲時は順序根拠をステップ番号付きコメントで明文化する
```

置換後:

```markdown
- 既存パターン踏襲時は順序根拠を明文化する。ただし**ステップ番号をサンプルコード内のコメントへ書かない**（写経で「Step N 対応」が製品コードに残り、編集経緯を残さないルールに反する）。順序根拠は計画書の本文側に書き、コードコメントとして残すなら「順序を変えると何が壊れるか」の形へ書き換える
```

- [ ] **Step 4: 是正結果を検証**

Run: `rg -n "ステップ番号付きコメント" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: ヒット 0 件（終了コード 1）

- [ ] **Step 5: 追記が入ったことを検証**

Run: `rg -c "計画書側の冗長コメントはそのまま製品コードへ残る|ステップ番号をサンプルコード内のコメントへ書かない" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md`

Expected: `2`

- [ ] **Step 6: コミット**

```bash
git add cbo/agents/implementation-plan-creator.md
git commit -m "fix: implementation-plan-creator のサンプルコード内コメント規約を是正"
```

---

## Task 5: `knowledge-distiller` に退避先を明示（任意）

**Files:**
- Modify: `cbo/agents/knowledge-distiller.md`

**言語:** このタスクで挿入する文面は**日本語**（ファイルの既存言語に合わせる）。

**Interfaces:**
- Consumes: Task 2 の「削った情報はナレッジ側へ移す」という記述
- Produces: なし

このタスクは**任意**。適用しなくても Task 1〜4 は機能する。適用すると、コメントから外した情報の受け皿が教訓ファイル側にあることが明示される。

- [ ] **Step 1: 置換対象の存在を確認**

Run: `rg -n "コメント・ドキュメント・ファイル名・フォーマット" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/knowledge-distiller.md`

Expected: 1 行ヒットする（振り分け補助のリスト内）。

- [ ] **Step 2: 振り分け補助へ退避先の説明を追記**

置換前:

```markdown
- コメント・ドキュメント・ファイル名・フォーマット → `## コメント・ドキュメント品質`（または旧 `## コメント品質`）
```

置換後:

```markdown
- コメント・ドキュメント・ファイル名・フォーマット → `## コメント・ドキュメント品質`（または旧 `## コメント品質`）。コードコメントから外した情報（他ファイルを前例として挙げる出典表記、ライブラリ・フレームワークの内部挙動の解説）も、再利用価値があればここへ教訓として残す。コメントに置かないだけで価値がゼロなのではない
```

- [ ] **Step 3: 追記を検証**

Run: `rg -c "コメントに置かないだけで価値がゼロなのではない" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/knowledge-distiller.md`

Expected: `1`

- [ ] **Step 4: コミット**

```bash
git add cbo/agents/knowledge-distiller.md
git commit -m "chore: knowledge-distiller にコメント由来知識の退避先を明記"
```

---

## Task 6: クロスファイル整合の最終検証

**Files:**
- Modify: なし（検証のみ。不整合が見つかった場合は該当タスクへ戻る）

**Interfaces:**
- Consumes: Task 1〜5 のすべての変更
- Produces: なし

検知側（英語）と生成側（日本語）で記述言語が異なるため、検証は言語ごとに分けて行う。

- [ ] **Step 1: 旧文長基準が全ファイルから消えたことを検証**

Run: `rg -n "80〜100 文字|~50 Japanese characters|sentences longer than" /Users/otto/workspace/mgzl-claude-code-plugin/cbo`

Expected: ヒット 0 件（終了コード 1）。ヒットした場合は該当ファイルの文長基準が旧値のまま残っている。

- [ ] **Step 2: 新しい文長基準が生成側（日本語）に入ったことを検証**

Run: `rg -l "50 文字を超えたら分割を検討" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents`

Expected: `code-implementer.md`, `test-implementer.md` の 2 ファイル

- [ ] **Step 3: 新しい文長基準が検知側（英語）に入ったことを検証**

Run: `rg -c "over 50 Japanese characters" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `1`

- [ ] **Step 4: 削除類型が生成側（日本語）で揃っていることを検証**

Run: `rg -l "推論の連鎖" /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents`

Expected: `code-implementer.md`, `test-implementer.md`, `implementation-plan-creator.md` の 3 ファイル（`reviewer-for-comments.md` は英語のため含まれない）

- [ ] **Step 5: 削除類型が検知側（英語）で揃っていることを検証**

Run: `rg -c '^- \*\*Precedent citations|^- \*\*Cross-references to other comments|^- \*\*Explanations of library|^- \*\*Spec descriptions|^- \*\*Full chains of inference' /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md`

Expected: `5`（3.1 の 5 類型の箇条書き見出しが各 1 行）。行頭の `- **` に錨を打つのは、同じ語が Severity scale・Review process・criterion 7 の本文中にも出現し、単純な語句検索では件数が意図と一致しないため

- [ ] **Step 6: 検知側と生成側の対応を目視確認**

Read で `cbo/agents/reviewer-for-comments.md` の 3.1 / criterion 7 と、`cbo/agents/code-implementer.md` の「コメント・ドキュメント」節を並べて読み、次を確認する。

1. 3.1 の 5 類型が、code-implementer の「残すもの / 削るもの」の禁止項目と 1 対 1 で対応していること（言語は違っても内容が一致していること）
2. criterion 7 の保護 4 類型が、code-implementer の「残す価値があるのは次の 4 つ」と一致していること
3. 3.1「precedent citations」と criterion 7「runtime collaborator」の切り分け（✗ / ○ の 2 行）が、code-implementer の「実行時に責務を分担している相手への参照は残してよい」と矛盾しないこと

- [ ] **Step 7: エージェント定義のフロントマターが壊れていないことを検証**

Run: `rg -c "^name: " /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/reviewer-for-comments.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/code-implementer.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/test-implementer.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/implementation-plan-creator.md /Users/otto/workspace/mgzl-claude-code-plugin/cbo/agents/knowledge-distiller.md`

Expected: 全 5 ファイルが `1`

- [ ] **Step 8: 差分の全体像を確認**

Run: `git -C /Users/otto/workspace/mgzl-claude-code-plugin diff main...HEAD --stat`

Expected: `cbo/agents/` 配下の 4〜5 ファイルのみが変更されている。`cbo/skills/` 配下や `marketplace.json` に変更が出ていたら誤編集。

---

## 実行後の後始末

- [ ] 本計画書 `docs/superpowers/plans/2026-08-10-cbo-comment-writing-rules.md` の扱いをユーザーに確認する（リポジトリへ残す / 削除する）
- [ ] `cbo/.claude-plugin/plugin.json` の `version` を上げるかユーザーに確認する（エージェント定義の変更はプラグイン利用側の挙動を変えるため）
