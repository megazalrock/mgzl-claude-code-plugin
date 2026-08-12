# implementation-plan-creator-lite 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コードサンプルを排した軽量な実装計画書を生成する新規サブエージェントを追加し、`impl:create` から詳細版と選択できるようにする。

**Architecture:** 既存 `implementation-plan-creator` はいっさい変更せず、それをベースに削り込んだ独立ファイル `implementation-plan-creator-lite` を新設する。出力テンプレートは `document-saver` に軽量版を追加し、`impl:create` 側は作成エージェントの選択とレビュアー集合の分岐だけを担う。

**Tech Stack:** Markdown（Claude Code Plugin の Skill / Agent 定義）。ビルド・テスト実行環境は不要。

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-08-13-implementation-plan-creator-lite-design.md`
- 既存 `cbo/agents/implementation-plan-creator.md` と `cbo/skills/document-saver/references/format-implementation-plan.md` は**変更しない**
- `code-implementer` / `test-implementer` / `impl:execute` / 各 reviewer エージェント本体は**変更しない**
- エージェント定義のフロントマター必須フィールドは `name`, `description`, `model`, `tools`（任意: `skills`）
- Skill のフロントマター必須フィールドは `name`, `description`
- `.claude-plugin/marketplace.json` は編集不要（スキル・エージェントの追加時は不要）
- 計画書のどのステップにも `git commit` / `git push` を含めない（コミットはユーザーの明示指示に基づき人間が実施する）
- 応答・ドキュメントはすべて日本語

---

## ファイル構成マップ

- `cbo/skills/document-saver/references/format-implementation-plan-lite.md` — 新規。軽量版計画書のテンプレート
- `cbo/skills/document-saver/SKILL.md` — 変更。種類リストとテンプレート対応表に軽量版を追加
- `cbo/agents/implementation-plan-creator-lite.md` — 新規。軽量版計画書を作成するサブエージェント
- `cbo/skills/impl__create/SKILL.md` — 変更。作成エージェントの選択とレビュアー集合の分岐
- `docs/superpowers/specs/2026-08-13-implementation-plan-creator-lite-design.md` — 変更（1 箇所）。手順番号の扱いを実装に合わせる

---

## Task 1: 軽量版テンプレートの新設と document-saver への登録

**Files:**
- Create: `cbo/skills/document-saver/references/format-implementation-plan-lite.md`
- Modify: `cbo/skills/document-saver/SKILL.md`（Step 1 の種類リスト / Step 2 の対応表）

**Interfaces:**
- Consumes: なし
- Produces: テンプレートファイルのパス `references/format-implementation-plan-lite.md`、および document-saver が認識する種類名「軽量版実装計画書」。Task 2 のエージェントはこの種類名を指定して保存を依頼する

- [ ] **Step 1: `format-implementation-plan-lite.md` を新規作成する**

以下の内容をそのまま書き込む。

````markdown
# [機能名] 実装計画（軽量版）

<!-- 本テンプレートはコードサンプルを排した軽量版。コードで書いてよいのは型定義・関数シグネチャ・定数名と値・API のリクエスト/レスポンス形状のみ。関数本体・制御フロー・テストコード・モック定義・マークアップは日本語の指示で表現する -->

**Goal:** [これが何を作るのかを1文で]

**Architecture:** [アプローチを2〜3文で。スコープを分割しなかった場合はその根拠も含める]

**Tech Stack:** [主要な技術・ライブラリ]

## Global Constraints

<!-- プロジェクト全体に効く要求事項を1行1件で記載する。CLAUDE.md / .claude/rules/ / ユーザーから事前確定された方針から、値は逐語でコピーする（要約しない）。ここに書いた内容は全ステップの要件に暗黙的に含まれる -->
- [制約1]
- [制約2]

## 実装計画の実行時のルール

<!-- 以下のリストは固定テキスト -->
1. 依存関係に従ってステップを実行すること（並列実行可能なステップは同時に実行してよい）
2. 必要であれば各ステップ完了後にテストを実行し、既存のテストが壊れていないことを確認すること
3. 不明点が出た場合は作業を中断し確認すること

## ファイル構成マップ

<!-- 同一ファイルが複数ステップに現れる場合、それらのステップは直列とし、後続ステップに `blockedBy` を設定する -->
- `path/to/file.ts` — [新規/変更] [このファイルの責務を1行で]
- `path/to/another.ts` — [新規/変更] [このファイルの責務を1行で]

## 実装ステップ

### - [ ] ステップ1: [ステップ名]
<!-- 見出し先頭のチェックボックスはステップの進捗管理用。完了時に実装エージェントが `- [x]` へ書き換える。チェックボックスはステップのタイトルには含めない -->
<!-- チェックボックスを付けるのはステップ見出しのみ。`**実装内容**` の箇条書きには付けない -->
- **難易度**: [低/中/高/最高]
- **担当**: code-implementer / test-implementer
  <!-- 1 ステップ = 1 サブエージェントへの 1 委譲。変更対象がテストファイルのみなら test-implementer、本体コードを含むなら code-implementer -->
- **概要**: [ステップの説明]
- **実装内容**:
  <!-- 何をどの条件でどう変えるかを日本語で確定させる。コードブロックは書かない -->
  - [具体的な作業項目1]
  - [具体的な作業項目2]
- **Files**:
  <!-- ファイル構成マップの部分集合。該当がない種別は行ごと省略する。Modify の行範囲は目安であり、特定は構文的特徴を併記する -->
  - Create: `exact/path/to/file.ts`
  - Modify: `exact/path/to/existing.ts:123-145`
  - Test: `tests/exact/path/to/file.test.ts`
- **Interfaces**:
  <!-- 実装者は自分のステップしか見えない。隣接ステップが使う名前と型はこのブロックからのみ学べる。軽量版で唯一コードを書いてよい場所 -->
  - Consumes: [先行ステップから使うもの。正確なシグネチャで書く。依存が無い場合も「なし」と明記し、行ごと省略しない]
  - Produces: [後続ステップが依存するもの。関数名・引数型・戻り値型を正確に書く]
- **依存関係**: [前提条件]
- **TaskList依存関係**:
  - `blockedBy`: [ブロッカー]
  - `blocks`: [ブロック]
  - `並列グループ`: [並列実行用グループ]

[他のステップも同様に記載]

### テスト実装ステップの書式

<!-- 担当が test-implementer のステップは `**実装内容**` の代わりに `**テスト観点**` を使う。テストコード・雛形・モック定義は書かない -->

```markdown
### - [ ] ステップN: [対象]のテストを追加
- **難易度**: [低/中/高/最高]
- **担当**: test-implementer
- **テスト観点**:
  - 対象 SUT: `exact/path/to/sut.ts` の `シンボル名`
  - 検証層: [composable 単体 / ストア単体 / コンポーネント / 統合]
  - ケース一覧:
    - [入力条件] → [期待結果]
    - [入力条件] → [期待結果]
  - 網羅方針: [網羅する分岐] / [意図的に省略する分岐とその理由]
