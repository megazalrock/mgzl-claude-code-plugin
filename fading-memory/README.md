# fading-memory

セッションから自動で記憶を抽出し、参照されなければ朽ちていく memory 機能を提供するプラグイン。

- 設計書: `docs/superpowers/specs/2026-08-26-fading-memory-design.md`
- データ配置: `~/.claude/fading-memory/<プロジェクトスラッグ>/`
- SessionStart: 期限切れ削除 → 目次生成 → コンテキスト注入
- SessionEnd: 軽量モデルで記憶抽出 + 役立ち判定（バックグラウンド）
- `/fading-memory:maintain`: 記憶の再構成（手動）
