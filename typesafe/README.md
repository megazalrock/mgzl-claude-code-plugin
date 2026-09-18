# typesafe

TypeSafe の System One モデル Jev にスキル選択を問い合わせ、関係するスキル 1 件を提案として注入するプラグインである。発火点は 2 つある。

- `UserPromptSubmit`（ユーザーのプロンプト送信時）: 依頼文を材料に、そのターンの進め方を決めるスキルを提案する
- `PreToolUse`（matcher `Bash|Agent`、ツール呼び出しの直前）: これから取る行為を材料に、その行為を手順化したスキルを提案する

スキルの支援が本当に要るのは作業の途中である。「バグを直して」と依頼された後、調査が進んでコミットが必要になった瞬間にはプロンプト時点の提案は届いていない。`PreToolUse` はその穴を埋める。対象を Bash と Agent に絞るのは、git 操作・テスト実行・gh 操作・サブエージェント起動が「スキルが手順を持っていそうな行為」でありながら、実装中でもターンあたり数回に収まるためである。Edit / Write は実装中に連発するので対象外にしてある。`PreToolUse` の command hook はタイムアウトしてもツール呼び出しをブロックしない。

## 何をするか（UserPromptSubmit）

ユーザーが 1 ターン送るたびに、Jev へ 1 リクエストだけ投げる。中身は Choice 1 問（`which`）で、criteria は roster 全件の description に、`none`「どのスキルも該当せず、スキルを読み込まずに直接対応できる」を 1 件足したものである。

- `choice` が `none` → `outcome: "no_fit"`（提案しない）
- それ以外 → `outcome: "suggested"`、そのスキル名が勝者

「該当なし」を別の質問で測るのではなく、スキルと同じ選択肢の中で競わせる。閾値も足切りの Noul 質問も持たないので、調整すべきつまみが無い。`choice` が `none` でも roster のどの名前でもない場合は例外にする。roster に `none` という名前のスキルがあると選択肢が潰れるため、API を呼ぶ前に例外にする。

結果は `additionalContext` として 1 ブロックだけ注入する。roster 本文には手を加えない。

提案あり:

```
<skill_relevance>Relevant to the current request: mgzl:commiting-to-git. Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.</skill_relevance>
```

提案なし:

```
<skill_relevance>No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.</skill_relevance>
```

提案は「合わなければ無視してよい」文面に留めてある。強く押すと誤った提案にも従ってしまい、誤った提案は提案なしより悪いためである。提案が無いターンでも「該当なし」の 1 文を送る。何も送らないと、スキル一覧側の「迷ったら読み込め」という指示が野放しになる。

## 何をするか（PreToolUse）

Bash または Agent を呼ぶ直前に、これから取る行為を次の形の request 文にして Jev へ渡す。

```
The assistant is about to perform this action:
<tool_input.description>
<Bash は tool_input.command / Agent は tool_input.prompt>
```

本体は 2000 文字（`TOOL_INPUT_CHARS`）で切り詰める。`description` が無ければその行を省く。本体も取れない場合は request を組み立てられないので `skipped` として終わる。

判定の枠組み（framing）はプロンプト向けと別で、`which` の instructions と `none` の説明文が変わる。ツール向けの `none` は「どのスキルもこの行為の手順を記していない。直接実行してよい」である。それ以外の構造（1 リクエスト・Choice 1 問）は共通である。

**`PreToolUse` では「該当なし」を注入しない。** `outcome` が `suggested` のときだけ出力する。Bash を呼ぶたびに「該当なし」の 1 文が入るのはノイズにしかならないためである。

提案あり:

```
<skill_relevance>Relevant to the action you are about to take: mgzl:commiting-to-git. If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.</skill_relevance>
```

### サブエージェント内での発火

hook の stdin にはサブエージェントのツール一覧が渡らない。`agent_id` があり（= サブエージェント内で発火した）、かつ次の推定で Skill ツールを持たないと判断した場合は、API を呼ばずに `skipped` で終える。

1. `agent_type` が `general-purpose` → Skill あり（全ツールを持つことが実証済み）
2. `agent_type` に対応する定義ファイルが見つかる → フロントマターの `tools:` を読む
   - `tools:` が無い、または `tools: *` → Skill あり
   - `tools:` に `Skill` が含まれる → Skill あり
   - それ以外 → Skill なし（`tools:` の許可リストは列挙外のツールを完全に剥奪する）
