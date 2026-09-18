# typesafe プラグイン: Jev によるスキル選択サジェスト 設計書

作成日: 2026-09-18
参考: `docs/typesafe/jev-skill-routing.md`、TypeSafe 公式 Skill suggestion クックブック

## 1. 目的

Claude Code が多数のスキルを抱えると、1 行の説明文だけを根拠に似た名前の別スキルを読み込んだり、不要なターンでスキルを読み込んだりする。
`UserPromptSubmit` フックで TypeSafe の System One モデル Jev に 2 リクエストを投げ、「このターンに関係するスキル 1 件」または「該当なし」を `additionalContext` として 1 ブロック注入する。
運用実験が目的なので、提案の当たり外れを後から測れるように提案ログと評価スクリプトを同梱する。

## 2. スコープ

- 対象はスキル（SKILL.md）のみ。サブエージェント・MCP ツールは対象外。
- 提案は最大 1 件。エージェントは提案を無視してよい。
- Jev の呼び出しは HTTP を直接叩く（`fetch`）。公式 JS SDK は使わない。
- 候補スキル一覧（以下 roster）はフック実行時に毎回ファイルシステムから自動発見する。キャッシュも手動の roster も持たない。

## 3. ディレクトリ構成

```
typesafe/
  .claude-plugin/plugin.json
  hooks/
    hooks.json
    suggest-skill.ts          # 入口
    suggest-skill.test.ts     # 起動テスト（キー未設定で無出力・exit 0）
    lib/
      roster.ts               # スキル発見
      roster.test.ts
      jev.ts                  # HTTP クライアント
      jev.test.ts
      pipeline.ts             # 2 コールの組み立てと閾値判定
      pipeline.test.ts
      log.ts                  # suggestions.jsonl への追記
  eval/
    golden.json
    run.ts
  README.md
```

`.claude-plugin/marketplace.json` の `plugins` 配列に `{ "name": "typesafe", "source": "./typesafe", "description": "..." }` を追記する。
`plugin.json` は既存プラグインと同じ `{ name, description, author: { name: "otto" } }` の形式で、`version` は持たない。
`package.json` / `bun.lock` は作らない（依存パッケージなし。ルートの `@types/bun` に相乗り）。

## 4. hooks.json

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## 5. 入口 `suggest-skill.ts`

1. stdin を `JSON.parse` し `prompt` / `cwd` / `session_id` を取り出す。
2. 次のいずれかなら何も出力せず終了（`skipped`）: `prompt` が空、`prompt` が `/` で始まる（明示的なスキル呼び出し）、`TYPESAFE_API_KEY` 未設定。
3. `roster.discover(cwd)` で roster を作る。0 件なら `skipped`。
4. `pipeline.suggest(prompt, roster)` を実行し、結果を `additionalContext` に整形して stdout に出力する。
5. 結果を `log.append` で記録する。
6. 全体を `try { await main() } catch (e) { stderr に 1 行 } process.exit(0)` で囲む。例外時は stdout に何も出さない。

出力形式:

```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<skill_relevance>...</skill_relevance>" } }
```

`additionalContext` の文面:

- 提案あり:
  `<skill_relevance>Relevant to the current request: <name>. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>`
- 提案なし（gate または fits が閾値未満）:
  `<skill_relevance>No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.</skill_relevance>`
- `skipped` / `error`: 出力なし。

## 6. roster の発見 `roster.ts`

### 入力

- `cwd`（フック stdin の値）
- `HOME`

### 有効プラグインの決定

`enabledPlugins` を次の順で読み、後勝ちでマージする（`false` は無効化）。ファイルが無ければ読み飛ばす。

1. `~/.claude/settings.json`
2. `<cwd>/.claude/settings.json`
3. `<cwd>/.claude/settings.local.json`

有効なキー `<plugin>@<marketplace>` ごとに `~/.claude/plugins/installed_plugins.json` の `plugins[key]` 配列を引き、`scope === "user"` または `projectPath === cwd` のエントリの `installPath` を採用する。複数該当する場合は配列の先頭を使う。該当が無ければそのプラグインは読み飛ばす。

### スキルファイルの収集

