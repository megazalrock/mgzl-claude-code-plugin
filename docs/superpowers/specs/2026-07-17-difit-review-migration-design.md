# 設計: cbo レビュー報告書の difit 移行

- 日付: 2026-07-17
- ステータス: 実装済み（計画: docs/superpowers/plans/2026-07-17-difit-review-migration.md）
- 対象プラグイン: cbo

## 目的

cbo プラグインのレビュー報告書（従来は md ファイル）を、独自スキーマの JSON を正本とする形式に移行し、閲覧・評価記入を difit（diff ビューア）上で行えるようにする。あわせて既存報告書を difit で開くスキルを新設する。

## 背景と前提（difit の検証済み仕様）

実装が依存する difit の挙動。すべて yoshiko-pg/difit の main ブランチのソース・公式スキルで確認済み（2026-07-17 時点）。

- `--comment '{"type":"thread","filePath":"...","position":{"side":"new|old","line":N|{"start":N,"end":M}},"body":"..."}'` で起動時にコメントを preload できる。CLI 引数渡しのみで、ファイル読み込みオプションは無い
- UI で書かれたコメント・返信はブラウザ localStorage（commit 単位）に保存されつつ、`POST /api/comments` でサーバー側セッションにも同期される
- **`GET /api/comments-json`** が `{version, threads}` の構造化 JSON を返す。各 thread は `id` / `filePath` / `position` / `messages[]`（`author` フィールド付き）を持つ。`author` で preload コメントと人間の返信を区別できる
- **SIGINT（Ctrl+C）時のみ**、CLI が `/api/comments-output` の整形テキスト（`📝 Comments from review session:` ヘッダー、スレッドごとに `filePath:行`、返信は `Reply N (著者名)`）を stdout に出力する。ブラウザタブを閉じても・SIGTERM で kill しても出力されない
- ポートは 4966 起点で、占有時は +1 ずつ自動フォールバック
- 行指定なしのファイル単位コメントは不可（`position` の `line` が必須）
- ファイル全体の表示は `git diff -- /dev/null <file> | difit` で「新規追加」として可能
- コメント本文の markdown / コードブロックのレンダリング可否はドキュメント未記載（実装時に確認）

### 実機検証の結果（npm リリース版 difit@latest、2026-07-17）

- `--comment` preload・`/api/comments-json`・ポート自動フォールバックはリリース版で動作確認済み。起動ログの形式は `Port 4966 is busy, trying 4967...` → `🚀 difit server started on http://localhost:4967`
- `difit comment add '<JSON>' --port <port>` で稼働中サーバーへ返信を投稿できる。`author` は thread / reply とも任意指定可能で、`/api/comments-json` の `messages[].author` に反映される。reply は `filePath` + `position` の一致で対象スレッドを特定する（threadId 指定は不要）
- **stdin diff と `--background` は併用不可**（親プロセスがハングし、サーバーも起動しない）
- **`--background` は不採用**: ソース上は `{port, url, pid}` の JSON を出力する設計だが、実測では親プロセスが JSON を出力せず、子プロセス終了まで制御が戻らない。通常モード + バックグラウンドタスク起動に一本化する
- stdin diff（`git diff -- /dev/null <file>` のパイプ）+ 通常モード + `--comment` は動作確認済み

## 決定事項

1. **正本は独自スキーマの JSON**。`$MGZL_DIR/reviews/` に保存する。difit の `--comment` 形式は保存形式にせず、オープン時に正本 JSON から導出する
2. **人間の評価・指示の経路は difit UI の返信**。エージェントは稼働中サーバーの `/api/comments-json` から構造化取得する（コピペ不要）。副経路として正本 JSON の `evaluation` 直接編集も許容
3. **difit 化の対象は `review:diff` と `review:file`**。`review:plan` は md のまま変更しない
4. **既存 md 報告書は「推測オープン + `--save`」の折衷案**。開くたびに本文からアンカーを推測し、`--save` 指定時のみ推測結果を新 JSON として保存する

## 正本 JSON スキーマ

ファイル名: `yyyyMMdd-hhmmss-<document-name>.json`（従来の md と同じ命名規則、拡張子のみ変更）

保存方法: document-saver スキルは md 専用のまま変更せず、review:diff / review:file / review:open が正本 JSON を **Write ツールで直接** `$MGZL_DIR/reviews/` に保存する。タイムスタンプは document-saver の `scripts/get-timestamp.ts` を流用する。