3. それ以外（`Explore` / `Plan` / `claude-code-guide` 等の組み込み、定義が見つからないもの） → Skill なし

定義ファイルの探索先は roster と同じ 3 系統で、有効プラグインの `installPath/agents/*.md`、`~/.claude/agents/*.md`、`<cwd>/.claude/agents/*.md` である。`<agent_type>.md` を先に見て、無ければディレクトリ内の `*.md` からフロントマターの `name` が一致するものを探す。`agent_type` にプラグイン接頭辞（`mgzl:` など）が付く場合はそのプラグインだけを見る。

**組み込みエージェントのうち Skill あり扱いは `general-purpose` のみ**で、`Explore` / `Plan` などの内部では提案されない。

## 環境変数

- `TYPESAFE_API_KEY`（必須）: 未設定ならフックは何も出力せず終了する。機能を無効化したいときはこれを設定しない。未設定時は System One への送信も行わず、ログにも何も記録しない。`PreToolUse` が有効なときは依頼文だけでなく実行しようとしているコマンド文字列や Agent の prompt も送られるため、機密性の高いプロジェクトではこの変数を設定しないことで両方の発火点をまとめて無効化する
- `TYPESAFE_BASE_URL`（任意、既定 `https://api.typesafe.ai`）
- `TYPESAFE_SKILL_MODEL`（任意、既定 `jev-latest`）
- `CLAUDE_PLUGIN_DATA`（任意）: 提案ログの出力先。未設定ならログを書かない

## roster の発見ルール

候補スキルはフック実行時に毎回ファイルシステムから発見する。キャッシュも手書きの一覧も持たない。

1. `enabledPlugins` を `~/.claude/settings.json` → `<cwd>/.claude/settings.json` → `<cwd>/.claude/settings.local.json` の順に読み、後勝ちでマージする（`false` は無効化）
2. 有効なキー `<plugin>@<marketplace>` ごとに `~/.claude/plugins/installed_plugins.json` の `plugins[key]` を引き、`scope === "user"` または `projectPath === <cwd>` の先頭エントリの `installPath` を採用する
3. `installPath/skills/*/SKILL.md` を `<plugin>:<name>` として、`~/.claude/skills/*/SKILL.md` と `<cwd>/.claude/skills/*/SKILL.md` をプレフィックスなしで集める。`name` はフロントマターの `name`、無ければディレクトリ名
4. フロントマターに `description` が無いもの、`disable-model-invocation: true` のものは除外する
5. 同名は先に見つかったものを残す。255 件を超えたら先頭 255 件で打ち切り、stderr に警告を出す

フロントマターの解析は外部依存なしの簡易パーサで、`---` で囲まれた先頭ブロックを行単位で `key: value` として読む。`name` / `description` / `disable-model-invocation` だけを見る。`description` は YAML のブロックスカラー（`>`, `>-`, `|`, `|-`）にも対応しており、開始行より深くインデントされた後続行を折り畳み（`>`）または改行保持（`|`）で連結する。ネストしたマッピングや、インデント量を明示する指示子（`>2` など）には対応しない。

### 既知の制約

- ディスクに無い組み込みスキル（code-review、simplify 等）は roster に入らない
- `enabledPlugins` と `installed_plugins.json` の解決は Claude Code の内部仕様の再現であり、仕様変更で発見漏れが起きうる
- 依頼文はターンごとに TypeSafe の API に送信される。機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を設定しないことで無効化できる
- Jev は指示を字義通りに読み、state 内の敵対的な文に引きずられうる。提案は「無視してよい」文面に留め、自動実行には使わない
- `tool_input`（Bash のコマンド文字列、Agent の prompt）が TypeSafe の API へ送られる。依頼文だけでなく実行しようとしているコマンドそのものが外に出るため、機密性の高いプロジェクトでは `TYPESAFE_API_KEY` を設定しないことで無効化する
- 同じ提案がセッション内で繰り返される（git status → diff → add → commit で 4 回など）。文面が「合わなければ無視」なので害は注入文字数だけである。重複の抑制はログの重複率を見てから判断する
- `agent_type` の表記が Claude Code の内部仕様で変わると推定が外れ、サブエージェント内で一律 `skipped` になる。フェイルオープンなので作業は止まらないが提案は消える
- Bash の `description` は Claude が書く任意の文で、省略されることがある。その場合は `command` だけが材料になり精度が落ちる
- ツール向けの eval ケースは手書きで件数が少ない。運用ログを見て追加する

