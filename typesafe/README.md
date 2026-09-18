# typesafe

`UserPromptSubmit` フックで TypeSafe の System One モデル Jev にスキル選択を問い合わせ、そのターンに関係するスキル 1 件を提案として注入するプラグインである。

## 何をするか

ユーザーが 1 ターン送るたびに、次の 2 リクエストを Jev に投げる。

1. Call 1: roster 全件を description だけで浅く読む Choice 1 問と、「そもそもスキルが要るターンか」を測る Noul 3 問（`gate::acts_on_user_system` / `gate::would_follow_documented_procedure` / `gate::prose_suffices`）。3 問の平均が `0.30` 未満ならここで打ち切る。
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

## 環境変数

- `TYPESAFE_API_KEY`（必須）: 未設定ならフックは何も出力せず終了する。機能を無効化したいときはこれを設定しない
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

## フェイルオープンと性能

キー未設定・タイムアウト・HTTP エラー・JSON 不正・例外のすべてで、stdout に何も出さず exit 0 で終わる。Jev が回答を欠いた場合、Call 1 でどの roster エントリもランクしなかった場合、Call 2 でショートリスト外の候補を選んだ場合も `pipeline.ts` の `suggest` が例外を投げ、同じ経路でフックは黙って終了する。stdin が壊れた JSON の場合はログの `outcome` が `error`、`error` フィールドに `"malformed stdin payload"` が記録される。1 コールのタイムアウトは 3 秒、2 コール合計で最悪 6 秒で、`hooks.json` の `timeout` 10 秒はその外側の保険である。通常時は bun 起動 + 数十ファイルの読み込み + 2 コール（各 0.1〜0.3 秒）で 1 秒未満を見込む。

## ログ

`CLAUDE_PLUGIN_DATA` が設定されていれば `${CLAUDE_PLUGIN_DATA}/suggestions.jsonl` に 1 行 1 JSON で追記する。未設定なら何も書かない。フィールドは `ts`（ISO 8601）、`session_id`、`cwd`、`prompt`（全文）、`outcome`（`suggested` / `gate_quiet` / `no_fit` / `skipped` / `error`）、`winner`、`gate`、`shortlist`、`rerankConfidence`、`elapsedMs`、`rosterSize`、`error`（`error` のときのみ）。書き込み失敗は握りつぶす。

`outcome` が `gate_quiet`（gate の平均が閾値未満で Call 2 を呼ばなかった場合）でも、`shortlist` には Call 1 の上位候補が残る。ただしこのとき各要素が持つのは `wideProbability` だけで、Call 2 を経ていないため `rerankProbability` / `fits` は付かない。

`prompt` はそのまま `eval/golden.json` の `request` に転記できる。

## 評価

```
bun run typesafe/eval/run.ts --cwd <project> [--golden <path>] [--concurrency 4]
```

フックと同じ `roster.discover` と `pipeline.suggest` を使う。`--concurrency` には数値以外を渡すと例外になる。出力は key=value の簡素形式で、次を出す。

- `total` / `with_skill` / `without_skill` / `errors`（`suggest` が例外を投げたケースの件数）
- `wrong_suggestion_rate`: 該当ありのうち `winner !== expected` の割合（`winner === null` も誤り）
- `unneeded_suggestion_rate`: 該当なしのうち `winner !== null` の割合
- `band=<下限>-<上限> count=<件数> accuracy=<正解率>`: 勝者の `fits` を 0.1 刻みにした帯ごとの件数と正解率（`errors` になったケースは帯の分母から除外する）
- `mismatch request="<先頭 60 文字>" expected=… winner=… gate=… fits=…`: 不一致ケースの一覧。`errors` になったケースは必ずここに列挙され、末尾に `error="..."` が付く

`golden.json` は該当あり 20 件・該当なし 10 件の手書き 30 件から始める。該当なしには「日常的な依頼」「技術的だがスキル不要な質問」「roster に無い対象の名指し」を必ず含める。後者は当てずっぽうを罰するために重要である。

### 閾値を調整する手順

1. `bun run typesafe/eval/run.ts --cwd <project>` を実行し、2 つの誤り率を記録する
2. `band=` の行を見る。帯ごとに `accuracy` が変わらなければ、このタスクでは閾値運用が成立しない。その場合は `FITS_THRESHOLD` をいじらず、提案として出すところまでに留める
3. 帯ごとに差があるなら、`hooks/lib/pipeline.ts` の `GATE_THRESHOLD` / `FITS_THRESHOLD` / `SHORTLIST` / `EXCERPT_CHARS` を 1 つずつ変えて 1 と 2 を繰り返す
4. `mismatch` の行を読み、誤りが「gate で落ちた」のか「ショートリストに入らなかった」のか「rerank で負けた」のかを切り分ける。`gate` の値が低いなら `GATE_THRESHOLD`、`fits` が低いなら description の書き方を疑う
5. 改善だけでなく破壊（提案のせいで誤ったケース）も数える。ネットで得かを必ず両方向から見る

## テスト

Run: `bun test --cwd typesafe`

`hooks/suggest-skill.test.ts` 内の 2 件（API 到達不可のフェイルオープン確認、提案ありブロックの出力確認）はローカルの `Bun.serve` でポートを 1 つ立ち上げる。Claude Code の Bash サンドボックス内ではポートを bind できず `EADDRINUSE` で失敗するが、通常のシェルでは通る。サンドボックス内での失敗はテストの不備ではない。
