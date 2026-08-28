# audit-memory スキル 設計書

- 作成日: 2026-08-28
- 対象プラグイン: mgzl（`common/`）
- 状態: 承認済み（対話での設計合意に基づく）

## 目的

Claude Code の AutoMemory（`~/.claude/projects/<encoded-project-path>/memory/`）に蓄積された記憶を棚卸しし、
「削除可 / 保持 / 要判断」の三分類で報告する。人間は「要判断」だけを見て判断すればよい状態を作る。

## スコープ

- 対象はカレントプロジェクト（`${CLAUDE_PROJECT_DIR}`）の AutoMemory のみ。プロジェクト横断は対象外
- 報告のみ。削除・修正などの処置はスキル内で行わない（自動削除は運用で信頼できると分かってから検討する）
- AutoMemory の読み取りのみ。書き込みは一切しない

## 棚卸しの観点

### A. 構造的整合性（スクリプトで機械検査）

1. 索引整合: `MEMORY.md` と実ファイルの突き合わせ（未索引ファイル / 実体の無い索引行）
2. フロントマター妥当性: `name` / `description` / `metadata.type` の存在、`type` が `user | feedback | project | reference`
3. 命名規約: ファイル名の接頭辞（`user_` / `feedback_` / `project_` / `reference_`）と `metadata.type` の一致、`name` とファイル名（拡張子除く）の一致。`name` はケバブケース、ファイル名はスネークケースが正常形なので、比較は `-` と `_` を同一視して行う
4. 規定外キー: `metadata` 配下に `type` 以外のキーがある（書き手のバージョン差によるドリフト検出）
5. リンク整合: `[[name]]` の参照先が、いずれかの記憶の `name` またはファイル名（拡張子除く）に存在するか（`-` と `_` は同一視）。存在しないものは「未執筆リンク」として警告扱い（エラーではない）
6. 1ファイル1事実: H2 見出しが 3 つ以上、または本文が 60 行超のものをヒューリスティックで検出

### B. 内容の妥当性（サブエージェントで判断）

個別検証（1 ファイルで閉じる）:

7. 鮮度・真偽: 記憶の主張がコード・git 履歴の現状と合っているか。特に `project` 型の「未完了」「予定」
8. リポジトリから導ける内容: CLAUDE.md・コード・git 履歴で分かる内容は memory に置かない規則に照らして不要か
9. テンプレート準拠: `feedback` / `project` に **Why** / **How to apply** があり、適用条件が具体的か
10. 分類の正しさ: `metadata.type` が内容に合っているか

横断検証（複数ファイルにまたがる）:

11. 重複・包含: 同じ事実を複数ファイルが述べている、片方が他方を包含している
12. 矛盾: 2 つの記憶が逆のことを言っている

### 意図的に外す観点

- 利用実績（参照されたか）: AutoMemory には参照日時に相当する情報が無く測定不能
- プロジェクト横断の重複、CLAUDE.md への昇格判断: スコープ外（横断が必要になってから検討）

## 構成

追加するファイルは 3 つ。

- `common/skills/audit-memory/SKILL.md` — 司令塔。手順と報告形式を定義
- `common/skills/audit-memory/scripts/check-structure.ts` — 観点 A の機械検査。bun で実行、`key=value` 形式で出力
- `common/agents/memory-auditor.md` — 観点 B の検証エージェント。`model: sonnet`、`tools: Read, Glob, Grep, Bash`（Bash は `git log` / `git show` による履歴照合用）

エージェント本体は英語で記述し、出力のみ日本語とする（既存の `budgeted-investigator` と同じ流儀）。
判定基準はエージェント本体に織り込み、呼び出しプロンプトには対象リストと文脈だけを渡す。

## 対象ディレクトリの特定

`${CLAUDE_PROJECT_DIR}` の絶対パスの英数字以外の文字をすべて `-` に置換したものが `~/.claude/projects/` 配下のディレクトリ名
（例: `/Users/otto/.config/herdr` → `-Users-otto--config-herdr`）。その配下の `memory/` が対象。

