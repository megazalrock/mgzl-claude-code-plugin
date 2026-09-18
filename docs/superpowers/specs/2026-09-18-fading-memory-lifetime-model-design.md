# fading-memory 寿命モデル再設計

作成日: 2026-09-18
対象: `fading-memory` プラグイン（`hooks/lib/expiry.ts` を中心とする寿命計算と、期限切れ記憶の扱い）

## 背景と問題

現行の有効期限は次の式で計算している（`hooks/lib/expiry.ts`）。

```
extensionDays = min(baseTtlDays + score × perScoreDays, maxExtensionDays)
expiresAt     = max(created + extensionDays, lastReferenced + baseTtlDays)
```

この式には3つの問題がある。

- `max` の左右どちらが勝つかで score が効いたり効かなかったりする。`lastReferenced` が `created + (extensionDays − 30)日` を超えた時点で score 項は完全に無視される
- `created` と `lastReferenced` の2つを起点にしており、閾値を境に「expiresAt が何を表す値か」が変わる
- `expiresAt` は index.md の並び順（「新しくて score が高い」→「古くて score が低い」）にも使っているが、上の性質のため順位づけの値として一貫していない

また、期限切れの記憶を SessionStart で trash へ移動し 30 日後に完全削除しているが、削除すると後のセッションで同じ知見が再び新規作成され、重複チェック（更新）の対象にもならない。

## 目的

- score が常に有効期限に効く、起点が1つの式にする
- `expiresAt` を「index.md に載せる順位」として一貫した値にする
- 期限切れによる削除を廃止し、index.md に載せないだけにする
- `remember` スキルで明示的に作成した記憶と、SessionEnd の自動抽出で作成した記憶とで基本 TTL に差をつける

## 設計

### 1. 寿命の式

```
anchor    = lastReferenced ?? created
expiresAt = permanent ? Infinity : anchor + (baseTtlDays[origin] + score × perScoreDays) 日
```

- 起点は `anchor` の1本。`lastReferenced` が `null` の記憶（作成後まだ役立っていない）は `created` を起点にする
- score が加点されるとき `lastReferenced` も同時に前進する（現行 `applyExtraction` の挙動を維持）ため、「直近に強化された記憶ほど長く残る」という一方向の性質になる
- 延長の上限（`maxExtensionDays`）は撤廃する。score × `perScoreDays` は線形に効き続ける
- `remainingDays` の仕様は変えない。退色済みの記憶は負値になる

### 2. frontmatter への `origin` 追加

`MemoryMeta`（`hooks/lib/frontmatter.ts`）に `origin: "auto" | "manual"` を追加する。

- `auto`: SessionEnd フックの自動抽出で作成された記憶
- `manual`: `remember` スキルで作成された記憶
- parse 時に `origin` が無い、または未知の値なら `auto` として扱う。既存ファイルの一括書き換えは行わない
- serialize 時は常に書き出す
- `agents/memory-verifier.md` の frontmatter テンプレ説明に `origin` を1行追記する

### 3. `origin` の付与経路

`applyExtraction`（`hooks/lib/extraction.ts`）の引数に `origin` を追加する。

```ts
applyExtraction(paths, result, nowIso, origin: MemoryOrigin)
```

- `skills/remember/scripts/save-memories.ts` は `"manual"` を渡す
- `hooks/session-end-worker.ts` は `"auto"` を渡す
- 新規作成（`newMemories`）のみ `origin` を書き込む
- 更新（`updatedMemories`）では既存ファイルの `origin` を維持する。`remember` で自動抽出の記憶を上書きしても `manual` には昇格しない

### 4. 定数（`hooks/lib/config.ts`）

```ts
baseTtlDays: { auto: 15, manual: 30 },
perScoreDays: 7,
trashRetentionDays: 30,
```

- `maxExtensionDays` は削除する
- `baseTtlDays` は数値から `origin` をキーにしたオブジェクトへ変更する

### 5. 期限切れ削除の廃止