## フェイルオープンと性能

キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで、stdout に何も出さず exit 0 で終わる。Jev が `which` に答えなかった場合、`none` でも roster のどの名前でもない候補を選んだ場合、roster に `none` という名前のスキルがあった場合も `pipeline.ts` の `suggest` が例外を投げ、同じ経路でフックは黙って終了する。stdin が壊れた JSON の場合、キーが設定されている場合はログの `outcome` が `error`、`error` フィールドに `"malformed stdin payload"` が記録される（キー未設定なら他のケースと同様に何も記録しない）。API 呼び出しは 1 回で、タイムアウトは 3 秒、`hooks.json` の `timeout` 10 秒はその外側の保険である。通常時は bun 起動 + 数十ファイルの読み込み + 1 コール（0.1〜0.3 秒）で 1 秒未満を見込む。

## ログ

`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions-v3.jsonl` に 1 行 1 JSON で追記する。未設定なら何も書かない。`TYPESAFE_API_KEY` が未設定のときも機能そのものが無効なので、`skipped` を含めて一切記録しない。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`event`（`UserPromptSubmit` / `PreToolUse`）、`tool_name`（`PreToolUse` のときのみ。`Bash` / `Agent`）、`agent_type`（サブエージェント内で発火したときのみ）、`prompt`、`outcome`（`suggested` / `no_fit` / `skipped` / `error`）、`winner`、`noneProbability`、`shortlist`、`calls`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。ログは追記専用でローテーションは無い。

旧い `suggestions.jsonl` / `suggestions-v2.jsonl` はそのまま残すが、もう読みも書きもしない。版ごとにレコードの形が違うので混ぜて集計しない。

`prompt` には `UserPromptSubmit` なら依頼文の全文が、`PreToolUse` なら組み立て後の request 文が入る。`noneProbability` は `which` の probabilities のうち `none` に割り当てられた確率で、API を呼ばなかった `skipped` / `error` では `null` になる。`shortlist` は `none` を除いた確率上位 3 件（`{ name, probability }`）で、判定には使わず分析の材料として残している。

`calls` にはそのターンで実際に投げた System One の往復が入る。1 要素が 1 往復で、`url`、`request`（送信した body そのもの。`model` / `state` / `questions`）、`response`（`{ status, body }`。応答が得られなかった場合は `null`、JSON として読めない本文は `body` に生の文字列）、`error`（失敗した往復のみ。HTTP エラーの文言・fetch の例外・応答の形が想定外だった旨）、`elapsedMs` を持つ。**ヘッダは要求側・応答側とも一切記録しない。** `Authorization` に API キーが載るためである。API を呼ばなかった経路（`skipped`、stdin 不正）では空配列に、それ以外では 1 要素になる。

`prompt` はそのまま `eval/golden.json` の `request` に転記できる。

## ビューワー

```
bun run typesafe/viewer/server.ts [--file <path>] [--port <n>]
```

提案ログをブラウザで眺めるローカルサーバー。起動すると `url=http://127.0.0.1:<port>/` を出すので、それを開く。`--file` の既定は `~/.claude/plugins/data/typesafe-mgzl-marketplace/suggestions-v3.jsonl`、`--port` の既定は 47391。ブラウザは自動で開かない。

左の一覧は新しい順で、`event`（`UserPromptSubmit` / `PreToolUse:Bash` / `PreToolUse:Agent`）と `outcome` の chip で絞り込める。行を選ぶと右に `prompt` の全文と、Jev が返した確率のうち 0 より大きい候補だけを降順に並べたランキングが出る。`none` も同列に載せ、`winner` と一致する行を強調する。`shortlist` はランキングの上位 3 件と同じ情報なので表示しない。

ログは 1 秒間隔の size polling で差分読み取りし、新着は Server-Sent Events で一覧の先頭に流し込む。「最新に追従」が on なら詳細も新着に切り替わる。改行で終わっていない末尾行は書きかけとみなして次回に持ち越す。JSON として読めない行は捨てて件数だけ「捨てた行」に出す。ファイルが無くても起動し、生成されたら読み始める。

`calls[].request.questions.which.criteria` は全スキルの description を毎回含むため 1 行が平均 20KB あるが、ブラウザにはこれを除いた軽い形（`ViewRecord`）だけを渡す。

