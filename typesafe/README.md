# typesafe

TypeSafe の System One モデル Jev にスキル選択を問い合わせ、関係するスキル 1 件を提案として注入するプラグインである。発火点は 2 つある。

- `UserPromptSubmit`（ユーザーのプロンプト送信時）: 依頼文を材料に、そのターンの進め方を決めるスキルを提案する
- `PreToolUse`（matcher `Bash|Agent`、ツール呼び出しの直前）: これから取る行為を材料に、その行為を手順化したスキルを提案する

スキルの支援が本当に要るのは作業の途中である。「バグを直して」と依頼された後、調査が進んでコミットが必要になった瞬間にはプロンプト時点の提案は届いていない。`PreToolUse` はその穴を埋める。対象を Bash と Agent に絞るのは、git 操作・テスト実行・gh 操作・サブエージェント起動が「スキルが手順を持っていそうな行為」でありながら、実装中でもターンあたり数回に収まるためである。Edit / Write は実装中に連発するので対象外にしてある。`PreToolUse` の command hook はタイムアウトしてもツール呼び出しをブロックしない。

## 何をするか（UserPromptSubmit）

ユーザーが 1 ターン送るたびに、次の 2 リクエストを Jev に投げる。

1. Call 1: roster 全件を description だけで浅く読む Choice 1 問と、「そもそもスキルが要るターンか」を測る Noul 3 問（`gate::acts_on_user_system` / `gate::would_follow_documented_procedure` / `gate::prose_suffices`）。`prose_suffices` は「文章で足りる」ほど提案が不要になるため、平均する前に `1 - noul` へ反転してから他の 2 問と平均する。その平均が `0.30` 未満ならここで打ち切る。
2. Call 2: Call 1 の上位 3 件だけを、description 全文 + SKILL.md 冒頭 700 文字で深く読む Choice 1 問と、候補ごとの `fits::<name>` Noul。`fits` の最大値が `0.30` 未満なら提案しない。

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

判定の枠組み（framing）はプロンプト向けと別である。Call 1 の gate は 1 問だけで、`gate::routine_step`「これは ls / cat / git status のような、手順書を引くまでもない定型の確認作業か」を問い、`invert: true` で反転してから平均に入れる。プロンプト向けの gate 3 問（ファイル操作か・手順書を引くか・文章で足りるか）は Bash 実行直前には自明に同じ答えになり判別力が無いため使わない。閾値 `GATE_THRESHOLD = 0.30` / `FITS_THRESHOLD = 0.30` はプロンプト向けと共通である。

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
- ツール向けの閾値は eval のツール向けケースで調整するが、ケースは手書きで件数が少ない。運用ログを見て追加する

## フェイルオープンと性能

キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで、stdout に何も出さず exit 0 で終わる。Jev が回答を欠いた場合、Call 1 でどの roster エントリもランクしなかった場合、Call 2 でショートリスト外の候補を選んだ場合も `pipeline.ts` の `suggest` が例外を投げ、同じ経路でフックは黙って終了する。stdin が壊れた JSON の場合、キーが設定されている場合はログの `outcome` が `error`、`error` フィールドに `"malformed stdin payload"` が記録される（キー未設定なら他のケースと同様に何も記録しない）。1 コールのタイムアウトは 3 秒、2 コール合計で最悪 6 秒で、`hooks.json` の `timeout` 10 秒はその外側の保険である。通常時は bun 起動 + 数十ファイルの読み込み + 2 コール（各 0.1〜0.3 秒）で 1 秒未満を見込む。

## ログ

`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions-v2.jsonl` に 1 行 1 JSON で追記する。未設定なら何も書かない。`TYPESAFE_API_KEY` が未設定のときも機能そのものが無効なので、`skipped` を含めて一切記録しない。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`event`（`UserPromptSubmit` / `PreToolUse`）、`tool_name`（`PreToolUse` のときのみ。`Bash` / `Agent`）、`agent_type`（サブエージェント内で発火したときのみ）、`prompt`、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`calls`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。ログは追記専用でローテーションは無い。

旧い `suggestions.jsonl` はそのまま残すが、もう読みも書きもしない。新旧のレコードは形が違うので混ぜて集計しない。

`prompt` には `UserPromptSubmit` なら依頼文の全文が、`PreToolUse` なら組み立て後の request 文が入る。`gate` は `{ scores: { <質問キー>: <反転前の noul> }, mean: <反転適用後の平均> }` の形で、`scores` のキーは framing ごとに変わる（プロンプト向けは 3 キー、ツール向けは `gate::routine_step` の 1 キー）。`event` を持たない古いレコードは `UserPromptSubmit` とみなして集計する。この変更より前に書かれたレコードは `gate` が `{ scores, mean }` ではなく `acts_on_user_system` / `would_follow_documented_procedure` / `prose_suffices` / `mean` を直接持つ旧い平坦な形なので、読み取り側は `gate.mean` だけに依存すること。

