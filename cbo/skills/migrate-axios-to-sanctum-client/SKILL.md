---
name: migrate-axios-to-sanctum-client
description: Nuxt アプリの API 呼び出しを `$axios` から `useSanctumClient`（ofetch）へ移行する際の変換パターン集。api/ 配下の API composable の書き換え（`toLaravelQuery` による配列クエリの `ids[]` 変換・AbortSignal 透過）、呼び出し元 catch の `AxiosError` 判定から `HttpError` ユーティリティ（`is`/`isCanceled`/`data`）への置換、`mockNuxtImport` + `sanctumClientStub` によるテスト傍受と `FetchError` フィクスチャへのテスト追従、`legacy-axios-files.js` の許可リスト更新までを一貫して扱う。「$axios移行」「useSanctumClient化」「axios廃止」「legacy-axios-files」などの依頼時に使用する。
---

# $axios → useSanctumClient 移行ガイド

## 概要

axios は段階的に廃止中で、API 通信は `useSanctumClient()`（nuxt-auth-sanctum が provide する ofetch クライアント）、エラー/キャンセル判定は `~/utils/http/httpError` の `HttpError` へ移行する。未移行ファイルは `eslint-custom-rules/legacy-axios-files.js` の `LEGACY_AXIOS_FILES` に許可リストとして列挙されており、リスト外での `$axios` 使用はカスタムルール `no-nuxt-app-axios` が lint エラーにする。つまり移行の完了条件は「対象ファイルをこのリストから削除しても lint が通る」こと。

移行はワイヤ互換・挙動等価のリファクタリングとして行う。等価性が崩れやすいのは次の3点で、本ガイドはこの3点を中心に変換パターンを示す。

1. **クエリ形式** — ofetch のシリアライザ（ufo）は配列を Laravel が解釈できない形式で送る（後述）
2. **レスポンスのアンラップ** — `$axios.$get` も `client` もパース済みボディを直接返す。戻り値の `{ data }` / `{ isSuccess }` / `res.data` は API エンベロープのフィールドであって axios の `response.data` ではないため、分割代入・参照の形はそのまま維持する
3. **中断シグナル** — `AbortSignal` は fetch にそのまま透過するが、中断時のエラー表現が変わる

## 移行の進め方

1. **対象の選定**: `LEGACY_AXIOS_FILES` から画面・機能単位でまとまりのあるファイル群を選ぶ。対象が依存する API（例: store の init が呼ぶ別 API）が未移行で `AxiosError` を投げうる場合、その呼び出し元の catch は移行できない。無理に混ぜず、依存の移行後に回す（後述の TODO 残留パターン）
2. **api/ 配下の API composable を書き換える**（次節）
3. **呼び出し元（component / store）の catch を `HttpError` へ置換する**
4. **テストを追従させる**（`FetchError` フィクスチャ・クエリ検証形式）
5. **`legacy-axios-files.js` から移行済みファイルを削除する**（テストファイルも忘れずに）
6. **検証**: 対象のユニットテストと lint、型チェックを実行する。あわせて当該ドメインに `$axios` の残存がないこと（`grep -rn '\$axios' api/<Domain>`）と、`'axios'` の static/dynamic import がゼロであることを確認する

## API 層の変換

### 基本形（GET・クエリなし）

型引数は `$axios.$get<T>` から `client<T>` へそのまま移せる。GET はデフォルトメソッドなので指定不要。

```ts
// Before
export const useGetCompanyShiftBoards = () => {
  const { $axios } = useNuxtApp()
  const getCompanyShiftBoards = async (): Promise<GetCompanyShiftBoardsResponse> => {
    const { data } = await $axios.$get<GetResponse<GetCompanyShiftBoardsResponse>>('/api/company/shift_boards')
    return data
  }
  // ...
}

// After
export const useGetCompanyShiftBoards = () => {
  const client = useSanctumClient()
  const getCompanyShiftBoards = async (): Promise<GetCompanyShiftBoardsResponse> => {
    const { data } = await client<GetResponse<GetCompanyShiftBoardsResponse>>('/api/company/shift_boards')
    return data
  }
  // ...
}
```

### クエリパラメータと配列の落とし穴

