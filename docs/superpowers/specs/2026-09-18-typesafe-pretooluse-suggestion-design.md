# typesafe プラグイン: 行為直前（PreToolUse）のスキル提案 設計書

作成日: 2026-09-18
前提となる設計書: `2026-09-18-typesafe-skill-routing-design.md`（UserPromptSubmit による提案の設計。本書はその拡張）

## 1. 目的

現行の typesafe は `UserPromptSubmit` でのみ発火し、ユーザーが送信したプロンプト文だけを材料にスキルを提案する。しかし、スキルの支援が本当に要るのは作業の途中である。「バグを直して」と依頼された後、調査が進んでコミットが必要になった瞬間や、テストを走らせる直前には、プロンプト時点の提案は届いていない。

本設計では、Claude が **行為を取る直前** に判定を走らせ、その行為を手順化したスキルがあれば提案する。プロンプト時点の提案（進め方を決めるスキル向け）は残し、役割を分担する。

## 2. スコープ

含む:

- `PreToolUse`（matcher `Bash|Agent`）での提案
- ツール向けの判定枠組み（framing）の追加
- サブエージェント内で発火した場合の、Skill ツール保有の推定
- ログへの `event` / `tool_name` の追加
- eval へのツール向けケースの追加

含まない:

- `Edit` / `Write` / MCP ツールへの拡大（発火頻度と遅延が数倍になるため、まず Bash/Agent で運用して判断する）
- 同一セッション内での重複提案の抑制（状態ファイルが増える。ログで重複率を見てから判断する）
- transcript の読み取り（行フォーマットが非公開で非同期書き込みのため現在ターンが欠けうる）
- 提案の自動実行やツール呼び出しのブロック（提案は「合わなければ無視」に留める、前提設計書と同じ）

## 3. 発火イベントと対象ツール

