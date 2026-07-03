# ラウンド3: hard-small（50行未満 × hard）の正解データ（レビュアーには渡さない）

## hard-small.diff — activity-feed.ts（36行 / reviewer-for-logic）

| ID | 箇所 | バグ内容 | 期待severity |
|----|------|---------|-------------|
| HS1 | sanitizeMessage | `replace('\n', ' ')` は最初の1個しか置換しない（replaceAll または /g が必要）。複数行メッセージで改行が残る | [4] |
| HS2 | fetchFeed | try 内で `return fetchActivities(userId)` を await していない → rejection が catch を素通りし、フォールバック `[]` が永久に機能しない | [4]〜[5] |
| HS3 | resolveMinScore | `query.minScore \|\| DEFAULT_MIN_SCORE` — minScore=0（全件表示の意図）が falsy のため 10 に化ける。`??` にすべき | [3]〜[4] |
| HS4 | latestActivities | count=0 のとき `slice(-0)` = `slice(0)` で全件返る（0件が返るべき） | [3]〜[4] |

## comments-small.diff — member-cache.ts（44行 / reviewer-for-comments）

| ID | 箇所 | 欠陥内容 | 期待severity |
|----|------|---------|-------------|
| CS1 | CACHE_TTL_MS | 「キャッシュは 5 分で失効する」だが値は 600_000 ms = 10 分（単位計算が必要な数値不一致） | [4] |
| CS2 | getMember JSDoc | `@throws 会員 ID の形式が不正な場合はエラーを送出する` — 実装は throw せず null を返す | [4] |
| CS3 | hasSameEmail | 「大文字小文字を区別せずに比較する」だが `a.email.toLowerCase() === b.email` は片側のみ正規化 → b.email に大文字があると常に false。コメントの主張と実装が不一致 | [4] |
| CS4 | buildMemberLabel | `// TODO: v2 API 移行後にこの分岐を削除する` — 関数に分岐は存在せず、解決済み/対象喪失の TODO | [4] |
| CS5 | displayNameOf | 近隣コメントで「会員」と「ユーザー」が混在（用語不統一） | [3] |

正当コメント（指摘してはいけない）: displayNameOf のコメント内容自体は実装と一致（用語のみ CS5 対象）

## 採点基準

ラウンド1・2と同じ。