- **Files**:
  - Test: `tests/exact/path/to/file.test.ts`
- **Interfaces**:
  - Consumes: [テスト対象のシグネチャ]
  - Produces: なし
```

### TDD 採用ステップの書式

<!-- TDD を採用したステップのみこの書式を使う。RED と GREEN は担当サブエージェントが異なるため、必ず 2 ステップに分割し `blockedBy` で結ぶ -->
<!-- superpowers 原型はサイクル末尾に `git commit` ステップを置くが、Git 操作は計画書のどのステップにも記載しないため含めない。将来も再導入しないこと -->

```markdown
### - [ ] ステップN: [対象]の失敗するテストを作成し RED を確認
- **担当**: test-implementer
- **難易度**: [低/中/高/最高]
- **テスト観点**:
  - 対象 SUT: `exact/path/to/sut.ts` の `シンボル名`
  - 検証層: [composable 単体 / ストア単体 / コンポーネント / 統合]
  - ケース一覧:
    - [入力条件] → [期待結果]
  - 網羅方針: [網羅する分岐] / [意図的に省略する分岐とその理由]
- **RED 確認**:
  - 実行コマンド: `[test-runner 経由の実行指定]`
  - 期待される失敗: [失敗の種類 + メッセージに含まれるべき文字列]
- **Files**:
  - Test: `tests/exact/path/to/file.test.ts`
