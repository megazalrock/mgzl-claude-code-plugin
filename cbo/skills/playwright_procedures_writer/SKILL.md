---
name: playwright:writer
description: Playwright操作手順書の新規作成・更新を行うスキル。手順書の新規作成や、既存手順書のセレクタ・ステップの更新が必要な場合に呼び出される。
argument-hint: [procedure file path and changes to make]
allowed-tools: Write, Edit, Read, Glob, Grep
---

## コンテキスト
- 操作内容: $ARGUMENTS
- 手順書ディレクトリ: !`echo ${MGZL_DIR:-.mgzl}`/playwright_procedures/
- フォーマットファイル: `./formats/procedures_format.md`

## タスク

Playwright操作手順書の新規作成・更新を行います。

### 新規作成ワークフロー

1. フォーマットファイル（`./formats/procedures_format.md`）を読み込む
2. 操作内容に基づき、フォーマットに従って手順書を作成する
3. 手順書ディレクトリ（!`echo ${MGZL_DIR:-.mgzl}`/playwright_procedures/）に保存する
4. 作成した手順書の内容をユーザーに要約して報告する

### 更新ワークフロー

1. 対象の手順書を読み込む
2. 差分に基づき手順書を更新する（→ 更新手順）
3. 更新した手順書を保存する

### 更新判断基準

| ケース | 判定条件 | 更新対象 |
|--------|---------|---------|
| セレクタ不一致 | スクリプト/セレクタでの操作が失敗し、`mcp__playwright__browser_snapshot` で別セレクタを使って成功した | Step のセレクタ + Playwright スクリプト |
| ステップ追加 | 手順書にないステップを実行した（例: 新しい確認ダイアログの出現） | Step 追加 + Playwright スクリプト |
| ステップ不要 | 手順書のステップが不要だった（例: UI変更で操作が自動化された） | Step 削除 + Playwright スクリプト |
| 待機条件の変化 | `waitForSelector` のテキストやセレクタが変わった | Playwright スクリプトのみ |
| 操作成功（差異なし） | 手順書どおりに全ステップが成功した | 更新不要 |
| Playwrightスクリプトの改良 | 手順書の実行時間を短縮できる方法がある場合 | Playwright スクリプトのみ |

### 更新手順

1. **Step（操作手順）を先に更新する** — Stepが source of truth
2. **Playwrightスクリプト（Phase）をStepに合わせて更新する** — Stepから導出
3. **input要素マップ等の補助情報も必要に応じて更新する**

### プレースホルダー規約

[formats/procedures_format.md](formats/procedures_format.md) を参照。

## 注意事項

- 手順書のステップには番号を付与しないこと（更新時に番号をずらす手間を避けるため）
- 手順書の各ステップには「必須 : YES/NO」を記載し、必須の操作か否かを明示すること
- 手順書は操作の本質的なステップに絞り、URLのハードコーディングは避けること
- 操作手順（Step）を更新したら、対応するPlaywrightスクリプト（Phase）も必ず更新すること
- スクリプトが動作しない場合は、Stepのセレクタ情報を正（source of truth）として修正すること