`calls` にはそのターンで実際に投げた System One の往復が、投げた順に入る。1 要素が 1 往復で、`url`、`request`（送信した body そのもの。`model` / `state` / `questions`）、`response`（`{ status, body }`。応答が得られなかった場合は `null`、JSON として読めない本文は `body` に生の文字列）、`error`（失敗した往復のみ。HTTP エラーの文言・fetch の例外・応答の形が想定外だった旨）、`elapsedMs` を持つ。**ヘッダは要求側・応答側とも一切記録しない。** `Authorization` に API キーが載るためである。API を呼ばなかった経路（`skipped`、stdin 不正）では空配列になり、途中で失敗した場合はそこまでに完了した往復だけが残る（Call 1 で失敗すれば 1 要素）。

`outcome` が `gate_quiet`（gate の平均が閾値未満で Call 2 を呼ばなかった場合）でも、`shortlist` には Call 1 の上位候補が残る。ただしこのとき各要素が持つのは `wideProbability` だけで、Call 2 を経ていないため `rerankProbability` / `fits` は付かない。

`prompt` はそのまま `eval/golden.json` の `request` に転記できる。

## 評価

```
bun run typesafe/eval/run.ts --cwd <project> [--golden <path>] [--concurrency 4]
```

フックと同じ `roster.discover` と `pipeline.suggest` を使う。`--concurrency` には数値以外を渡すと例外になる。出力は key=value の簡素形式で、次を出す。

- `total` / `with_skill` / `without_skill` / `errors`（`suggest` が例外を投げたケースの件数）
- `event=<イベント名> total=… with_skill=… without_skill=… errors=… wrong_suggestion_rate=… unneeded_suggestion_rate=…`: 発火イベント別の内訳
- `wrong_suggestion_rate`: 該当ありで例外にならなかったもののうち `winner !== expected` の割合（`winner === null` も誤り）
- `unneeded_suggestion_rate`: 該当なしで例外にならなかったもののうち `winner !== null` の割合
- `band=<下限>-<上限> count=<件数> accuracy=<正解率>`: 勝者の `fits` を 0.1 刻みにした帯ごとの件数と正解率（`errors` になったケースは帯の分母から除外する）
- `mismatch event=<イベント名> request="<先頭 60 文字>" expected=… winner=… gate=… fits=…`: 不一致ケースの一覧。`errors` になったケースは必ずここに列挙され、末尾に `error="..."` が付く

`golden.json` は該当あり 20 件・該当なし 10 件の手書き 30 件から始める。該当なしには「日常的な依頼」「技術的だがスキル不要な質問」「roster に無い対象の名指し」を必ず含める。後者は当てずっぽうを罰するために重要である。

ツール向けケースは `request` の代わりに `tool_name` と `tool_input` を持つ。`run.ts` はフックと同じ `buildToolRequest` で request 文を組み立て、`TOOL_FRAMING` で `suggest` を呼ぶ。

```json
{ "tool_name": "Bash", "tool_input": { "description": "Commit the staged changes", "command": "git commit -m \"fix: ...\"" }, "expected": "mgzl:commiting-to-git" },
{ "tool_name": "Bash", "tool_input": { "description": "List files in the hooks directory", "command": "ls typesafe/hooks" }, "expected": null }
```

該当ありは git commit / gh issue 作成 / worktree 作成 / サブエージェント起動など、該当なしは ls / cat / grep / git status といった定型の確認作業と、roster に無い対象の名指し（Slack への curl など）を中心にする。現状は 10 件（該当あり 5 / 該当なし 5）で、プロンプト向け 30 件と合わせて 40 件である。

### 閾値を調整する手順

1. `bun run typesafe/eval/run.ts --cwd <project>` を実行し、2 つの誤り率を記録する
2. `band=` の行を見る。帯ごとに `accuracy` が変わらなければ、このタスクでは閾値運用が成立しない。その場合は `FITS_THRESHOLD` をいじらず、提案として出すところまでに留める
3. 帯ごとに差があるなら、`hooks/lib/pipeline.ts` の `GATE_THRESHOLD` / `FITS_THRESHOLD` / `SHORTLIST` / `EXCERPT_CHARS` を 1 つずつ変えて 1 と 2 を繰り返す
4. `mismatch` の行を読み、誤りが「gate で落ちた」のか「ショートリストに入らなかった」のか「rerank で負けた」のかを切り分ける。`gate` の値が低いなら `GATE_THRESHOLD`、`fits` が低いなら description の書き方を疑う
5. 改善だけでなく破壊（提案のせいで誤ったケース）も数える。ネットで得かを必ず両方向から見る

## テスト

Run: `bun test --cwd typesafe`

`hooks/suggest-skill.test.ts` 内の 2 件（「提案ありなら skill_relevance ブロックを出力する」「gate が静かなら提案なしブロックを出力し Call 2 を呼ばない」）は `startFakeServer` でローカルの `Bun.serve` を立ち上げる。Claude Code の Bash サンドボックス内ではポートを bind できず `EADDRINUSE` で失敗するが、通常のシェルでは通る。サンドボックス内での失敗はテストの不備ではない。なお「API に到達できなくても無出力で exit 0（フェイルオープン）」は存在しないポートを指すだけで `Bun.serve` を使わないため、サンドボックス内でも通る。