- **Interfaces**:
  - Consumes: なし
  - Produces: [後続の実装ステップが満たすべきシグネチャ]

### - [ ] ステップN+1: 最小実装で GREEN にする
- **担当**: code-implementer
- **難易度**: [低/中/高/最高]
- **実装内容**:
  - [何をどう変えるかを日本語で確定させる]
- **GREEN 確認**:
  - 実行コマンド: `[ステップN と同一のコマンドを再掲する]`
  - 期待される結果: PASS
- **Files**:
  - Modify: `exact/path/to/existing.ts:123-145`
- **Interfaces**:
  - Consumes: [ステップN の Produces を再掲する]
- **TaskList依存関係**:
  - `blockedBy`: ステップN
```

**「期待される失敗」の記述粒度**

- 完全一致は要求しない。`vue-tsc` 等のバージョン差でメッセージが揺れ、計画書がすぐ陳腐化するため
- **部分一致レベル**で書く。書式は「失敗の種類 + メッセージに含まれるべき文字列」
  - 例: `アサーション失敗（expected 3 / received undefined）`
  - 例: `参照エラー（メッセージに "is not defined" を含む）`
- この粒度が `test-implementer` の RED 判定（期待どおりの失敗 / 想定外の失敗 / 成功してしまった）の基準として使われる。判定できない粒度で書かないこと

## 不明点・確認事項 <!-- [任意] -->

### 1. [不明点のタイトル]
- **確認内容**: [何を確認するか]
- **確認先**: [誰に確認するか]
- **理由**: [なぜ確認が必要か]
- **影響**: [確認結果が実装に与える影響]

## 技術的考慮事項
- TypeScript厳格設定への対応
- テスト戦略
- パフォーマンスへの影響

## リスクと対策 <!-- [任意] -->
[想定されるリスクと対策]

----
作成日時：[作成日時]
最終更新日：[最終更新日]
ブランチ名: [現在のブランチ名]
````

- [ ] **Step 2: テンプレートに想定所要時間が残っていないことを確認する**

Run: `rg -n "所要時間" cbo/skills/document-saver/references/format-implementation-plan-lite.md`
Expected: ヒット 0 件（出力なし）

- [ ] **Step 3: `document-saver/SKILL.md` の種類リストに軽量版を追加する**

`cbo/skills/document-saver/SKILL.md` の Step 1 にある種類リストのうち、次の行を探す。

```markdown
- **実装計画書**: implementation-plan-creator サブエージェントが出力した実装計画書
```

この行の直後に、次の 1 行を追加する。

```markdown
- **軽量版実装計画書**: implementation-plan-creator-lite サブエージェントが出力した、コードサンプルを排した実装計画書
```

- [ ] **Step 4: `document-saver/SKILL.md` のテンプレート対応表に軽量版を追加する**

同ファイル Step 2 の表のうち、次の行を探す。

```markdown
| 実装計画書 | [format-implementation-plan.md](references/format-implementation-plan.md) |
```

この行の直後に、次の 1 行を追加する。

```markdown
| 軽量版実装計画書 | [format-implementation-plan-lite.md](references/format-implementation-plan-lite.md) |
```

- [ ] **Step 5: document-saver の参照整合を確認する**

Run: `rg -n "format-implementation-plan-lite" cbo/skills/document-saver/SKILL.md`
Expected: 1 件ヒット（Step 2 の表の行）

Run: `rg -n "軽量版実装計画書" cbo/skills/document-saver/SKILL.md`
Expected: 2 件ヒット（種類リストと対応表）

---

## Task 2: `implementation-plan-creator-lite` エージェントの新設

**Files:**
- Create: `cbo/agents/implementation-plan-creator-lite.md`
- Read（変更しない）: `cbo/agents/implementation-plan-creator.md`

**Interfaces:**
- Consumes: Task 1 が作った種類名「軽量版実装計画書」とテンプレート `format-implementation-plan-lite.md`
- Produces: エージェント名 `implementation-plan-creator-lite`。Task 3 の `impl:create` はこの名前で起動する

- [ ] **Step 1: 既存エージェントをコピーして新ファイルの土台を作る**

`cbo/agents/implementation-plan-creator.md` の内容を読み込み、`cbo/agents/implementation-plan-creator-lite.md` として書き出す。以降の Step でこのファイルだけを編集する。**既存ファイルは編集しない。**

- [ ] **Step 2: フロントマターを差し替える**

新ファイルのフロントマターについて、以下を変更する。他のフィールド（`tools` の一覧、`skills`）は既存のまま維持する。

- `name`: `implementation-plan-creator-lite`
- `color`: `orange` → `yellow`
- `model`: `opus`（変更なし）
- `description`: 次の文言に置き換える

```
コードサンプルを排した軽量な実装計画書を作成する。実装コードやテストコードの実体は計画書に書かず、契約（型・シグネチャ・定数名）と方針・テスト観点のみを記述する。トークン効率を優先したいとき、または impl:create で軽量版が選択されたときに使用する。!`echo $MGZL_DIR`/implementations ディレクトリに、ステップバイステップの実装ガイダンス、難易度評価、確認事項を含む`.md`ファイルを生成する。
```

- [ ] **Step 3: 「想定読者」節を書き換える**

`## 想定読者` 節の本文（箇条書き 4 項目）を、次の内容に置き換える。見出しは維持する。

