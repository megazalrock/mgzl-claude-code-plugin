# fading-memory

セッションから自動で記憶を抽出し、参照されなければ朽ちていく memory 機能を提供するプラグイン。

- 設計書: `docs/superpowers/specs/2026-08-26-fading-memory-design.md`
- データ配置: `~/.claude/fading-memory/<プロジェクトスラッグ>/`（環境変数 `FADING_MEMORY_DIR` で変更可能）
- SessionStart: 期限切れ削除 → 目次生成 → コンテキスト注入
- SessionEnd: 軽量モデルで記憶抽出 + 役立ち判定（バックグラウンド）
- `~/.claude/fading-memory/<スラッグ>/session-end.log`: 抽出 1 回ごとの統計を追記する JSON Lines

## SessionEnd の抽出フロー

1. `session-end.ts` がトランスクリプトの実在を確認し、`session-end-worker.ts` をデタッチ起動する
2. ワーカーがトランスクリプト（JSONL）を自前で解析し、user / assistant の発話テキストだけを抽出する
   - `tool_use` の入力、`tool_result` の出力、thinking、画像、`system-reminder`、メタエントリは捨てる
   - `config.transcriptMaxBytes`（既定 200KB）を超える場合は新しい側を優先し、古いメッセージから落とす
3. 抽出した本文をプロンプトへ埋め込み、`claude -p`（stdin 経由・`--tools ""` で全ツール禁止）へ渡す
4. 返った構造化出力を検証し、記憶を作成・更新・加点する

子プロセスにトランスクリプトを Read させる方式は、数 MB のファイルでは読み取りだけで 5 分のタイムアウトに達していた（issue #42）。前処理を親側へ移したことで、4.8MB のトランスクリプトでも抽出は十数ミリ秒で終わり、子プロセスはツールなしの 1 往復で完了する。

`session-end.log` には次のような行が 1 回の抽出につき 1 行ずつ追記される。

```json
{"ts":"...","sessionId":"...","transcript_bytes":4846690,"extracted_bytes":202552,"omitted_messages":18,"duration_ms":5459,"exit_code":0,"memories_saved":1}
```
- `/fading-memory:maintain`: 記憶の再構成（手動）

## 保存先の変更

環境変数 `FADING_MEMORY_DIR` を設定すると、記憶データの保存先を変更できる。指定した値がそのままデータのルートになり、プロジェクトスラッグのサブディレクトリは挟まれない。

`.claude/settings.local.json`:

```json
{
  "env": {
    "FADING_MEMORY_DIR": ".claude/fading-memory"
  }
}
```

値の解釈:

- 未設定 / 空文字 / 空白のみ: 従来通り `~/.claude/fading-memory/<プロジェクトスラッグ>/`
- `~` または `~/` 始まり: ホームディレクトリを展開したパス
- 絶対パス: そのまま使用
- 相対パス: プロジェクトルート基準で解決（上記例なら `<プロジェクトルート>/.claude/fading-memory/`）

注意点:

- グローバルの `~/.claude/settings.json` に設定すると全プロジェクトが同一ディレクトリを共有し、記憶が混ざる。プロジェクトごとの `.claude/settings.local.json` で指定することを前提とする
- 保存先をプロジェクト外の非許可パスにすると、Bash サンドボックス下で動くスキルスクリプトの書き込みが EPERM になりうる