## 評価

```
bun run typesafe/eval/run.ts --cwd <project> [--golden <path>] [--concurrency 4]
```

フックと同じ `roster.discover` と `pipeline.suggest` を使う。`--concurrency` には数値以外を渡すと例外になる。出力は key=value の簡素形式で、次を出す。

- `total` / `with_skill` / `without_skill` / `errors`（`suggest` が例外を投げたケースの件数）
- `event=<イベント名> total=… with_skill=… without_skill=… errors=… wrong_suggestion_rate=… unneeded_suggestion_rate=…`: 発火イベント別の内訳
- `wrong_suggestion_rate`: 該当ありで例外にならなかったもののうち `winner !== expected` の割合（`winner === null` も誤り）
- `unneeded_suggestion_rate`: 該当なしで例外にならなかったもののうち `winner !== null` の割合
- `band=<下限>-<上限> count=<件数> suggested=<提案した件数> accuracy=<正解率>`: `noneProbability` を 0.1 刻みにした帯ごとの件数と正解率。提案しなかったケースも含む全ケースが対象で、`errors` になったケースだけ分母から除外する
- `mismatch event=<イベント名> request="<先頭 60 文字>" expected=… winner=… none_p=…`: 不一致ケースの一覧。`errors` になったケースは必ずここに列挙され、末尾に `error="..."` が付く

`golden.json` は該当あり 20 件・該当なし 10 件の手書き 30 件から始める。該当なしには「日常的な依頼」「技術的だがスキル不要な質問」「roster に無い対象の名指し」を必ず含める。後者は当てずっぽうを罰するために重要である。

ツール向けケースは `request` の代わりに `tool_name` と `tool_input` を持つ。`run.ts` はフックと同じ `buildToolRequest` で request 文を組み立て、`TOOL_FRAMING` で `suggest` を呼ぶ。

```json
{ "tool_name": "Bash", "tool_input": { "description": "Commit the staged changes", "command": "git commit -m \"fix: ...\"" }, "expected": "mgzl:commiting-to-git" },
{ "tool_name": "Bash", "tool_input": { "description": "List files in the hooks directory", "command": "ls typesafe/hooks" }, "expected": null }
```

該当ありは git commit / gh issue 作成 / worktree 作成 / サブエージェント起動など、該当なしは ls / cat / grep / git status といった定型の確認作業と、roster に無い対象の名指し（Slack への curl など）を中心にする。現状は 10 件（該当あり 5 / 該当なし 5）で、プロンプト向け 30 件と合わせて 40 件である。

### 精度を追い込む手順

閾値は無いので、いじれるのは質問文（`wide` / `none`）とスキル側の `description` である。

1. `bun run typesafe/eval/run.ts --cwd <project>` を実行し、2 つの誤り率を記録する
2. `mismatch` の行を読み、誤りが「`none` を選ぶべきなのに選ばなかった」のか「別のスキルに負けた」のかを `none_p` で切り分ける
3. 前者なら `PROMPT_FRAMING` / `TOOL_FRAMING` の `none` の文言を、後者なら競合したスキルの `description` を疑う。1 つずつ変えて 1 と 2 を繰り返す
4. `band=` の行で `none_p` と正解率の関係を見る。高い帯に提案が残っていれば、`none` の文言が弱い
5. 改善だけでなく破壊（提案のせいで誤ったケース）も数える。ネットで得かを必ず両方向から見る

## テスト

Run: `bun test --cwd typesafe`

`hooks/suggest-skill.test.ts` のうち偽の System One を要する数件と、`viewer/server.test.ts` は、ローカルの `Bun.serve` を立ち上げる。Claude Code の Bash サンドボックスは既定でポートの bind を拒否し `EADDRINUSE` で失敗するので、このリポジトリの `.claude/settings.local.json` には `sandbox.network.allowLocalBinding: true` と `allowedDomains: ["localhost", "127.0.0.1", "[::1]"]` を入れてある（前者が listen、後者が localhost への接続を許可する。設定ファイルは監視されているので再起動は要らない）。この設定が無い環境で `EADDRINUSE` になるのはテストの不備ではない。なお「API に到達できなくても無出力で exit 0（フェイルオープン）」は存在しないポートを指すだけで `Bun.serve` を使わないため、設定が無くても通る。