```markdown
計画書の読み手は、この会話に同席していない実装サブエージェントである。以下を前提として書くこと。

- 計画書の実装者は `code-implementer` / `test-implementer` サブエージェントである。計画を書いた会話の文脈を一切持たず、渡されるのは**計画書のパスと担当ステップ番号のみ**である
- 実装者は開発者としては有能だが、このコードベースの前提知識・ドメイン知識はゼロと想定する
- 計画書が実装者に与えるのは **契約・方針・調査済みの事実** であり、コードそのものではない。実装コード・テストコードは実装者が自ら書く
- 計画書は「何を満たすべきか」を規定し、「どう書くか」は規定しない。ただし **後続ステップが依存する契約**（型・関数シグネチャ・定数名）は計画書からしか伝わらないため、そこだけは正確にコードで書く
- 「計画書に書かれていないことは実行されない」という原則は維持する。省略してよいのはコードの実体だけであり、要件・制約・検証条件・調査で確定した事実は省略しない
```

- [ ] **Step 4: ワークフローから所要時間の記述を除去する**

以下の 3 箇所を修正する。

1. `### ステップ2: 実装ステップの分割` の「**ステップの構造：**」の列挙から `想定所要時間 /` を削除する
2. `### ステップ5: 結果の報告` の報告フォーマットから `⏱️ 想定総所要時間: [X]時間` の行を削除する
3. `### ステップ4: 実装計画ドキュメントの作成` の冒頭を、軽量版テンプレートを指定する記述に変更する

3 の変更後の文は次のとおり。

```markdown
document-saver スキルで !`echo $MGZL_DIR`/implementations/ に保存する。**ドキュメント種類は「軽量版実装計画書」を指定し、`format-implementation-plan-lite.md` テンプレートを使わせること。**
```

- [ ] **Step 5: 「禁止フレーズ」節をコード非依存の内容へ差し替える**

`### 禁止フレーズ（プレースホルダの排除）` 節の本文を、次の内容に置き換える。見出しは維持する。

```markdown
以下は**計画の失敗**であり、計画書に書いてはならない。実装者は書かれていないことを実行できない（`## 想定読者` 参照）。

