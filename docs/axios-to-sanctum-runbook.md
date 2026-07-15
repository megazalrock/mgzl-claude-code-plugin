# runbook

> `api/Users`（15ファイル）の移行を end-to-end で完了し、実測に基づき確定した横展開レシピ。
>

> ⚠️ 当初の想定（`const { data } = await $axios.get()` 分割代入が主）は **`api/Users` では実態と異なった**。実際の主パターンは `$axios.$get/$post/...`（data 自動抽出ヘルパー）。下記が確定版。
>

## 変換パターン集

- 宣言: `const { $axios } = useNuxtApp()` → `const client = useSanctumClient()`
- 戻り値の分割代入 `{ isSuccess }` / `{ data }` / `res.data` は **API エンベロープのフィールド**であり axios の `response.data` ではない → **そのまま維持**（`$axios.$get` ヘルパーも body を直接返しており、ofetch と同義）。

| 旧（`$axios` ヘルパー） | 新（`useSanctumClient`） |
| --- | --- |
| `$axios.$get<T>(url)` | `client<T>(url)` |
| `$axios.$get<T>(url, { params })` | `client<T>(url, { query: params })` |
| `$axios.$get<T>(url, { params })`（params に配列を含む） | `client<T>(url, { query: toLaravelQuery(params) })` |
| `$axios.$post<T>(url, body)` | `client<T>(url, { method: 'POST', body })` |
| `$axios.$post<T>(url)`（body なし） | `client<T>(url, { method: 'POST' })` |
| `$axios.$put<T>(url, payload)` | `client<T>(url, { method: 'PUT', body: payload })` |
| `$axios.$patch<T>(url, data)` | `client<T>(url, { method: 'PATCH', body: data })` |
| `$axios.$patch<T>(url)`（body なし） | `client<T>(url, { method: 'PATCH' })` |
| `$axios.$delete<T>(url)`（body なし） | `client<T>(url, { method: 'DELETE' })` |
- 型の注意: 戻り値を使わない更新系は `client<void>` のように `void` を型引数に渡さない（ESLint `no-invalid-void-type`）。ジェネリックを省略して `await client(url, {...})` とする。

## 落とし穴（実証済み）

1. **配列クエリの `[]` 問題（最重要）**: ofetch/ufo は配列を `ids=1&ids=2`（ブラケットなし）でシリアライズするが、axios デフォルトは `ids[]=1&ids[]=2`。Laravel(PHP) は前者だと**最後の値のみ採用**し配列フィルタが壊れる。→ 共通ヘルパー `~/utils/http/query.ts` の `toLaravelQuery()` で配列キーを `key[]` に変換して回避する。`LocationQuery` を受ける GET も配列を含みうるため適用対象。
2. **`params` → `query`**: axios の `{ params }` は ofetch では `{ query }`。取りこぼすとクエリが送られず無言で壊れる。
3. **DELETE / body なしリクエスト**: iPhone で body 無し DELETE が動かない問題は `plugins/sanctum.ts`（`sanctum:request` フックで `t=1` 付与）で client 層に吸収済み。各 composable 側での対応は不要。
4. **エラー/キャンセル処理**（`api/Users` には該当なしだが Phase3 で頻出）:
  - `e.response.data` → `HttpError.data(e)`（`~/utils/http/httpError.ts`）
  - `e.response?.status === 403` 等の直接参照 → `HttpError.status(e)`
  - `$axios.isCancel(e)` / `AbortError` 判定 → `HttpError.isCanceled(e)`
5. **テスト傍受**: `$axios` はメソッド差し替えで傍受していたが、`useSanctumClient()` が返す `$sanctumClient` は Nuxt `provide` の **`configurable: false` getter** かつ **関数呼び出し**のため、同手法では傍受不可。→ 各テスト先頭で `mockNuxtImport('useSanctumClient', () => () => sanctumClientStub)` を宣言し、共通 `sanctumClientStub`（`setupStubApi.ts`、既存 `registerEndpoint`/`handlers` を再利用）に橋渡しする。

## テストレシピ（コピペ用）

```tsx
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
    expect(handler.mock.calls[0]![0].body).toEqual({ foo: 'bar' })          // body 検証
    expect(handler.mock.calls[0]![0].meta.routeParameters).toEqual({ id: '1' }) // path param 検証
    // GET の query は handler.mock.calls[0]![0].params（URLSearchParams）で検証
    // 配列は params.has('ids[]') === true / params.has('ids') === false を確認
  })
})
```

## レビューチェックリスト

- [ ]  当該ドメインから `$axios` 利用がゼロ（`grep -rn '\$axios' api/<Domain>`）
- [ ]  `'axios'` の static/dynamic import がゼロ
- [ ]  `eslint-custom-rules/legacy-axios-files.js` の LEGACY リストから当該パスを削除（→ `no-nuxt-app-axios` が有効化され回帰をブロック）
- [ ]  `params` → `query` への置換漏れなし
- [ ]  **配列を含む query は `toLaravelQuery()` を経由**している
- [ ]  `e.response.data` / `e.response?.status` の残存ゼロ（→ `HttpError.*` 化）
- [ ]  戻り値のエンベロープ（`{ isSuccess }` / `{ data }` / `res.data`）を維持
- [ ]  テスト緑（`mockNuxtImport` + `sanctumClientStub` レシピ）

## 追加した共通資産（Phase3 で再利用）

- `~/utils/http/query.ts` … `toLaravelQuery()`（配列クエリ axios 互換化）
- `composables/utils/api/__tests__/utils/StubApi/setupStubApi.ts` … `sanctumClientStub`（テスト傍受）