- 各 `installPath/skills/*/SKILL.md` → 名前は `<plugin>:<name>`（`name` はフロントマターの `name`、無ければディレクトリ名）
- `~/.claude/skills/*/SKILL.md` と `<cwd>/.claude/skills/*/SKILL.md` → 名前はフロントマターの `name`、無ければディレクトリ名（プレフィックスなし）
- シンボリックリンクは辿る。読めないファイルは読み飛ばす。
- フロントマター `disable-model-invocation: true` のスキルは除外する（モデルが呼べないため）。
- フロントマターに `description` が無いものは除外する。

### エントリの形

```ts
type RosterEntry = {
  name: string;         // "cbo:review__diff" など
  description: string;  // フロントマターの description 全文
  body: string;         // フロントマター以降の本文の先頭 1600 文字
  path: string;         // SKILL.md の絶対パス（ログ・デバッグ用）
};
```

同名エントリが複数ある場合は先に見つかったものを残す。件数が 255 を超える場合はエラーとせず先頭 255 件で打ち切り、stderr に警告を出す（現状は数十件で、チャンク分割は必要になってから実装する）。

## 7. Jev クライアント `jev.ts`

- エンドポイント: `POST ${TYPESAFE_BASE_URL ?? "https://api.typesafe.ai"}/v1/systemone`
- ヘッダ: `Authorization: Bearer ${TYPESAFE_API_KEY}`、`Content-Type: application/json`
- ボディ: `{ model, state, questions }`。`model` は `TYPESAFE_SKILL_MODEL ?? "jev-latest"`
- タイムアウト: `AbortSignal.timeout(3000)`（1 コールあたり）
- リトライしない。非 2xx は例外にする。
- `fetch` 関数は引数で差し替え可能にし、テストでは偽の `fetch` を渡す。

質問とレスポンスの型（自前定義）:

```ts
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
type NoulQuestion = { type: "noul"; instructions: string };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { type: "noul"; noul: number };
type SystemOneResponse = { model: string; answers: Record<string, ChoiceAnswer | NoulAnswer>; usage?: unknown };
```

## 8. パイプライン `pipeline.ts`

定数（クックブック初期値。自分の roster で評価して調整する）:

- `SHORTLIST = 3`
- `EXCERPT_CHARS = 700`
- `GATE_THRESHOLD = 0.30`
- `FITS_THRESHOLD = 0.30`

state は両コールとも `{ request: prompt, recent_context: "" }`。

### Call 1（全件を浅く読む）

- `which`: Choice。instructions は
  `Which of these skills, if any, is the right one to load to help with the user's latest request?`
  criteria は `{ [entry.name]: entry.description }`。
- `gate::acts_on_user_system`: Noul
  `Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?`
- `gate::would_follow_documented_procedure`: Noul
  `Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?`
- `gate::prose_suffices`: Noul
  `Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?`
  （集計時に `1 - noul` に反転する）

`gate = mean(acts_on_user_system, would_follow_documented_procedure, 1 - prose_suffices)`。
`gate < GATE_THRESHOLD` なら結果 `gate_quiet` で終了（Call 2 を呼ばない）。
`which.probabilities` を降順に並べ上位 `SHORTLIST` 件をショートリストにする。

### Call 2（ショートリストを深く読む）

- `which`: Choice。instructions は
  `Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.`
  criteria は `{ [name]: `${description} — ${body.slice(0, EXCERPT_CHARS)}` }`。
- `fits::<name>`: 候補ごとに Noul
  `Does the skill '<name>' do the specific thing the user's request asks for? It is described as: <description>`

`max(fits) < FITS_THRESHOLD` なら結果 `no_fit`。そうでなければ Call 2 の `which.choice` を勝者として結果 `suggested`。

### 結果の型

```ts
type Outcome = "suggested" | "gate_quiet" | "no_fit";
type SuggestResult = {
  outcome: Outcome;
  winner: string | null;
  gate: { acts_on_user_system: number; would_follow_documented_procedure: number; prose_suffices: number; mean: number };
  shortlist: Array<{ name: string; wideProbability: number; rerankProbability?: number; fits?: number }>;
  rerankConfidence?: number;
  elapsedMs: number;
};
```

## 9. 提案ログ `log.ts`