- 「TBD」「後で実装」「詳細は後述」「適宜」「必要に応じて」— 範囲が確定できない用法のもの
- 「適切なエラーハンドリングを追加」「バリデーションを追加」「エッジケースを処理」— 何をどう処理するかを具体的に書く
- 「上記のテストを書く」— 何を検証するテストなのかを「テスト観点の記述形式」に従って書く
- 「ステップ N と同様」— 内容を再掲する。実装者はステップを順番どおりに読むとは限らない
- どのステップでも定義されていない型・関数・メソッドへの参照
- 実装内容が日本語で確定していないステップ — 「何を」「どの条件で」「どう変えるか」の 3 点が読み取れることを要件とする

具体化を担保するための個別規則:

- 計画書本文の具体内容（シンボル名・定量値・「N 箇所で参照」等）はすべて事前検証し、実名・実測値で書く。「設計意図」と「現状実態」は分離して記述する
- 「など複数ファイル」等の曖昧な範囲指定は Grep で実在箇所を再確認してからスコープを確定する
- ESLint / type check 等の CI 相当の検証は「省略可」と書かず「必須」と断定する
- 複数変換が組み合わさる表示文字列の期待値は、確定した具体的な最終文字列（`'佐藤（社名）さん、…'` 等）を明記する
- 参照する fixture / ヘルパー / インポート元パスは、実体を Grep・シンボル検索で確認した正確な名称で書く
- DoD 等のチェック項目に根拠を捏造しない（未実施なら判断根拠だけ書く）
```

- [ ] **Step 6: 「コードを書いてよい範囲」節を新設する**

`### 禁止フレーズ（プレースホルダの排除）` 節の直後に、次の節を挿入する。

```markdown
### コードを書いてよい範囲

本エージェントが作る計画書は**軽量版**である。コードの実体は実装者が書くため、計画書に載せるコードは契約に限定する。

**コードで書いてよいもの**

- 型定義・インターフェース・型エイリアス
- 関数・メソッドのシグネチャ（引数型・戻り値型）
- 定数名とその値
- API のリクエスト / レスポンスの形状
- 設定ファイルのキーと値

**コードで書かないもの**

- 関数・メソッドの本体、制御フロー
- テストコード・テストの雛形・モック定義
- Vue の template / JSX などのマークアップ
- 既存コードの引用（引用したい場合はファイルパスと構文的特徴で位置を示す）

**判定基準**

「後続ステップまたは実装者が、その名前と型を正確に知らないと実装できないもの」だけをコードで書く。それ以外は日本語の指示で表現する。契約は各ステップの `**Interfaces**` フィールドへ集約し、`**実装内容**` には日本語の指示だけを書く。
```

- [ ] **Step 7: 「テスト計画」節を「テスト観点の記述形式」節へ置き換える**

`### テスト計画` 節（サブセクション A / B / C / D を含む節全体）を削除し、同じ位置に次の節を挿入する。

```markdown
### テスト観点の記述形式

テストステップにはテストコードを書かず、以下を列挙する。

- **対象 SUT**: ファイルパスとシンボル名
- **検証層**: composable 単体 / ストア単体 / コンポーネント / 統合 のいずれか
- **ケース一覧**: 「入力条件 → 期待結果」を 1 行 1 件で列挙する。期待結果は確定した具体値で書く
- **網羅方針**: 網羅する分岐と、意図的に省略する分岐およびその理由

観点を確定させるために、計画段階で以下を確認する。

- 既存テストファイルへの追記では既存 describe / it を読み、重複シナリオの有無を確認する
- 既存の型付き factory 群（`makeXxx` 等）や共有 fixture を探索し、あれば再利用を前提に観点を組む
- 状態モデルのロジック検証はストア / composable 単体で担保する。コンポーネントテスト（モック差し替え）では状態モデル自体の欠陥を検出できないため、どちらの層で行うかを明示する
- 分岐網羅では各 `if` / `else if` / 三項演算子の真偽すべてをケース化し、「分岐に入らない」ケースも独立に列挙する
- 分岐網羅の入力は「分岐判定が誤っていたら期待値が変わる」ものを選ぶ（ミューテーション視点）
- 計画中に対象実装のバグを発見したら、テストを現挙動に追従させて「バグを温存したまま緑になるテスト」を作らない。既知バグは NOTE で明示し、計画書に「実装が想定と異なる場合は中断・報告」と明記する

Vitest やモックライブラリの実装上の落とし穴（`clearMocks` の挙動、`vi.hoisted` の巻き上げ、fake timers の局所化等）は `test-implementer` の責務であり、計画書には書かない。
```