スクリプトは `--project-dir <path>` 引数でプロジェクトルートを受け取り、上記規則で memory ディレクトリを導出する。
導出先が存在しなければ `error=memory_dir_not_found dir=<導出パス>` を出力して終了コード 1 で終了する。

## データフロー

1. SKILL.md がスクリプトを実行し、観点 A の結果と記憶一覧（`memory=` 行）を得る
2. メインは `memory=` 行だけでバッチを組む（この段階で本文は読まない）
   - 個別検証: 記憶 5 件ずつを 1 エージェントに渡し、並列起動（20 件なら 4 並列）
   - 横断検証: 全記憶の `name` / `type` / `description` と `MEMORY.md` の内容を 1 エージェントに渡す
3. 個別検証 ×N と横断検証 ×1 を同時に起動する
4. メインが結果を統合し、報告書を出力して終了

## スクリプト `check-structure.ts` の出力仕様

1 行 1 件の `key=value` 形式（値にスペースを含む場合もクォートしない。行末までを値として扱う）。

- 先頭行: `dir=<memory ディレクトリの絶対パス>`、`count=<記憶ファイル数>`
- 記憶ごと: `memory=<ファイル名> type=<type or ->  name=<name or -> description=<description or ->`
  - 欠落している値は `-` で埋める
  - `description` は行末までを値とする（スペースを含んでよい）
- 問題ごと: `issue=<種別> file=<ファイル名> detail=<補足>`
  - `index_missing`: ファイルはあるが `MEMORY.md` に無い
  - `file_missing`: `MEMORY.md` に索引行があるがファイルが無い（`file` は索引行のリンク先）
  - `frontmatter_missing`: `detail` に欠落フィールド名
  - `frontmatter_unparsable`: フロントマターが無い、または YAML として読めない
  - `type_invalid`: `detail` に実際の値
  - `name_mismatch`: `detail` に `name` の値（`-` / `_` を同一視しても一致しない場合のみ）
  - `prefix_mismatch`: `detail` に `type` の値
  - `extra_key`: `detail` に規定外キー名（`metadata` 配下）
  - `broken_link`: `detail` にリンク先の名前
  - `multi_fact`: `detail` に `h2=<数> lines=<数>`

対象ファイルは `memory/` 直下の `*.md` から `MEMORY.md` を除いたもの。サブディレクトリは走査しない。

`MEMORY.md` の索引行は `[...](<file>.md)` 形式のリンクを持つ行として解釈する。

## エージェント `memory-auditor` の仕様

### 入力（呼び出しプロンプト）

- モード: `individual`（個別検証）または `cross`（横断検証）
- プロジェクトルート、memory ディレクトリの絶対パス
- `individual`: 対象記憶ファイルの絶対パス一覧（最大 5 件）
- `cross`: 全記憶の `name` / `type` / `description` の一覧と `MEMORY.md` のパス

### 判定基準（`individual`）

三値判定。「削除可」は根拠が明示できる場合のみで、曖昧なら必ず「要判断」に倒す。

- **削除可**: 次のいずれかを根拠（`path:line` またはコミットハッシュ、または CLAUDE.md の該当箇所）付きで示せる
  - (a) 記憶が指す対象がコード・git 履歴上で消滅または完了している
  - (b) 同内容がプロジェクトまたはグローバルの `CLAUDE.md` に既に書かれている
- **保持**: 現状のコードと突き合わせて正しく、かつリポジトリから導けない
- **要判断**: 上記以外のすべて。部分的に古い（修正案を添える）、コードでは検証できない、根拠が揃わない、テンプレート不備、分類の誤り

`type` ごとの扱い:

- `user` / `feedback`: ユーザーの嗜好であり、コードでは真偽を検証できない。`CLAUDE.md` に同内容があれば「削除可」、`CLAUDE.md` と矛盾すれば「要判断」、それ以外は「保持」
- `project` / `reference`: コード・git 履歴と照合する。`reference` の URL やパスは存在確認できる範囲で確認する

