---
name: playwright:runner
description: Playwright MCPを利用して手順書に従いブラウザ操作を実行するスキル。「Playwrightで確認して」「手順書を実行して」などブラウザ自動操作が依頼された場合に呼び出される。
argument-hint: [what to do]
allowed-tools: Read, Glob, Grep, mcp__playwright
---

## コンテキスト
- 操作内容: $ARGUMENTS
- 手順書ディレクトリ: !`echo $MGZL_DIR`/playwright_procedures/
- ホスト: !`echo $APP_HOST`
- スクリーンショット保存先: !`echo $MGZL_DIR`/tmp/playwright_ss

## タスク

Playwright MCPを利用してブラウザを操作します。

### ワークフロー

1. Playwright MCPサーバーへの接続を確認する（→ MCP接続確認フロー）
2. ユーザーの操作内容を把握する
3. 手順書ディレクトリから操作内容に適した手順書を検索する
4. **手順書あり**: 手順書に従って操作を実行 → 6へ
5. **手順書なし**: `mcp__playwright__browser_snapshot`で画面構造を把握しながら探索的に操作を実行 → 6へ
6. 操作結果を報告する（手順書の有無、実行した操作手順、成否、手順書との差異を含める）

### MCP接続確認フロー

ワークフロー Step 1 で実行する。Playwright MCPサーバーが利用可能かを最初に確認する。

1. `mcp__playwright__browser_snapshot` を実行してPlaywright MCPサーバーへの接続を確認する
2. **接続成功**: ワークフロー Step 2 へ進む
3. **接続失敗**（ツールが見つからない、タイムアウト等）:
   - ユーザーに「Playwright MCPサーバーに接続できません。MCPサーバーが起動しているか確認してください。」と報告する
   - **処理を中断する**（MCPサーバーなしでは操作を実行できないため）

### 操作の基本フロー

1. `mcp__playwright__browser_navigate` でページに遷移する
   - ベースURLは `http://!`echo $APP_HOST`` を使用する
   - まだブラウザが開いていない場合、URLをユーザーに確認する
2. `mcp__playwright__browser_snapshot` でページ構造を取得し、操作対象を特定する
3. 操作を実行する（`mcp__playwright__browser_click`, `mcp__playwright__browser_fill_form` 等）
4. 操作後に `mcp__playwright__browser_snapshot` で結果を確認する
5. 必要に応じて `mcp__playwright__browser_take_screenshot` で視覚的に確認する

### 高速実行（手順書実行時）

手順書がある場合は、API呼び出し回数を最小限に抑えるため以下のフローで実行する。

#### スクリプトありの場合（Playwrightスクリプトセクションが手順書にある場合）

1. `mcp__playwright__browser_navigate` でページに遷移する
2. プレースホルダーを実際の値に置換し、各Phaseのスクリプトを `mcp__playwright__browser_run_code` で順次実行する
3. 最後に `mcp__playwright__browser_take_screenshot` で結果を確認する（**最終確認のみ**）

> スクリプトありの場合、初回 `mcp__playwright__browser_snapshot` は省略できる。スクリプトにはセレクタ情報が埋め込まれているため、構造確認が不要。

#### スクリプトなしの場合（セレクタ情報のみの場合）

1. `mcp__playwright__browser_navigate` でページに遷移する
2. `mcp__playwright__browser_snapshot` でページ構造を取得し、手順書のセレクタ情報と照合する（**初回のみ**）
3. 手順書の連続する操作を `mcp__playwright__browser_run_code` でまとめて一括実行する
4. 最後に `mcp__playwright__browser_snapshot` または `mcp__playwright__browser_take_screenshot` で結果を確認する（**最終確認のみ**）

#### `mcp__playwright__browser_run_code` でのまとめ方

- 連続するフォーム入力・クリック操作は1つの `mcp__playwright__browser_run_code` にまとめる
- **区切りポイント**: ページ遷移、モーダルの開閉、API通信を伴う操作など状態が大きく変わる箇所で区切る
- `mcp__playwright__browser_run_code` 内で `page.waitForSelector` 等を使い、操作結果を待機する

```javascript
// 例: モーダル内のフォーム入力 → 確定ボタンクリックを1回のAPI呼び出しで実行
async ({ page }) => {
  await page.getByRole('textbox', { name: 'タイトル' }).fill('テスト');
  await page.getByRole('textbox', { name: '開始日' }).fill('2025/01/15');
  await page.getByRole('button', { name: '確定する' }).click();
  await page.waitForSelector('text=作成しました');
}
```

#### プレースホルダー規約

手順書内のプレースホルダーは `{{UPPER_SNAKE_CASE}}` 形式。実行時に実際の値に置換して `mcp__playwright__browser_run_code` に渡す。

#### 注意事項

- 手順書にセレクタ情報がある場合は、`mcp__playwright__browser_snapshot` なしで直接 `mcp__playwright__browser_run_code` に渡してよい
- エラーが発生した場合は、`mcp__playwright__browser_snapshot` で現在の状態を確認し、探索的フローにフォールバックする
- スクリプトが動作しない場合は、Stepのセレクタ情報を正（source of truth）として修正すること

## ツール使い分けの原則

- **操作対象の特定**: 必ず `mcp__playwright__browser_snapshot` を先に実行してから操作する
- **結果の確認**: 操作後は `mcp__playwright__browser_snapshot` で状態変化を確認する
- **スクリーンショット**: ユーザーへの報告時や、視覚的な確認が必要な場合に使用する。保存先は !`echo $MGZL_DIR`/tmp/playwright_ss を指定する
- **スナップショット削減（手順書実行時）**: `mcp__playwright__browser_snapshot` は初回の構造把握と最終確認の2回のみに限定する。中間ステップでは `mcp__playwright__browser_run_code` 内の `page.waitForSelector` 等で結果を確認する
- **一括実行**: 連続する操作は `mcp__playwright__browser_run_code` でまとめ、API呼び出し回数を削減する

### 利用可能なスクリプト

#### ユニークID生成
```
bun "${CLAUDE_SKILL_DIR}/scripts/generate_id.ts"
```

## エラーハンドリング

- **要素が見つからない場合**: `mcp__playwright__browser_snapshot` でページ構造を再確認し、セレクターを調整する
- **ページ遷移の失敗**: URLが正しいか確認し、ログイン状態を確認する
- **操作後に期待した変化がない場合**: `mcp__playwright__browser_wait_for` で待機してから再確認する