```jsonc
{
  "reporter": "ClaudeCode review:diff",   // review:file では "ClaudeCode review:file"
  "model": "<実行モデル名。不明なら unknown>",
  "base_commit": "<フル40桁SHA>",          // review:file では null
  "head_commit": "<フル40桁SHA>",          // review:file では null
  "created_at": "<ISO 8601>",
  "target": null,                          // 任意: --target の絞り込み指定など
  "good_points": ["..."],
  "findings": [
    {
      "id": "R000",                        // R + 3桁ゼロパディング連番（従来同様）
      "severity": 5,                       // 1〜5。従来の [N] に対応
      "file": "src/foo.ts",
      "anchor": { "side": "new", "line": 42 },
      // 範囲指摘は { "side": "new", "line": { "start": 36, "end": 39 } }
      // 単一行に紐づかない指摘は null
      "problem": "...",
      "reason": "...",
      "reporter": "@reviewer-for-logic",
      "proposals": [
        { "label": null, "code": "..." }   // 複数案は label に "案A"/"案B"
      ],
      "evaluation": { "value": null, "directive": null }
      // value: "tp" | "fp" | "nit" | "oos" | null（未評価）
      // directive: 従来の 対応：欄に相当する自由記述。無ければ null
    }
  ],
  "references": ["..."]                    // 任意: 従来の「参考情報」
}
```

### 編集規則の改訂

従来の「報告書ファイルはエージェントが編集しない。`評価：`/`対応：` は人間が記入する唯一の入力経路」を次のように改訂する:

- 人間の評価・指示の主経路は **difit スレッドへの返信**（例: `tp 対応：案A`）
- エージェント（`review:fix`）は取得した評価を正本 JSON の `evaluation` フィールドへ**書き戻してよい**（書き戻し対象は `evaluation` のみ。他フィールドは不変）
- 人間が JSON の `evaluation` を直接編集することも引き続き有効（副経路）

書き戻しにより、tp/fp 統計・knowledge-distiller・アーカイブとしての資産性を維持する。

## difit 起動・評価取得の共通フロー

1. 正本 JSON を保存する
2. 起動・ペイロード導出は共有 TypeScript スクリプト `cbo/scripts/difit-review.ts`（bun 実行）で行う
   - シェルエスケープ問題を避けるため、`--comment` は spawn の引数配列として渡す
   - difit コマンドの解決（`difit` があればそれ、無ければ `npx --yes difit@latest`）もスクリプト内で行う
3. スクリプトは `findings` から `--comment` ペイロードを導出する
   - body 先頭に `R000` 等の ID を必ず埋め込む（返信スレッドとの突合キー）
   - `author` に指摘の `reporter`（担当サブエージェント名）を設定する
   - body には severity・problem・reason・reporter・proposals を整形して含め、末尾に返信書式のヒント（`返信例: tp 対応：案A`）を 1 行付ける
   - `anchor: null` かつ `file` がある指摘 → 当該ファイルの先頭行（`side:"new"`, `line:1`）に付与し、body に「ファイル全体への指摘」と明記する
   - `file` すら特定できない指摘 → difit には載せず、`unanchored=` としてスキル側に返し、ターミナル報告にのみ含める
   - 秘密情報（トークン・鍵など）を body に含めない
4. スクリプトは difit を**通常モード**（`--background` 不使用）でデタッチ起動し、起動ログから `started on http://localhost:<port>` を捕捉する
   - 捕捉した `{url, port, pid, started_at}` を正本 JSON の隣に **sidecar ファイル** `<報告書名>.difit-session.json` として保存する（正本 JSON は不変に保つ）
   - スクリプトは `url=` / `port=` / `pid=` / `session=` / `unanchored=` を key=value 形式で stdout に出力する
5. スキルは url をユーザーに提示する。起動に失敗した場合（`error=` 出力）は正本 JSON のパス提示にフォールバックする

## 各スキルの変更

### review:diff

- Step 9 の統合結果を md フロントマター形式から正本 JSON に変更（`base_commit` / `head_commit` は従来どおり必須）
- レビュアーサブエージェントへの入力指示に「各指摘に `file` と `anchor`（side / line、可能なら範囲）を必ず出力する」を追加
- Step 11（IDE で開くか尋ねる）を廃止し、`difit <head_commit> <base_commit>` を上記共通フローで起動するステップに置換
- Step 10（knowledge-distiller）は `severity >= 3` の判定に読み替え。`source` には正本 JSON をそのまま渡す（プロンプト契約は据え置き）

### review:file