`$axios` の `params` オプションは ofetch では `query` に相当する。ただし ofetch が内部で使う ufo は配列を `ids=1&ids=2`（ブラケットなし）でシリアライズする。Laravel(PHP) はこの形式を配列として解釈できず**最後の値のみを採用する**ため、配列フィルタが静かに壊れる。axios のデフォルト挙動（`ids[]=1&ids[]=2`）と互換にするには、`~/utils/http/query` の `toLaravelQuery` でトップレベルの配列値キーを `key[]` に付け替える。

```ts
import { toLaravelQuery } from '~/utils/http/query'

// Before
const { data } = await $axios.$get<GetArrayResponse<ScheduleListResourceItem>>('/api/schedule/list', {
  params,
  signal: abortController?.signal,
})

// After — ids は配列のため Laravel 互換のクエリ（`ids[]=1&ids[]=2`）へ変換する
const { data } = await client<GetArrayResponse<ScheduleListResourceItem>>('/api/schedule/list', {
  query: toLaravelQuery(params),
  signal: abortController?.signal,
})
```

使い分けの一次ルールは次のとおり。

- params が配列プロパティを含みうる → `client<T>(url, { query: toLaravelQuery(params) })` を必ず通す。`LocationQuery` を受け取る GET も配列を含みうるため適用対象
- スカラーのみ → `client<T>(url, { query: params })` と素通しでよい

補足: スカラーのみでも `toLaravelQuery` を通して害はなく（スカラー値はそのまま素通しされる）、後からパラメータが増えたときの事故を防げる。なお `toLaravelQuery` はネストしたオブジェクト（`filter[name]=x` 形式）には対応していない。必要になったら本体を拡張する。

### 更新系（POST / PUT / PATCH / DELETE）

リクエストボディは `body`、メソッドは `method` で指定する（先行例: `api/Users/UseUpdateUser.ts`）。

```ts
await client(`/api/users/${userId}`, { method: 'PUT', body: params })
```

`$axios` ヘルパーとの対応は次のとおり。

- `$axios.$post<T>(url, body)` → `client<T>(url, { method: 'POST', body })`
- `$axios.$post<T>(url)`（body なし） → `client<T>(url, { method: 'POST' })`
- `$axios.$put<T>(url, payload)` → `client<T>(url, { method: 'PUT', body: payload })`
- `$axios.$patch<T>(url, data)` → `client<T>(url, { method: 'PATCH', body: data })`
- `$axios.$patch<T>(url)`（body なし） → `client<T>(url, { method: 'PATCH' })`
- `$axios.$delete<T>(url)`（body なし） → `client<T>(url, { method: 'DELETE' })`

注意点が2つある。

- **型引数に `void` を渡さない**: 戻り値を使わない更新系で `client<void>` と書くと ESLint `no-invalid-void-type` に抵触する。ジェネリックを省略して `await client(url, {...})` とする
- **body なしリクエストの対応は不要**: iPhone で body なし DELETE が動かない問題は `plugins/sanctum.ts`（`sanctum:request` フックで `t=1` を付与）が client 層で吸収済み。各 composable 側での対応は不要

### AbortSignal

`signal: abortController?.signal` は fetch にそのまま透過するので変更不要。変わるのは中断時に reject されるエラーの形（次節）。

## 呼び出し元の catch の変換

### HttpError ユーティリティの契約

ofetch の `FetchError` は axios とプロパティ構造が異なる（特にレスポンスボディが `e.response.data` ではなく `e.data`）。各 catch を場当たり的に書き換えるとバグが散るため、判定は `~/utils/http/httpError` の `HttpError` に集約されている。

- `HttpError.is(e)` — ofetch / fetch が投げる HTTP エラーか（`e is FetchError` の型ガード）
- `HttpError.isCanceled(e)` — AbortController による中断か。ofetch がラップした `cause` の `AbortError` も、未移行 axios 経路の `CanceledError` も判定できる（旧 `$axios.isCancel` 相当）
- `HttpError.data<T>(e)` — パース済みレスポンスボディ（axios の `e.response.data` 相当）
- `HttpError.status(e)` — HTTP ステータス（取れなければ undefined）

### 置換対応

- `e instanceof AxiosError` → `HttpError.is(e)`（`import { AxiosError } from 'axios'` を削除）
- `e.response?.data?.message` → `HttpError.data<{ message?: string }>(e)?.message`
- `e.response?.status` → `HttpError.status(e)`
- `$axios.isCancel(e)` / `e instanceof CanceledError` → `HttpError.isCanceled(e)` または `signal.aborted`（使い分けは次節）

