# cbo レビュアーの投機的未来ゲート 設計書

作成日: 2026-08-11

## 背景と問題

cbo のレビュー系サブエージェントが、「今は実装されていないが、将来 X が追加されたら壊れる」という指摘を出すことがある。これは実装コードに対しては明白な YAGNI 違反であり、存在しない未来のために防御コードを書かせることになる。

原因はレビュアーの気まぐれではなく、エージェント定義そのものに埋め込まれた矛盾である。

### 原因 1: `reviewer-for-design` 内で YAGNI と Open/Closed が正面衝突している

- `cbo/agents/reviewer-for-design.md:82` YAGNI —「仮定的な未来のために足された設定・引数・抽象を叩け」
- `cbo/agents/reviewer-for-design.md:79` Open/Closed —「**予見しうる拡張**に対してショットガン手術を強いる設計を叩け」
- `cbo/agents/reviewer-for-design.md:136` severity `[3]` の例示 —「**将来の作業をブロックする**責務崩壊」

同一エージェントに「未来に備えるな」と「未来に備えよ」が同居している。レビュアーは指摘を出す方向にバイアスがかかるため、Open/Closed 側に倒れる。しかもどちらに転んでも「指示に従った」と正当化できてしまう。

### 原因 2: `reviewer-for-logic` のエッジケース基準に「到達可能性」の縛りが無い

- `cbo/agents/reviewer-for-logic.md:72-79` は「空配列・空文字列・null・undefined・ゼロ・負数・最大値・オーバーフロー」を列挙するのみで、*その入力が現在の型・呼び出し元・API 契約から実際に到達しうるか* を検証させていない
- `cbo/agents/reviewer-for-logic.md:138` の `[2]` 定義に `a plausible edge case`（もっともらしいエッジケース）とあり、想像できるだけで `[2]` を撃てる

### 原因 3: 横断的な「指摘の適格性ゲート」が存在しない

各レビュアーの `Out of scope` は観点の縦割り（これは logic の話、これは design の話）のみ。「そもそも指摘として成立するか」という横断的な足切りが誰にも無い。

### 原因 4: `reviewer-for-test-code` 自身が投機的条項を持つ

`cbo/agents/reviewer-for-test-code.md:209-231` の「5.5 Module-level mutable state as a **future footgun**」は、「将来 setup を 2 回呼ぶテストが書かれたら」という現存しない変更を前提とした投機的指摘でありながら、`:270` で `[2] 推奨` に列挙されている。

## 方針の決定事項

ユーザーとの合意事項は以下のとおり。

- **将来リスクを見つけたときの振る舞い**: 実装コードへの防御追加は禁止し、**テスト・型への振替**として出す
- **実装コードへの防御を認める例外**: **外部境界**（型で保証されない実行時入力）と、**計画済み拡張**（実装計画書・TODO・チケットに明記されたもの）
- **修正対象**: `reviewer-for-logic` / `reviewer-for-design` / `reviewer-for-security-performance` / `reviewer-for-test-code` の 4 ファイル
- **`implementation-plan-reviewer` と `knowledge-distiller` は対象外**（理由は「副作用と非スコープ」参照）
- **実装方式**: 共通参照ファイルは作らず、各エージェント本文に同一文面を埋め込む（教訓はランタイム参照ではなくエージェント本体に織り込む、という既存方針に従う）
- **`reviewer-for-test-code` の 5.5**: 一貫性を優先し、ゲートを適用して `[1]` に降格する

## 設計

### 1. 共通ゲート（4 ファイル共通・同一文面）

各レビュアーの `## Out of scope (do not report)` セクションの直後に、以下のセクションを挿入する。

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

#### `[1]` ハードキャップの根拠

`cbo/skills/review__diff/SKILL.md:93`（Step 10）は severity `2` 以上の指摘のみを `knowledge-distiller` に流す。振替指摘を `[1]` に固定することで、投機的な話が `$MGZL_DIR/knowledge/implementation-lessons.md` に永住する経路が自動的に塞がる。`knowledge-distiller` 側に逆流防止弁を実装する必要は無い。

また各レビュアー共通の Approval rule により `[1]` のみは「承認」なので、振替指摘がマージをブロックすることも無い。

### 2. `cbo/agents/reviewer-for-design.md`

#### 2-1. Open/Closed 条項（`:79`）

- 現状: `- **Open/Closed**: adding new behavior should not require modifying every consumer. Flag designs that force shotgun-surgery for foreseeable extensions.`
- 変更後: `- **Open/Closed**: adding new behavior should not require modifying every consumer. Flag shotgun-surgery designs **only when the extension is already planned** (named in an implementation plan under review, a `TODO` in the diff, or a referenced ticket). "Someone might add a case later" is a YAGNI-violating premise — route it through the speculative-future gate.`

#### 2-2. severity `[3]` の例示（`:136`）

- 現状の末尾: `severe responsibility breakdown that will block future work`
- 変更後: `severe responsibility breakdown demonstrable in the current diff (e.g. one file now owns fetching, presentation, and business rules)`

「将来の作業をブロックする」という表現が、投機的指摘に最高重要度を与える抜け道になっている。

#### 2-3. YAGNI 条項（`:81-82`）への追記

