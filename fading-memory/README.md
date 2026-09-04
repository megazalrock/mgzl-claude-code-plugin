# fading-memory

セッションから自動で記憶を抽出し、参照されなければ朽ちていく memory 機能を提供するプラグイン。

- 設計書: `docs/superpowers/specs/2026-08-26-fading-memory-design.md`
- データ配置: `~/.claude/fading-memory/<プロジェクトスラッグ>/`（環境変数 `FADING_MEMORY_DIR` で変更可能）
- SessionStart: 期限切れ削除 → 目次生成 → コンテキスト注入
- SessionEnd: 軽量モデルで記憶抽出 + 役立ち判定（バックグラウンド）
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