```ts
// Before
if (e instanceof AxiosError) {
  $toastNext.error(e.response?.data?.message ?? 'スケジュールの取得に失敗しました')
  $bugsnag.notify(e)
} else {
  $bugsnag.notify(e instanceof Error ? e : new Error(String(e)))
}

// After
if (HttpError.is(e)) {
  $toastNext.error(HttpError.data<{ message?: string }>(e)?.message ?? 'スケジュールの取得に失敗しました')
  $bugsnag.notify(e)
} else {
  $bugsnag.notify(e instanceof Error ? e : new Error(String(e)))
}
```

### 中断判定の使い分けと判定順序

ofetch は中断時も **`FetchError`（`cause` に `AbortError`）として reject する**。axios 時代は `CanceledError` が `AxiosError` のサブクラスだったのと同型の罠で、中断判定を `HttpError.is` より後に書くと中断が「HTTP エラー」としてトーストされてしまう。**中断判定は必ず catch の先頭**に置く。

判定手段は catch を書く場所が AbortController を参照できるかで使い分ける。

- **AbortController を自分で持つ store**: `abortController.signal.aborted` で判定する。エラーオブジェクトの形に依存しないため、テストのモックが何を投げても正しく中断と判定できて堅牢

```ts
} catch (e: unknown) {
  // ofetch は中断時も FetchError（cause に AbortError）として reject するため、
  // エラー種別ではなく先に signal.aborted で中断（新しいリクエストによるキャンセル）を判定する
  if (abortController.signal.aborted) {
    return null
  }
  if (HttpError.is(e)) { /* トースト + Bugsnag */ }
```

- **AbortController への参照がない component**: エラー自体から判定するしかないので `HttpError.isCanceled(e)` を使う

```ts
} catch (e: unknown) {
  // 連打等による中断はエラーとして扱わない。HttpError.is より先に isCanceled で判定する
  if (HttpError.isCanceled(e)) {
    return
  }
  if (HttpError.is(e)) { /* トースト + Bugsnag */ }
```

## テストの追従

### クライアントの傍受（sanctumClientStub）

`$axios` はメソッド差し替えで傍受できたが、`useSanctumClient()` が返す `$sanctumClient` は Nuxt provide の **`configurable: false` な getter** かつ**関数呼び出し**のため、同じ手法では傍受できない。各テストファイルの先頭で `mockNuxtImport` により `useSanctumClient` ごと差し替え、共通の `sanctumClientStub`（`composables/utils/api/__tests__/utils/StubApi/setupStubApi.ts`。既存の `registerEndpoint` / handlers を再利用）へ橋渡しする。

```ts
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { registerEndpoint, sanctumClientStub } from '~/composables/utils/api/__tests__/utils/StubApi/setupStubApi'
import { useXxx } from '../UseXxx'

mockNuxtImport('useSanctumClient', () => () => sanctumClientStub)

describe('useXxx', () => {
  const handler = vi.fn()
  registerEndpoint('/api/xxx/:id', { method: 'POST', handler: handler.mockImplementation(() => ({ isSuccess: true })) })
  beforeEach(() => { vi.clearAllMocks() })

  it('...', async () => {
    const { xxx } = useXxx()
    const actual = await xxx(1, { foo: 'bar' })
    expect(actual).toBe(true)
    expect(handler.mock.calls[0]![0].body).toEqual({ foo: 'bar' })              // body 検証
    expect(handler.mock.calls[0]![0].meta.routeParameters).toEqual({ id: '1' }) // path param 検証
    // GET のクエリは handler.mock.calls[0]![0].params（URLSearchParams）で検証する
  })
})
```

### エラーフィクスチャ

`AxiosError` を組み立てていたテストは、共通ファクトリ `test/fixtures/schedules/fetchError.fixture.ts` の `makeFetchError` / `makeAbortedFetchError` へ置き換える。レスポンスボディの置き場所が `response.data` から `data` へ変わる点に注意。

```ts
// Before
const axiosError = new AxiosError('failed')
Object.assign(axiosError, { response: { data: { message: 'サーバのエラーメッセージ' } } })

// After — ofetch ではボディが e.data に入る
const fetchError = makeFetchError({ data: { message: 'サーバのエラーメッセージ' } })

// Before: new CanceledError()
// After — cause に AbortError を持つ FetchError
const abortedError = makeAbortedFetchError()
```