`hooks/hooks.json` に `PreToolUse` エントリを追加する。既存の `UserPromptSubmit` エントリはそのまま残す。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts\"", "timeout": 10 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash|Agent", "hooks": [ { "type": "command", "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts\"", "timeout": 10 } ] }
    ]
  }
}
```

- matcher `Bash|Agent` は英数字と `|` のみなので完全一致の複数指定として評価される
- 対象を Bash と Agent に絞る理由: git 操作・テスト実行・gh 操作・サブエージェント起動は「スキルが手順を持っていそうな行為」であり、実装中でもターンあたり数回に収まる。Edit/Write は実装中に連発するため対象外
- `PreToolUse` の command hook はタイムアウトしてもツール呼び出しをブロックしない（公式仕様）。提案の遅延が作業を止めることはない
- 同じスクリプトを両イベントで使い、stdin の `hook_event_name` で分岐する。新規スクリプトは作らない

## 4. 入口 `suggest-skill.ts` の分岐

stdin の JSON から `hook_event_name` を読み、以下に分岐する。

### 共通の前段

- `TYPESAFE_API_KEY` 未設定なら何もしない（記録も残さない）。既存どおり
- stdin が JSON として不正なら error ログのみ。既存どおり

### `UserPromptSubmit`

既存の挙動を変えない。request は `prompt`、framing は `PROMPT_FRAMING`、提案なしでも「該当なし」を注入する。

### `PreToolUse`

1. `agent_id` が存在する（サブエージェント内で発火した）場合、6 章の推定で Skill ツールを持つと判断できなければ `skipped` を記録して終了
2. `tool_name` と `tool_input` から request 文を組み立てる（5 章）
3. `suggest(request, roster, options, TOOL_FRAMING)` を呼ぶ
4. outcome が `suggested` のときだけ `additionalContext` を出す。`gate_quiet` / `no_fit` では **何も出さない**。Bash のたびに「該当なし」が注入されるのはノイズになるため
5. ログに記録する（8 章）

注入文:

```
<skill_relevance>Relevant to the action you are about to take: <winner>. If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.</skill_relevance>
```

`hookSpecificOutput.hookEventName` は `"PreToolUse"` にする。

## 5. request 文の組み立て

Jev に渡す `state.request` は次の形にする。冒頭の一文で「ユーザーの依頼」ではなく「これから取る行為」であることを Jev に伝える。

```
The assistant is about to perform this action:
<description>
<body>
```

- `Bash`: `<description>` は `tool_input.description`、`<body>` は `tool_input.command`
- `Agent`: `<description>` は `tool_input.description`、`<body>` は `tool_input.prompt`
- `<body>` は `TOOL_INPUT_CHARS = 2000` 文字で切り詰める。Agent の prompt は長くなりうるため
- `description` が無い場合は `<description>` 行を省く。`command` / `prompt` も無い場合は request が組み立てられないので `skipped`
- `state.recent_context` は空のまま（transcript は読まない）

## 6. サブエージェント内での Skill ツール保有の推定

hook の stdin にはサブエージェントのツール一覧は渡されない。`agent_type` から定義ファイルを引いて推定する。

判定順:

1. `agent_type === "general-purpose"` → Skill あり（`tools: *` 相当であることが実証済み）
2. `agent_type` に対応する定義ファイルが見つかる → フロントマターの `tools:` を読む
   - `tools:` が無い → Skill あり（全ツール）
   - `tools:` に `Skill` が含まれる → Skill あり
   - それ以外 → Skill なし（`tools:` の許可リストは列挙外のツールを完全に剥奪することが実証済み）
3. それ以外（`Explore` / `Plan` / `claude-code-guide` 等の組み込み、定義が見つからないもの） → Skill なし

定義ファイルの探索先は、roster.ts がスキルを集めるのと同じ 3 系統:

- 有効プラグインの `installPath/agents/*.md`
- `~/.claude/agents/*.md`
- `<cwd>/.claude/agents/*.md`

`agent_type` の表記（プラグイン接頭辞 `mgzl:` が付くかどうか）は公式文書に記載が無い。実装前に実際の PreToolUse hook 入力を採取して確認し、その表記に合わせて解決ロジックを書く。

この推定は `roster.ts` に `agentHasSkillTool(agentType, cwd): boolean` として追加する。プラグイン解決の既存関数を再利用し、新規ファイルは作らない。

## 7. パイプラインの framing

`pipeline.ts` の `suggest()` に第 4 引数 `framing` を追加する。既定値は `PROMPT_FRAMING` とし、既存の呼び出し元（hook の UserPromptSubmit 側と eval）は無変更で動く。

```ts
type Framing = {
  wide: string;                // Call 1 の choice 質問文
  rerank: string;              // Call 2 の choice 質問文
  fits: (name: string) => string; // Call 2 の候補ごとの noul 質問文
  gates: readonly { key: string; instructions: string; invert: boolean }[];
};
```

### `PROMPT_FRAMING`

既存の `WIDE_INSTRUCTIONS` / `RERANK_INSTRUCTIONS` / gate 3 問 / fits をそのまま移す。挙動は変えない。

### `TOOL_FRAMING`

- `wide`: "The assistant is about to take the action described in the request. Which of these skills, if any, documents a procedure that should be followed for this action instead of doing it ad hoc?"
- `rerank`: "Exactly one of these skills documents the procedure for the action the assistant is about to take. Which one? Read what each actually does, not just its name."
- `fits`: "Does this skill actually cover the action the assistant is about to take, rather than a merely similar topic?"
- `gates`: 1 問のみ
  - key `gate::routine_step`、instructions "Is this action a routine inspection step, such as listing, reading, or checking state, that any careful assistant would do without consulting a documented procedure?"、`invert: true`

既存の gate 3 問（ファイル操作か・手順書を引くか・文章で足りるか）は Bash 実行直前には自明に「はい・はい・いいえ」となり判別力が無いため使わない。

gate の平均と閾値 `GATE_THRESHOLD = 0.3` の扱いは既存と同じ。1 問なので平均はその値そのもの。`GateScores` は key を固定した型から `Record<string, number>` + `mean` に変える（ログと eval の集計は `mean` だけを見ているので影響は無い。既存の 3 key を参照しているテストは書き換える）。

## 8. ログ

`log.ts` のレコードに以下を追加する。

- `event`: `"UserPromptSubmit" | "PreToolUse"`
- `tool_name`: PreToolUse のときのみ。`"Bash" | "Agent"`
- `agent_type`: サブエージェント内で発火したときのみ

`prompt` フィールドには組み立て後の request 文を入れる。`outcome` の値は既存と同じ 5 種で、サブエージェント内で Skill なしと判定した場合は `skipped`。

既存のレコードには `event` が無いので、集計側で `event` 欠落は `UserPromptSubmit` とみなす。

## 9. 評価 `eval/`

### `golden.json`

ツール向けケースを追加する。既存の `request` / `expected` に加え、ツール向けケースは `tool_name` と `tool_input` を持つ。

```json
{ "tool_name": "Bash", "tool_input": { "description": "Commit the staged changes", "command": "git commit -m \"fix: ...\"" }, "expected": "mgzl:commiting-to-git" }
{ "tool_name": "Bash", "tool_input": { "description": "List files in the hooks directory", "command": "ls typesafe/hooks" }, "expected": null }
```

10 件程度。該当ありは git commit / テスト実行 / gh issue 作成 / サブエージェント起動など、該当なしは ls / cat / grep / git status など「定型の確認作業」を中心にする。該当なしには roster に無い対象の名指し（前提設計書と同じ方針）も含める。

### `run.ts`

ケースに `tool_name` があれば 5 章と同じ関数で request を組み立て `TOOL_FRAMING` で `suggest()` を呼ぶ。無ければ既存どおり。request 組み立て関数は hook と eval で共有するため `hooks/lib/` に置く（`request.ts`、新規 1 ファイル。`suggest-skill.ts` からも `run.ts` からも import する）。

レポートは既存の項目に `event` 別の内訳を加える。閾値調整は既存の運用どおり、レポートを見ながら 1 つずつ変えて反復する。

## 10. テスト

- `suggest-skill.test.ts`
  - PreToolUse の stdin（Bash / Agent）で request が 5 章の形になる
  - `agent_id` あり: general-purpose / `tools:` に Skill あり / `tools:` に Skill なし / 定義なし の 4 分岐
  - outcome が `gate_quiet` / `no_fit` のとき stdout に何も出ない
  - `hookEventName` が `PreToolUse` になる
  - `command` / `prompt` が無いとき `skipped`
- `pipeline.test.ts`
  - `TOOL_FRAMING` で Call 1 の質問が `which` + gate 1 問になる
  - `invert: true` の gate が反転されて mean に入る
  - framing 省略時は既存の質問が送られる（後方互換）
- `roster.test.ts`
  - `agentHasSkillTool` の 4 分岐と、3 系統の探索先
- `run.test.ts`
  - `tool_name` 付きケースがツール向け request と framing で評価される
- `request.test.ts`（新規）
  - Bash / Agent の組み立て、`TOOL_INPUT_CHARS` での切り詰め、description 欠落時の省略

## 11. フェイルオープンと性能

- 既存と同じ。API エラー・タイムアウト・stdin 不正・定義ファイル解決の失敗のいずれも stdout に何も出さず exit 0
- 例外時のエラーログには `event` / `tool_name` も残す
- 1 回の発火あたりの API 呼び出しは最大 2 回、見込み 1 秒未満（既存と同じ）。Bash/Agent の発火はターンあたり数回なので、ターン全体の追加遅延は数秒以内
- サブエージェント内の発火は Skill なしと判定した場合 API を呼ばずに終わるので、定義ファイルの読み取りコストだけ

## 12. 既知の制約

- 同じ提案がセッション内で繰り返される（git status → diff → add → commit で 4 回など）。文面は「合わなければ無視」なので害は注入文字数だけ。ログの重複率を見て抑制の要否を判断する
- `agent_type` の表記が Claude Code の内部仕様で変わると推定が外れ、サブエージェント内で一律 `skipped` になる。フェイルオープンなので作業は止まらないが提案は消える
- 組み込みエージェントのうち Skill あり扱いは `general-purpose` のみ。Explore / Plan 等の内部では提案されない
- Bash の `description` は Claude が書く任意の文で、省略されることがある。その場合は `command` だけが材料になり精度が落ちる
- ツール向けの閾値は eval のツール向けケースで調整するが、ケースは手書きで件数が少ない。運用ログを見て追加する

## 13. README に書くこと

- 発火点が 2 つあること（プロンプト送信時 / Bash・Agent の直前）と、それぞれの役割
- PreToolUse では「該当なし」を注入しないこと
- サブエージェント内での Skill ツール保有の推定ルール（6 章）と、`general-purpose` 以外の組み込みでは提案されないこと
- `tool_input`（コマンド文字列や Agent の prompt）が TypeSafe API へ送られること。機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を未設定にして無効化する、という既存の注意に追記
- golden.json のツール向けケースの書き方