- 出力先: `${CLAUDE_PLUGIN_DATA}/suggestions.jsonl`。`CLAUDE_PLUGIN_DATA` 未設定なら何もしない。ディレクトリが無ければ作る。
- 1 行 1 JSON。フィールド: `ts`（ISO 8601）、`session_id`、`cwd`、`prompt`（全文）、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`rerankConfidence`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみメッセージ）。
- 書き込み失敗は握りつぶす（フックの成否に影響させない）。

## 10. 評価 `eval/`

### `golden.json`

```json
[
  { "request": "この差分をレビューして", "expected": "cbo:review__diff" },
  { "request": "モナドとは何ですか", "expected": null }
]
```

初回は手書きで 30 件程度（該当あり 20、該当なし 10）。該当なしには「日常的な依頼」「技術的だがスキル不要な質問」「roster に無い対象の名指し」を必ず含める。`suggestions.jsonl` の `prompt` をそのまま `request` に転記できる。

### `run.ts`

```
bun run typesafe/eval/run.ts --cwd <project> [--golden <path>] [--concurrency 4]
```

- `roster.discover(cwd)` と `pipeline.suggest` をフックと同じコードで実行する。
- 出力（key=value の簡素形式）:
  - `total`, `with_skill`, `without_skill`
  - `wrong_suggestion_rate`: 該当ありのうち `winner !== expected` の割合（`winner === null` も誤り）
  - `unneeded_suggestion_rate`: 該当なしのうち `winner !== null` の割合
  - 確率帯（勝者の `fits` を 0.1 刻み）ごとの件数と正解率
  - 不一致ケースの一覧（request 先頭 60 文字、expected、winner、gate.mean、max fits）
- 帯ごとに正解率が変わらなければ閾値運用は成立しないと判断し、その旨を README に記す。

## 11. テスト

`bun test --cwd typesafe` で実行する。

- `roster.test.ts`: 一時ディレクトリに `settings.json` / `installed_plugins.json` / `skills/*/SKILL.md` を作り、`HOME` と `cwd` を差し替えて発見結果を検証する。`enabledPlugins` の後勝ち、`projectPath` 一致、`disable-model-invocation` 除外、`description` 欠落の除外、255 件打ち切りを含む。
- `jev.test.ts`: 偽 `fetch` でリクエストのヘッダ・ボディを検証。非 2xx とタイムアウトが例外になることを確認。
- `pipeline.test.ts`: 偽 `fetch` に Call 1 / Call 2 の応答を順に返させ、`gate_quiet` / `no_fit` / `suggested` の 3 経路と、`gate_quiet` のとき Call 2 が呼ばれないことを検証。
- `suggest-skill.test.ts`: `Bun.spawn` でフックを起動し、`TYPESAFE_API_KEY` 未設定・`/` 始まり・空 prompt のそれぞれで stdout が空かつ exit 0 を確認。

## 12. フェイルオープンと性能

- キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで、stdout に何も出さず exit 0。
- 1 コール 3 秒、2 コール合計で最悪 6 秒。hooks.json の timeout 10 秒はその外側の保険。
- 通常時の見込みは bun 起動 + 数十ファイルの読み込み + 2 コール（各 0.1〜0.3 秒）で 1 秒未満。

## 13. 既知の制約

- ディスクに無い組み込みスキル（code-review、simplify 等）はroster に入らない。
- `enabledPlugins` と `installed_plugins.json` の解決は Claude Code の内部仕様の再現であり、仕様変更で発見漏れが起きうる。
- 依頼文はターンごとに TypeSafe の API に送信される。機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を設定しないことで無効化できる。
- Jev は指示を字義通りに読み、state 内の敵対的な文に引きずられうる。提案は「無視してよい」文面に留め、自動実行には使わない。

## 14. README に書くこと

- 何をするフックか、注入される文面の例
- 必要な環境変数（`TYPESAFE_API_KEY` 必須、`TYPESAFE_BASE_URL` / `TYPESAFE_SKILL_MODEL` 任意）
- roster の発見ルールと既知の制約
- ログの場所と形式
- 評価スクリプトの使い方と、閾値を調整する手順
- テストの実行方法