- [ ] **Step 8: 「コード例・コメントの記述ルール」節を削除する**

`### コード例・コメントの記述ルール` 節を、見出しごと削除する。

- [ ] **Step 9: 残りの指針節を縮約する**

以下の 4 節から、コード掲載・工数計算に依存する項目を削除する。各節の見出しと、それ以外の項目は維持する。

1. `### ステップ分割と見積もり` — 削除する項目
   - 「複数要素を含む複合ステップの見積もりは要素ごとに加算し…」
   - 「手動確認シナリオの見積もりは画面遷移・DevTools 操作…」
   - 「単一ステップが 2 時間を超える粒度ならサブタスクへ分割する」は、「単一ステップが 1 サブエージェントの 1 セッションで完了できない粒度ならサブタスクへ分割する」に書き換える
2. `### 検証ステップ設計` — **変更しない**（全項目が Grep による機械的検証に関するもので、コード掲載・工数計算に依存する記述は含まれない）
3. `### 計画書内の整合性` — 削除する項目
   - 「規模感・工数・テスト件数は frontmatter / 各 Section / 完了基準のすべてで単一の値に統一する。…」（`it.each` の件数厳密算出、雛形コード内の `it` 数との突合を含む一文全体）
   - 「合計工数と並列実行時実時間を明示的に区別する。…」（フロントマターの 3 項目分割・算出式に関する一文全体）
   - 型・シンボルの整合、部分改訂時の同時更新、移行系計画書の規則は維持する
4. `### 判断根拠とリスクの明示` — 全項目を維持する（コード掲載に依存する記述はないため変更不要）

- [ ] **Step 10: 「実装設計の指針」の表現を調整する**

`## 実装設計の指針` 配下の各サブ節は維持する。ただし「サンプルコードに含める」「雛形コードを書く」といった表現がある項目は、「計画書本文に明記する」へ言い換える。該当は `### TypeScript 型設計` の `noUncheckedIndexedAccess` に関する項目など。

- [ ] **Step 11: セルフレビュー節に軽量版固有の観点を追加する**

`### ステップ3.5: セルフレビュー` の 3 点目（型・シンボル整合性）の直後に、4 点目として次を追加する。

```markdown
4. **コード混入の走査** — 計画書内のコードブロックを全件確認し、「コードを書いてよい範囲」に該当しないもの（関数本体・制御フロー・テストコード・モック定義・マークアップ）が混入していないか点検する。該当したら日本語の指示へ書き換える
```

- [ ] **Step 12: 新エージェントの構造を検証する**

Run: `rg -c "^" cbo/agents/implementation-plan-creator-lite.md`
Expected: 400 以下（実行結果: 392 行。当初の期待値 200 行は、維持対象として指定した指針節だけで約 370 行に達するため達成不可と判明した。行数より下の構造チェックを優先する）

Run: `rg -n "所要時間" cbo/agents/implementation-plan-creator-lite.md`
Expected: ヒット 0 件

Run: `rg -n "写経|コードブロックを必須|Arrange-Act-Assert 骨格" cbo/agents/implementation-plan-creator-lite.md`
Expected: ヒット 0 件

Run: `rg -n "^name:|^model:|^color:" cbo/agents/implementation-plan-creator-lite.md`
Expected: `name: implementation-plan-creator-lite` / `model: opus` / `color: yellow`

- [ ] **Step 13: 既存エージェントが無変更であることを確認する**

Run: `git status --short cbo/agents/implementation-plan-creator.md`
Expected: 出力なし（変更されていない）

---

## Task 3: `impl:create` からの選択と軽量版レビュー分岐

**Files:**
- Modify: `cbo/skills/impl__create/SKILL.md`（手順 3 / 手順 5-A / 手順 5-A・5-B の修正ステップ）

