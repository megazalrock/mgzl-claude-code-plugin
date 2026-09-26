# fading-memory

セッションから自動で記憶を抽出し、参照されなければ朽ちていく memory 機能を提供するプラグイン。

- 設計書: `docs/superpowers/specs/2026-08-26-fading-memory-design.md`
- データ配置: `~/.claude/fading-memory/<プロジェクトスラッグ>/`（環境変数 `FADING_MEMORY_DIR` で変更可能）
- SessionStart: trash の掃除 → 目次生成（有効期限内の記憶のみ）→ コンテキスト注入
- 寿命: `expiresAt = (lastReferenced ?? created) + (baseTtlDays[origin] + score × 7日)`。基本 TTL は自動抽出 10 日・remember 20 日で、役立ったと判定されるたびに起点が前進し score が 1 増える。期限を過ぎた記憶は削除されず index.md に載らなくなるだけで、更新または加点で復帰する。`/fading-memory:remember-permanent`（人間が明示的に呼び出したときだけ動くスキル）で作成した記憶は permanent となる。有効期限を持たず index.md から外れず、maintain でも削除されない
- SessionEnd: 軽量モデルで記憶抽出 + 役立ち判定（バックグラウンド）

## remember の重複判定

`/fading-memory:remember`（および `remember-permanent`）は、保存前に `scripts/check-duplicates.ts` で新しい記憶の title が既存記憶の重複かどうかを判定する。環境変数 `TYPESAFE_API_KEY` が設定されていれば TypeSafe System One (Jev) の choice 質問へ「新しい記憶の title」対「既存記憶の title + none」を投げ、`duplicate` / `ambiguous` / `new` の 3 通りと候補 slug を返す。

キーが無い、ネットワークやタイムアウトで失敗した、応答の形が想定外だった場合はスクリプトが `typesafe=unavailable reason=...` を 1 行返して正常終了し、Claude は従来どおり記憶一覧を目視して判断する。判定を止めても保存は止まらない。

判定閾値（none 確率 0.45 以上で新規、0.30 以下かつ confidence 0.55 以上で重複、その間は曖昧）は issue #54 の評価実験 `typesafe/eval/memory-dedup` の実測から導いた値で、`hooks/lib/config.ts` の `config.dedup` に置いてある。この評価実験は typesafe プラグインごと削除されたため、実測の内容を追う場合は git 履歴を参照する。criteria は 1 問 255 件が上限（[choice の仕様](https://docs.typesafe.ai/primitives/choice)）のため、記憶が 254 件を超えたら質問を塊に分け、塊ごとの none 確率の最小値で統合する。
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
{"ts":"...","projectDir":"/path/to/project","sessionId":"...","transcript_bytes":4846690,"extracted_bytes":202552,"omitted_messages":18,"duration_ms":5459,"exit_code":0,"memories_saved":1}
```

`error.log` は `<ISO タイムスタンプ> [<projectDir>] <本文>` の 1 行 1 エントリ。

`FADING_MEMORY_DIR` で複数プロジェクトが同じ保存先を共有している場合、両方のログが同じファイルに混ざる。`projectDir` がそのエントリを書いたセッションの cwd なので、これで発信元を切り分ける。
- `/fading-memory:maintain`: 記憶の再構成（手動）。既定では index.md に載っている記憶だけを検証し、`--all` を付けると退色した記憶も含める

## サンドボックスの設定

Bash のサンドボックスが有効な環境では、次の許可がないとプラグインの一部が動かない。

### 記憶の保存先への書き込み（必須）

保存先が書き込み許可に入っていないと、記憶の作成も trash の掃除も失敗する。`~/.claude/settings.json`:

```json
{
  "sandbox": {
    "filesystem": {
      "allowWrite": ["~/.claude/fading-memory"]
    }
  }
}
```

`FADING_MEMORY_DIR` で保存先を変えた場合は、この値も変更後のパスに合わせる。

### 重複判定の API への接続（任意）

`TYPESAFE_API_KEY` を設定して重複判定を使う場合は、`api.typesafe.ai` への外向き接続を許可する。

```json
{
  "sandbox": {
    "network": {
      "allowedDomains": ["api.typesafe.ai"]
    }
  }
}
```

許可がないと接続が拒否され、`scripts/check-duplicates.ts` は `typesafe=unavailable reason=http-403` を返して正常終了する。判定が止まるだけで保存は止まらないため、重複判定を使わないならこの設定は要らない。

`allowedDomains` はスコープを越えてマージされるので、user 設定とプロジェクト設定のどちらに書いても既存の許可は失われない。

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