### クエリ検証の形式変更

テスト用スタブ（sanctumClientStub）は実 ofetch(ufo) のシリアライズに寄せて、配列を同一キーの複数エントリとして `URLSearchParams` に展開する。旧 StubApi は `[].toString()` の結合文字列（`"1,2"`）だったため、assertion の形が変わる。

```ts
// Before
expect(params?.get('ids')).toBe('1,2')

// After — toLaravelQuery が ids を Laravel 互換の `ids[]` キーへ変換していることを検証
expect(params?.getAll('ids[]')).toStrictEqual(['1', '2'])
// ブラケットなしキーが混入していないことも確認する
expect(params?.has('ids')).toBe(false)
```

配列パラメータを持つ API には、この `key[]` 形式で送られることを検証するテストがなければ追加する。`toLaravelQuery` の通し忘れは型エラーにならず本番の Laravel 側でだけ壊れるため、テストが唯一の防波堤になる。

### 追加・変更すべきテスト

- **デフォルト文言のフォールバック分岐**: `makeFetchError()`（data なし）で reject させ、`?? 'デフォルト文言'` の分岐がトーストされることを検証するテストを追加する。axios 時代は response なし `AxiosError` が担っていたカバレッジの引き継ぎ
- **中断エラーの伝播検証は参照同一性で**: store が catch せず素通しする契約なら、`rejects.toThrow(CanceledError)` のようなクラス判定ではなく `rejects.toBe(abortedError)` で伝播経路を検証する（`FetchError` はクラス判定だと通常のエラーと区別できないため）
- **テスト名の言い換え**: 「AxiosError で〜」→「FetchError で〜」、「CanceledError で〜」→「中断エラーで〜」

## legacy-axios-files.js の更新

- 移行済みファイルを `LEGACY_AXIOS_FILES` から削除する。実装ファイルとテストファイルの両方が列挙されているので対で消す
- 依存 API が未移行のため catch を移行できず残すファイルには、**理由と削除条件を書いた TODO コメント**を付けて残留させる

```js
// TODO: 稼働表の useShiftBoardQueryStore は依存先（queryStore.loadQueryParams → masterStore.init）が
// axios 未移行のため AxiosError 判定を維持している。依存 API の HttpError 化にあわせて移行・削除する
'composables/stores/schedules/shift_board/__tests__/useShiftBoardQueryStore.test.ts',
'composables/stores/schedules/shift_board/useShiftBoardQueryStore.ts',
```

## 挙動変化として認識しておくこと

等価移行を謳っても、次の2点は厳密には挙動が変わる。PR の説明に明記して合意を取る。

- **Bugsnag 通知文の変化**: `FetchError` の message にはリクエスト URL とクエリが含まれる（`AxiosError` には含まれなかった）。エラー通知にエンドポイント URL + クエリパラメータが載るようになるため、クエリに機微情報（個人情報・トークン等）が含まれる API では扱いを検討する
- **URL 長ベースの定数の再見積もり**: チャンクサイズ等を URL 長から逆算している定数（例: `SCHEDULE_LIST_IDS_CHUNK_SIZE`）は、`key[]` がエンコードで `key%5B%5D` になり1件あたりの文字数が変わる。コメントの根拠計算を新形式で引き直し、上限内に収まることを確認する

## 参考実装

- 移行 PR の実例: CraftBank/arrangement-front#7604（稼働表の GET 3本 + 呼び出し元 3箇所 + テスト追従の一式）
- ドメイン一括移行の先行例: `api/Users` 全 15 ファイル（更新系は `api/Users/UseUpdateUser.ts`（PUT + body）、`api/Users/UsePostSendInvitation.ts` など）
- 判定ユーティリティ本体: `utils/http/httpError.ts`、`utils/http/query.ts`（いずれも TSDoc に設計意図あり）
- テスト傍受スタブ: `composables/utils/api/__tests__/utils/StubApi/setupStubApi.ts`（`sanctumClientStub` / `registerEndpoint`）
- エラーフィクスチャ: `test/fixtures/schedules/fetchError.fixture.ts`
- body なしリクエスト対策: `plugins/sanctum.ts`（`sanctum:request` フック）
- 許可リストと lint ルール: `eslint-custom-rules/legacy-axios-files.js`、`eslint-custom-rules/no-nuxt-app-axios.js`