既存の 1 行の下に以下を追加する。

```markdown
- This is the mirror image of the speculative-future gate: the gate stops **you** from demanding hypothetical-future code, YAGNI stops the **author** from shipping it. When both could apply, the gate wins — never demand a guard to satisfy Open/Closed.
```

### 3. `cbo/agents/reviewer-for-logic.md`

#### 3-1. エッジケース節（`:72` 直後）への到達可能性要求の追加

`### 2. Edge-case coverage` の箇条書きの前に以下を挿入する。

```markdown
Every edge case you list must be traced to an input that can occur today — check the declared type, every call site in the diff, and the API contract. An input the type system forbids and no call site produces is not an edge case; it is a speculative future.
```

#### 3-2. severity `[2]`（`:138`）

- 現状: `A likely correctness issue, a significant unhandled edge case, a plausible edge case, or a possible performance concern on growing data — should be fixed before merge`
- 変更後: `A likely correctness issue, a significant unhandled edge case reachable from an input that exists today, or a possible performance concern on growing data — should be fixed before merge`

`a plausible edge case` を撤去する。「もっともらしい」という語が、想像しただけで `[2]` を撃てる根拠になっている。

#### 3-3. レビュープロセス Step 3（`:153`）

- 現状: `3. **Enumerate edge cases** — for each input, list which boundary conditions matter`
- 変更後: `3. **Enumerate edge cases** — for each input, list which boundary conditions matter, then discard every case whose triggering input cannot occur today. Reachability is part of the finding, not an afterthought.`

### 4. `cbo/agents/reviewer-for-security-performance.md`

共通ゲートの挿入のみ。このファイルには「将来」を前提とする条項が無いため、他の変更は不要。

### 5. `cbo/agents/reviewer-for-test-code.md`

このファイルはゲートの適用対象であると同時に、他レビュアーからの振替の受け皿でもある。

#### 5-1. テスト用スコープ注記（共通ゲートの直後）

```markdown
### Scope note for test code

A test that exists to catch a *future* change to the implementation is the whole point of testing — never gate it, and never call it redundant. The gate applies only to findings about the **test code itself** breaking in the future ("if a future test calls setup twice", "if someone adds a case here later"). Those are speculative and capped at `[1]`.
```

#### 5-2. §2 Test-redundancy detection（`:74-80`）への追記

箇条書きの末尾に以下を追加する。

```markdown
Tests that pin current behavior against a future change — characterization tests (§5.6), and tests redirected here by another reviewer's speculative-future gate — are **not** redundant. Do not flag them under this section.
```

これが無いと、`reviewer-for-logic` が「テストで固定せよ」と振り替えた先で `reviewer-for-test-code` が「冗長なテスト」として叩き落とす事故が起きる。

#### 5-3. 5.5 の降格（4 箇所を同期して変更）

1. 見出し（`:209`）: `#### 5.5 Module-level mutable state as a future footgun` → `#### 5.5 Module-level single-slot cleanup targets`
2. 本文の末尾（コード例の後）に追記: ``Under the speculative-future gate this is a speculative finding — no test calls setup twice today. Report it as a test-level obligation and cap it at `[1]`.``
3. 検出チェックリスト: `:270` の `- [ ] Module-level single-slot variable (`let scope`, `let controller`, etc.) used to hold an `afterEach` cleanup target — convert to an array` を `#### [2] 推奨` から `#### [1] 軽微` へ移動する
4. severity reference テーブル（`:340`）の `[2]` 行の例示から `single-slot afterEach cleanup target` を削除し、`:341` の `[1]` 行の例示に追加する

## 副作用と非スコープ

### 確認済みの副作用（いずれも問題なし）

- `cbo/skills/review__diff/SKILL.md:93`（Step 10）は severity `2` 以上のみを教訓化するため、`[1]` 上限の振替指摘は `implementation-lessons.md` に流れない
- 各レビュアーの Approval rule により `[1]` のみは「承認」。振替指摘はマージをブロックしない
- `cbo/skills/review__diff/SKILL.md:54-68`（Step 5）の観点の選び分けには影響しない
- reviewview には `[1]` の指摘も投入される。指摘自体は人間の目に触れ、不要ならトリアージで「対応しない」を選べる

### 非スコープ

- **`implementation-plan-reviewer`**: 実装計画書レビューにも同種の矛盾（`:56` の「アーキテクチャ上のアンチパターン」経由）が存在しうるが、今回は対象外とする
- **`knowledge-distiller`**: `[1]` ハードキャップにより教訓化経路が塞がるため、逆流防止弁の実装は不要
- **`reviewer-for-comments`**: コメントレビューでは投機的未来を前提とする指摘が出にくいため対象外
- **`cbo/skills/review__diff/SKILL.md`**: 統合段階でのフィルタは二重管理になるため導入しない。レビュアー側で潰す

## 変更ファイル一覧

- `cbo/agents/reviewer-for-logic.md`
- `cbo/agents/reviewer-for-design.md`
- `cbo/agents/reviewer-for-security-performance.md`
- `cbo/agents/reviewer-for-test-code.md`

いずれも Markdown のみ。コード・スクリプトへの変更は無い。