### 判定基準（`cross`）

「重複 / 包含 / 矛盾」の候補ペアを `description` から挙げ、候補の本文だけを Read して確定する。
確定したペアには根拠と統合案（どちらを残す、どう統合する）を添える。統合はどちらを残すかの判断を伴うため、
すべて「要判断」として報告する。

### 出力（日本語、固定構造）

`individual` は記憶ごとに次の 4 項目:

- `ファイル:` ファイル名
- `判定:` 削除可 / 保持 / 要判断
- `根拠:` 検証した対象（`path:line`、コミット、CLAUDE.md の箇所）と、確認できた事実
- `提案:` 要判断の場合の修正案または確認すべき点。保持なら「なし」

`cross` はペアごとに:

- `ペア:` ファイル名 2 つ
- `種別:` 重複 / 包含 / 矛盾
- `根拠:` 両者の該当箇所
- `統合案:` どちらを残すか、どう統合するか

いずれも該当が無い場合は「なし」を明示する。

## 報告形式（SKILL.md がメインで出力、日本語、リスト形式）

1. サマリ: 総数、削除可・保持・要判断・構造問題の各件数
2. 構造的問題（観点 A）: 種別ごとに対象と修正案
3. 削除可: ファイル名と根拠 1 行
4. 保持: ファイル名のみ
5. 要判断: ファイル名、問題点、根拠、提案。横断検証の結果もここに含める
6. 未執筆リンク: 参考情報として末尾に

## エラー処理

- memory ディレクトリが無い: スクリプトの `error=memory_dir_not_found` を受けて「このプロジェクトに AutoMemory は未作成」と報告して終了
- フロントマターが壊れたファイル: `issue=frontmatter_unparsable` として報告しつつ、エージェントには渡す（本文があれば検証できる）
- エージェントが結果を返さない、または対象の一部が出力に無い: 該当ファイルを「要判断（検証未完了）」として報告
- エージェントが「削除可」と判定したが `根拠:` が空、または `path:line` / コミット / CLAUDE.md 箇所のいずれも含まない: メインが統合時に「要判断」へ格下げする（根拠ゲートはエージェント側とメイン側の二重）

## テスト

- スクリプト: `bun test` による単体テスト。一時ディレクトリに意図的に壊した記憶（未索引・実体の無い索引行・不正 `type`・切れたリンク・規定外キー・複数事実）を置き、期待する `issue=` 行が出ることを確認する
- スキル全体: このプロジェクト（`mgzl-claude-code-plugin`）の実 memory で試走する。受け入れ条件は次の既知の問題が検出されること
  - `project_cbo_review_model_threshold_fp_gap.md` が `index_missing`
  - 新しめの記憶ファイルの `node_type` / `originSessionId` / `modified` が `extra_key`
  - `project_cbo_review_model_threshold_fp_gap.md`（`name: cbo-review-model-threshold-fp-gap`、接頭辞 `project_` が `name` に無い）が `name_mismatch`
  - `project_fading_memory_plugin.md` の「実セッションでの動作確認が未完了」が現状と合わないとして「要判断」以上に上がる

## SKILL.md のフロントマター

- `name: audit-memory`
- `description`: 説明文の末尾にトリガーフレーズ「記憶を棚卸しして」「AutoMemory を棚卸し」「メモリを棚卸し」「memory を監査して」
- スクリプト参照は `${CLAUDE_SKILL_DIR}/scripts/check-structure.ts`

## 将来の拡張（本設計では実装しない）

- 「削除可」の自動削除（`trash` 経由・`MEMORY.md` の該当行除去）。運用で判定精度が信頼できると分かってから追加する
- プロジェクト横断の検査と、普遍的な `feedback` のグローバル CLAUDE.md への昇格提案
- sonnet の誤検出が目立つ場合の `model: opus` への切替（エージェント定義 1 行の変更）