- `hooks/lib/maintenance.ts` から `expireMemories` を削除する
- `hooks/session-start.ts` の `expireMemories` 呼び出しを削除する
- `moveToTrash` と `purgeTrash` は残す。`skills/maintain/scripts/trash-memory.ts` が誤った記憶を手動で trash へ移す経路で使っており、trash 内のファイルは従来どおり `trashRetentionDays` 経過後に `purgeTrash` が完全削除する

### 6. index.md の絞り込み

`renderIndex(memories, now)` に `now` を渡し、`expiresAt(meta) > now` の記憶だけを載せる。並び順は現行どおり `expiresAt` の降順（`permanent` が先頭）。

- 絞り込みは `renderIndex` の中だけで行う。呼び出し元3つ（`hooks/session-start.ts`、`skills/maintain/scripts/finalize.ts`、`skills/remember/scripts/save-memories.ts`）は `now` を渡すだけ
- `loadMemories` は今後も全件を返す。重複チェック・更新・score 加点は退色済みの記憶も対象にする。現行で該当する経路は次の3つで、いずれも `loadMemories` を使っており index.md を参照していない
  - `hooks/session-end-worker.ts` が既存記憶を抽出プロンプトへ渡す箇所
  - `skills/remember/scripts/list-memories.ts` が既存記憶を一覧する箇所
  - `hooks/lib/extraction.ts` の `applyExtraction` が更新対象の存在を確認する箇所
- 退色した記憶が更新または加点されれば `anchor` が前進して index.md に復帰する

### 7. list スキル

`skills/list/scripts/list-memories.ts` の出力行に `origin=<auto|manual>` を1項目追加する。`remaining` が負なら退色中と読める。並び順（`sortByScore`）は変えない。

### 8. テスト

- `hooks/lib/expiry.test.ts`: 新式に書き直す。`anchor` が `created` / `lastReferenced` それぞれの場合、score による線形延長、`origin` 別の基本 TTL、`permanent` の `Infinity`、上限が無いこと
- `hooks/lib/maintenance.test.ts`: `expireMemories` のケースを削除
- `hooks/lib/index-gen.test.ts`: 退色済みの記憶が載らないケースと、`permanent` が載るケースを追加
- `hooks/lib/frontmatter.test.ts`: `origin` の parse（欠落時 `auto`、未知の値は `auto`）と serialize
- `hooks/lib/extraction.test.ts`: 新規作成で `origin` が書き込まれること、更新で既存の `origin` が維持されること
- `hooks/lib/ranking.test.ts`: `expiresAt` の呼び出し先が変わるため既存ケースが通ることを確認（変更が要れば追従）

### 9. ドキュメント

- `fading-memory/README.md` と `skills/*/SKILL.md` に「期限切れの記憶は削除される」「trash へ移動される」等の記述があれば「index.md に載らなくなる」へ修正する
- `skills/list/SKILL.md` の description にある「有効期限」「忘却」の表現は、退色（index.md から外れる）の意味で読めるため変えない

## 変更範囲

増える管理対象:

- frontmatter の `origin` フィールド（1つ）
- config の `baseTtlDays.manual`（1つ）

減るもの:

- `config.maxExtensionDays`
- `maintenance.expireMemories` とそのテスト
- `expiry.test.ts` の上限・下限に関するケース

触るファイル:

- `hooks/lib/expiry.ts`、`config.ts`、`frontmatter.ts`、`extraction.ts`、`maintenance.ts`、`index-gen.ts`
- `hooks/session-start.ts`、`hooks/session-end-worker.ts`
- `skills/remember/scripts/save-memories.ts`、`skills/maintain/scripts/finalize.ts`、`skills/list/scripts/list-memories.ts`
- `agents/memory-verifier.md`
- 上記に対応する `*.test.ts`、README と SKILL.md の該当箇所

## 互換性

- 既存の記憶ファイルは `origin` を持たないため `auto` として読まれる。書き換えは次に更新または加点されたタイミングで自然に起きる
- 既存の記憶で `lastReferenced: null` かつ `created` から 15 日以上経過しているものは、この変更の直後から index.md に載らなくなる。ファイルは残るため、更新・加点で復帰できる
- `state.json` は変更しない