**Interfaces:**
- Consumes: Task 2 が作ったエージェント名 `implementation-plan-creator-lite`
- Produces: なし（ワークフローの終端）

- [ ] **Step 1: 手順 3 を「作成エージェントの選択と実装計画書の作成」に拡張する**

現状の手順 3 は次の 1 行である。

```markdown
3. 収集した情報を元に @implementation-plan-creator エージェントを利用して実装計画書を作成する
```

これを次に置き換える。手順番号は 3 のまま維持する（4 以降および 5-A / 5-B の呼称がずれると、以降の分岐記述との整合が壊れるため）。

```markdown
3. 作成する計画書の種類を選択し、実装計画書を作成する
  - AskUserQuestion で計画書の種類をユーザーに選択させる。選択肢は以下の順で提示する
    1. **軽量版**（コードサンプルなし。契約・方針・テスト観点のみを記載し、コードは実装時に任せる）
    2. **詳細版**（コードサンプルあり。従来どおり実装コード・テストコードの実体を計画書に記載する）
  - 選択結果に応じて、収集した情報を元に実装計画書を作成する
    - 軽量版を選択した場合: `@implementation-plan-creator-lite` エージェントを利用する
    - 詳細版を選択した場合: `@implementation-plan-creator` エージェントを利用する
  - **選択結果は以降の手順 5-A で参照するため保持しておく**
```

- [ ] **Step 2: 手順 5-A のレビュアー集合の初期化を分岐させる**

手順 5-A の「**次回起動するレビュアー集合**」の初期化ブロックのうち、次の 2 行を探す。

```markdown
      - **計画書がテスト実装を主目的とする場合**: `@reviewer-for-test-code`
      - **それ以外の場合**: `@reviewer-for-design`, `@reviewer-for-logic`
```

これを次に置き換える。

```markdown
      - **計画書がテスト実装を主目的とする場合**: `@reviewer-for-test-code`
      - **それ以外の場合**:
        - 手順 3 で**詳細版**を選択していた場合: `@reviewer-for-design`, `@reviewer-for-logic`
        - 手順 3 で**軽量版**を選択していた場合: `@reviewer-for-design`
          （`@reviewer-for-logic` は計画書内のコードを読んでロジックを検証する役割のため、軽量版では起動しない）
```

- [ ] **Step 3: 軽量版でレビュアーを起動する際の但し書きを追加する**

手順 5-A の「1. **レビュー実施**」のブロックに、次の 1 項目を追加する。

```markdown
         - **手順 3 で軽量版を選択していた場合**、各レビュアーへ渡すプロンプトに次の但し書きを含める
           > 本計画書は軽量版であり、コードサンプルを意図的に排している。コードブロック・テストコード雛形が存在しないこと自体を指摘対象としてはならない。指摘してよいのは、契約（型・シグネチャ・定数名）の欠落・不整合、テスト観点の抜け、方針の矛盾である。
```

- [ ] **Step 4: 修正ステップにコード追記の禁止を明記する**

手順 5-A の「3. **修正**」と手順 5-B の「3. **修正**」の双方に、次の 1 項目を追加する。

```markdown
         - **手順 3 で軽量版を選択していた場合**、指摘の反映によってコードサンプル（関数本体・制御フロー・テストコード・モック定義）を追加してはならない。契約（型・シグネチャ・定数名）の追記は許容する
```

- [ ] **Step 5: impl:create の改修結果を検証する**

Run: `rg -n "implementation-plan-creator-lite" cbo/skills/impl__create/SKILL.md`
Expected: 1 件ヒット（手順 3）

Run: `rg -n "軽量版" cbo/skills/impl__create/SKILL.md`
Expected: 手順 3 の選択肢、手順 3 の選択結果保持の指示、手順 5-A のレビュアー集合分岐、手順 5-A の但し書き、手順 5-A の修正制約、手順 5-B の修正制約の 6 箇所すべてに出現していること

