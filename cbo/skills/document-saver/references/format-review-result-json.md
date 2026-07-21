# レビュー結果 正本 JSON スキーマ

review:diff / review:file / review:open が出力するレビュー報告書の正本フォーマット。
document-saver スキルは経由せず、各スキルが Write ツールで !`echo $MGZL_DIR`/reviews/ に直接保存する。

- ファイル名: `yyyyMMdd-hhmmss-<内容を表す英語ケバブケース>.json`
- タイムスタンプ取得: `bun run "${CLAUDE_PLUGIN_ROOT}/skills/document-saver/scripts/get-timestamp.ts"`

## スキーマ

```jsonc
{
  "reporter": "ClaudeCode review:diff",  // 実行主体。review:file は "ClaudeCode review:file"、review:open の変換は元 md の reporter を引き継ぐ
  "model": "claude-sonnet-4-6",          // 実行モデル名。不明なら "unknown"
  "base_commit": "abc...def",            // diff 対象のフル 40 桁 SHA-1。review:file 由来は null
  "head_commit": "abc...def",            // レビュー時 HEAD のフル 40 桁 SHA-1。review:file 由来は null
  "created_at": "2026-07-17T09:30:00+09:00",
  "target": null,                        // 任意: --target の絞り込み指定など。無ければ null
  "good_points": ["..."],                // 良い点。無ければ []
  "findings": [
    {
      "id": "R000",                      // R + 3桁ゼロパディング連番。出現順に R000, R001, ...
      "severity": 5,                     // 5=必須修正(ブロッカー) 4=強く推奨 3=推奨 2=軽微 1=情報
      "file": "src/foo.ts",              // リポジトリルートからの相対パス。ファイルを特定できない指摘は null
      "anchor": { "side": "new", "line": 42 },
      // side: "new"=追加後の行 / "old"=削除行のみに関する指摘
      // 範囲指摘は "line": { "start": 36, "end": 39 }
      // 単一行に紐づかない指摘（ファイル全体への指摘）は anchor 自体を null
      "problem": "問題の説明",
      "reason": "なぜ問題なのか、どの原則に反するか",
      "reporter": "@reviewer-for-logic", // 担当サブエージェント名
      "proposals": [
        { "label": null, "code": "改善後のコード例 もしくは 自然言語での修正案" }
        // 複数案があるときは label に "案A" / "案B" を設定し要素を分ける
      ],
      "evaluation": { "value": null, "directive": null }
      // value: "tp"(妥当) | "fp"(誤検知) | "nit"(些細) | "oos"(スコープ外) | null(未評価)
      // directive: 人間からの追加指示（従来の 対応： 欄）。無ければ null
    }
  ],
  "references": ["..."]                  // 任意: 参考情報。無ければ []
}
```

## 編集規則

- 正本 JSON は原則イミュータブル。例外として、エージェント（review:fix）は difit から取得した人間の評価を **`evaluation` フィールドにのみ** 書き戻してよい
- 人間が `evaluation` を直接編集することも有効（difit を使わない場合の副経路）

## 人間の評価記入（difit スレッドへの返信）

各指摘は difit 上で 1 スレッドとして表示される（body 先頭に `R000` 形式の ID）。
評価はスレッドへの**返信**で記入する:

- 先頭トークンが `tp` / `fp` / `nit` / `oos` → `evaluation.value` として解釈される
- `対応：` 以降のテキスト → `evaluation.directive` として解釈される（例: `tp 対応：案A`）
- 評価値の無い返信 → 全文が directive として解釈される

## sidecar ファイル（difit セッション情報）

difit 起動時、正本 JSON の隣に `<報告書名（.json を除く）>.difit-session.json` が作成される:

```json
{
  "url": "http://localhost:4966",
  "port": 4966,
  "pid": 12345,
  "log": "/tmp/difit-review-xxxx/launch.log",
  "started_at": "..."
}
```

- セッション状態であり報告書の一部ではない。stale になっていたら（プロセス死亡）再起動で上書きされる
- `log` は difit プロセスの stdout/stderr の書き込み先。difit はブラウザタブが閉じられると全コメント＋リプライを stdout に整形出力して終了するため、`difit-review.ts wait <報告書パス>` がこのログから返信内容を回収する