- 統合結果を正本 JSON に変更（`base_commit` / `head_commit` は null）
- 表示は `git diff -- /dev/null <file> | difit --comment ...` でファイル全体を「新規追加」として開く
  - アンカーは `side:"new"`・ファイル全体の行番号
  - stdin diff + 通常モード + `--comment` の併用は実機検証済み（`--background` とは併用不可のため通常モードを使う）
- IDE で開くか尋ねるステップを difit 起動に置換

### review:fix

- 引数解釈: 報告書パスの判定を「`.md` で終わる」から「`.json` または `.md` で終わる」に変更
- 指摘抽出:
  - JSON 報告書 → `findings` からロード（パース不要で堅牢化）
  - md 報告書 → 従来どおりのセクション切り出し（後方互換として維持）
- 評価・指示の取得（JSON 報告書の場合）:
  1. 主経路: sidecar `<報告書名>.difit-session.json` のポートに対し `GET /api/comments-json` → 各スレッドの `messages[0]`（エージェント指摘）より後のメッセージを人間の返信として抽出 → body 先頭の R-ID で findings と突合
  2. 返信本文の解釈: 先頭トークンが `tp` / `fp` / `nit` / `oos` なら `evaluation.value` に採用し、`対応：` 以降のテキストを `evaluation.directive` に採用する。評価値の無い返信は全文を directive として扱う
  3. 副経路: 正本 JSON の `evaluation` フィールドの直接編集（人間が手で記入した場合）も常に有効
  4. difit が落ちている（API 不達）場合は、review:open で再起動して評価を記入し直すか、`evaluation` 直接編集かをユーザーに提示する
- 取得した評価・指示を正本 JSON の `evaluation` に書き戻す
- 絞り込み条件（「3以上」「未評価のみ」「報告者指定」等）は JSON フィールド参照に読み替え。複数案の検出は `proposals` の要素数で判定
- md 報告書に対する従来フロー（`評価：`/`対応：` の見出し行パース）は変更しない

### 新スキル review:open（`cbo/skills/review__open/`）

- 引数: 報告書ファイルパス（`.json` / `.md`）、`--save` フラグ
- JSON 報告書:
  - `base_commit` / `head_commit` があれば `difit <head> <base>` で当時の diff を復元し、`findings` からコメントを正確に復元する
  - SHA が無い（review:file 由来）場合は `/dev/null` diff でファイル全体を開く
  - SHA がリポジトリに存在しない（rebase / GC 後）場合はその旨を報告して中止する
- md 報告書:
  - `### R*` セクションをパースし、`問題`/`提案` 本文から file・行を推測してアンカーを組み立てる（ベストエフォート。誤アンカーの可能性がある旨をユーザーに明示する）
  - フロントマターに `base_commit` / `head_commit` があればその diff に対して、無ければ現在のワークツリーに対して開く
  - `--save` 指定時のみ、推測結果を正本 JSON スキーマで `$MGZL_DIR/reviews/` に保存する（既存 md は移動・削除しない）
- 内部構造: md パース＋アンカー推測の結果は常に正本 JSON と同じ構造で組み立て、オープン処理は JSON 構造だけを見る（コアロジック共通化）

### document-saver

- `references/format-review-result.md` は review:plan 用として存置する
- 正本 JSON のスキーマ定義書を `references/format-review-result-json.md` として新設し、review:diff / review:file / review:open から参照する

### 変更しないもの

- review:plan（md のまま。`format-review-result.md` を引き続き参照）
- knowledge-distiller のプロンプト契約（`source` に JSON テキストを渡すのみ）

## スコープ外

- 既存 md 報告書の一括変換コマンド（`review:open --save` による段階的移行で代替）
- review:plan の JSON 化
- difit コメント本文の markdown レンダリング品質改善（difit 側の仕様。実装時に表示を確認し、コード例の整形方法を調整する）
- difit への PR レビュー機能・GitHub 連携

## リスクと対応

- ~~stdin diff + `--comment` の併用可否が未検証~~ → **実機検証済み**。通常モードでは併用可。`--background` とは併用不可（`--background` 自体を不採用とした）
- **コメント本文がプレーンテキスト表示になる可能性** → ブラウザでの見え方は実装後に確認し、コード例の見せ方（インデント整形等）を調整する
- **`--comment` 引数の肥大化**（指摘数 × コード例）→ 共有スクリプトが spawn の引数配列で渡すためシェルエスケープ問題は回避済み。指摘数が極端に多い場合は body を要約し、詳細は正本 JSON 参照とする
- **difit のバージョン差異** → `/api/comments-json`・`comment add` は npm リリース版（2026-07-17 時点の latest）で動作確認済み。将来の仕様変更に備え、`evaluation` 直接編集の副経路が常に残る