Run: `rg -n "^[0-9]+\. " cbo/skills/impl__create/SKILL.md`
Expected: 手順番号が 1〜8 で連続しており、重複・欠番がない

---

## Task 4: 設計書の追従と全体整合の確認

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-implementation-plan-creator-lite-design.md`

**Interfaces:**
- Consumes: Task 3 で確定した `impl:create` の手順構成
- Produces: なし

- [ ] **Step 1: 設計書の手順挿入位置の記述を実装に合わせる**

設計書の `### 4. impl:create スキルの改修` にある次の見出しを探す。

```markdown
**手順 2 と 3 の間に「作成エージェントの選択」を挿入**
```

これを次に置き換え、直下の箇条書きの 1 項目目「AskUserQuestion で計画書の種類を選択させる」の前に、番号を維持した理由を 1 行追加する。

```markdown
**手順 3 を「作成エージェントの選択と実装計画書の作成」に拡張**

- 新規手順として挿入せず既存の手順 3 を拡張する（手順番号を繰り下げると 5-A / 5-B の呼称および以降の分岐記述との整合が壊れるため）
```

あわせて、直後の「**手順 3 の変更**」ブロックは Step 1 の記述に統合されるため削除する。

- [ ] **Step 1.5: 設計書のセルフレビュー観点を追記する**

設計書の `#### 本文構成` の「**新設する節**」の箇条書き末尾に、次の 1 項目を追加する（実装計画 Task 2 Step 11 に対応する）。

```markdown
- `### ステップ3.5: セルフレビュー` に 4 点目「コード混入の走査」を追加
  - 計画書内のコードブロックを全件確認し、「コードを書いてよい範囲」に該当しないものが混入していないか点検する
```

- [ ] **Step 2: 全変更ファイルの整合を確認する**

Run: `git status --short`
Expected: 変更・追加されているのは次の 6 ファイルのみ
- `cbo/agents/implementation-plan-creator-lite.md`（新規）
- `cbo/skills/document-saver/references/format-implementation-plan-lite.md`（新規）
- `cbo/skills/document-saver/SKILL.md`（変更）
- `cbo/skills/impl__create/SKILL.md`（変更）
- `docs/superpowers/specs/2026-08-13-implementation-plan-creator-lite-design.md`（変更）
- `docs/superpowers/plans/2026-08-13-implementation-plan-creator-lite.md`（新規。本計画書自身）

- [ ] **Step 3: 相互参照が全て解決することを確認する**

Run: `rg -n "format-implementation-plan-lite" cbo/`
Expected: `cbo/skills/document-saver/SKILL.md` の対応表と、`cbo/agents/implementation-plan-creator-lite.md` のステップ4（保存指示）でヒットする

Run: `rg -n "implementation-plan-creator-lite" cbo/`
Expected: `cbo/agents/implementation-plan-creator-lite.md`（frontmatter の name）、`cbo/skills/document-saver/SKILL.md`（種類リスト）、`cbo/skills/impl__create/SKILL.md`（手順 3）でヒットする

- [ ] **Step 4: 既存資産が無変更であることを確認する**

Run: `git status --short cbo/agents/implementation-plan-creator.md cbo/skills/document-saver/references/format-implementation-plan.md cbo/agents/code-implementer.md cbo/agents/test-implementer.md cbo/skills/impl__execute/SKILL.md`
Expected: 出力なし（いずれも変更されていない）

---

## 動作確認（手動）

実装完了後、以下を人間が実施して確認する。自動テストは存在しないため、実運用による確認とする。

- `/impl:create` を実行し、手順 3 で軽量版を選択できること
- 生成された計画書にコードフェンスが型・シグネチャ以外に含まれないこと
- 生成された計画書を `/impl:execute` に投入し、ステップがタスクとして登録され、難易度と依存関係が正しく読み取られること
- 詳細版を選択した場合に、従来どおり `implementation-plan-creator` が起動し、5-A で design + logic のレビューが走ること

## コミットについて

本計画にはコミットステップを含めない。プロジェクト方針により、コミットはユーザーの明示的な指示に基づき人間が実施する。
