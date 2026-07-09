---
name: define-scoped-store
description: provide/inject ベースのスコープ付きストアファクトリ `defineScopedStore` の定義・利用・テストのパターン集。`provideStore`/`useStore` を使うストアの新規作成、手書き provide/inject や Pinia `defineStore` からのスコープ付きストアへの移行、`mountWithSetup` パターンによるストア単体テストの作成・修正の際に必ず参照する。「defineScopedStore」「スコープ付きストア」「scoped store」「provideStore」などの依頼時に使用する。
---

# defineScopedStore 使用ガイド

## 概要

`defineScopedStore`（`composables/shared/store/defineScopedStore.ts`）は provide/inject ベースのスコープ付きストアを生成するファクトリ。Pinia の `defineStore` がアプリ全体のグローバルシングルトンであるのに対し、provide したコンポーネントのツリーに閉じたストアを提供し、コンポーネント破棄時にストアも自動破棄される。

### シグネチャと基本性質

- `defineScopedStore<T, TArgs = void>(key: string, setup: (args: TArgs) => T)` で、`{ provideStore, useStore }` を返す
- `InjectionKey` は内部で `Symbol(key)` として生成される。**手書きの `InjectionKey` export と `ReturnType` 型 export は不要**（移行時は削除する）
- `provideStore(args)` は setup 実行 → `provide()` → **ストアインスタンスを return** する。親コンポーネント自身も返り値をそのまま使えるので、「provide して自分でも使う」が1行で書ける
- `useStore()` は inject に失敗すると `[defineScopedStore] "${key}" が provide されていません。` を **throw する**。フォールバック生成付きの `inject(KEY, factory, true)` とは挙動が異なる
- `provideStore` はコンポーネントの setup() 内で呼ばれるため、ストアの setup 内で `onUnmounted` 等のライフサイクルフックが正しく動く（AbortController の abort 後始末など）
- setup はオブジェクト引数（`TArgs`）を受け取れる。不要なら省略して `provideStore()` と呼べる

### ライフサイクル上の注意

ストアは provide したコンポーネントのマウント単位で生成・破棄される。ページ再訪で state はリセットされ再取得が走る（アプリセッション全体のキャッシュではない）。静的マスタのキャッシュ用途で採用する場合は、API コストが十分低いことを確認してから採用する。

## ストア定義パターン

```ts
import { defineScopedStore } from '~/composables/shared/store/defineScopedStore'

// キーはファイル内プライベートなプレーン文字列（export しない）
const XXX_STORE_KEY = 'xxxStore'

export const {
  useStore: useXxxStore,
  provideStore: provideXxxStore,
} = defineScopedStore(XXX_STORE_KEY, () => {
  // 通常の composable と同じ setup 本体。useNuxtApp() / onUnmounted も使用可
  return { /* state・getter・action */ }
})
```

## コンポーネントでの利用

親コンポーネント（provide 側）は `provideXxxStore()` の1行で「provide + 自分でも使う」が完結する。

```ts
// 旧: const store = useXxxStore() + provide(XXX_STORE_KEY, store) の2行
const store = provideXxxStore()
```

子コンポーネント（inject 側）は `useXxxStore()` を呼ぶだけ。実例: `components/organisms/Schedule/ShiftBoard/index.vue:53-58`（3ストアを provide）。

## テストパターン

### ストア単体テスト: `mountWithSetup` ローカルヘルパー

`provideStore` / `useStore` は setup() 外で呼べないため、テストからの直呼びは不可。`describe` 内にローカルヘルパーを定義し、アドホックコンポーネントの setup() 内から呼んで返り値を capture する（参考: `composables/shared/store/__tests__/defineScopedStore.test.ts:8-18`、`useShiftBoardConfigStore.test.ts:38-50`）。

```ts
// setup() の中で provideXxxStore を呼び出すためのアドホックコンポーネント
// NOTE: provide は setup() の中でしか使えないため、テストではコンポーネントをマウントする形を取る
const mountWithSetup = async <T>(setupFn: () => T): Promise<T> => {
  let captured!: T
  const Component = defineComponent({
    setup() {
      captured = setupFn()
    },
    template: '<div />',
  })
  await mountSuspended(Component)
  return captured
}

// 各 it() 内
const store = await mountWithSetup(() => provideXxxStore())
```

- ヘルパーは **export しない・`test/utils` へ昇格しない**（テストファイルでの export 禁止規約があり、実需要が出るまでローカル維持の方針）
- `mountWithSetup` が async のため、同期だった `it()` も async 化が必要
- 副次効果: 直呼び時代に出ていた「setup() 外での `onUnmounted` 呼び出し」の Vue warn が解消される

### `useNuxtApp` 依存ストアのテスト（providePlugins + spy）

`mountSuspended` は NuxtRoot 内部で実 `useNuxtApp()`（`deferHydration` 等）を要求するため、**`mockNuxtImport('useNuxtApp', ...)` による丸ごと差し替えと併用できない**（全テストが落ちる）。ストアが `$toastNext` / `$bugsnag` に依存する場合は以下のパターンを使う（参考: `useShiftBoardConfigStore.test.ts:19-26`）。

```ts
providePlugins() // ~/test/utils/ProvidePlugins（default export）
const { $toastNext, $bugsnag } = useNuxtApp()
const toastNextErrorMock = vi.spyOn($toastNext, 'error').mockImplementation(() => {})
const bugsnagNotifyMock = vi.spyOn($bugsnag, 'notify').mockImplementation(() => {})
```

`vi.clearAllMocks()` は呼び出し履歴のみクリアし mockImplementation は維持されるため、`beforeEach` と共存できる。

**注意**: ストアが `useNuxtApp` 非依存なら `providePlugins` / spy は追加しない（`useScheduleListStore.test.ts` が例）。兄弟テストからのカーゴカルト移植をしないこと。

### 親コンポーネントのテスト: `provideStore` のみ差し替え

`vi.mock` + `importOriginal` で actual を spread し、コンポーネントが呼ぶ `provideXxxStore` だけをフェイクファクトリに差し替える。他の export（定数等）は本物を維持できる（参考: `ShiftBoard/__tests__/index.test.ts:35-48`）。

```ts
// useXxxStore（useStore 側）は本物を維持しつつ、親が呼ぶ provideXxxStore のみ差し替える
vi.mock('~/composables/stores/schedules/useXxxStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/composables/stores/schedules/useXxxStore')>()
  return {
    ...actual,
    provideXxxStore: () => ({ /* フェイクストア */ }),
  }
})
```

## 既存ストアの移行チェックリスト

手書き provide/inject や Pinia `defineStore` から移行する際は、以下を順に確認する。

1. 型 export（`ReturnType` 型）と `InjectionKey` の外部参照を grep で確認してから削除する
2. `inject(KEY, フォールバック, true)` のフォールバック生成に依存する消費者がいないか確認する（`useStore` は throw するため挙動が変わる）
3. テスト等が import している他の export（定数など）は維持する（例: `SCHEDULE_LIST_IDS_CHUNK_SIZE`）
4. ストア単体テストは `mountWithSetup` パターンへ全面書き換えになる

## 既存ストアへの併存追加パターン

前節の「移行チェックリスト」は旧経路を廃して丸ごと差し替える想定だが、旧・手書き `InjectionKey` の inject が多数のコンポーネントに広がっており一気に置換できない場合、**旧経路を残したまま同一ファイル末尾に `defineScopedStore` を追加して新機能サブツリーだけ scoped 版を使う**という併存運用も有効。実装コストが局所化され、新機能の開発中は旧経路のリグレッションゼロを保てる。

代償として、同じ状態を持つ「別チャネル」のストアが2つ並走する（片方の provide が届く場所と、もう片方の provide が届く場所は独立）。全体最終形は片チャネルへの統合を狙うが、その時期は別途判断する。

### 実装形

`UseHolidaysStore.ts` の末尾がお手本。冒頭の手書き `InjectionKey` はレガシー扱いの JSDoc を添えたうえで残し、ファイル末尾に `defineScopedStore` を1ブロック追加する。

```ts
/**
 * 祝日ストアの手動 InjectionKey（レガシー）。
 * ファイル末尾の useHolidaysScopedStore/provideHolidaysScopedStore（defineScopedStore）とは
 * 内部でそれぞれ別の Symbol を生成する別チャネルであり、ラベル文字列が近くても連動しない。
 */
export const HOLIDAY_STORE_KEY: InjectionKey<HolidaysStore> = Symbol('holidayStore')

export const useHolidaysStore = () => {
  /* 既存実装をそのまま維持 */
}

export type HolidaysStore = ReturnType<typeof useHolidaysStore>

// HOLIDAY_STORE_KEY（手動 InjectionKey）とは別チャネル
export const {
  useStore: useHolidaysScopedStore,
  provideStore: provideHolidaysScopedStore,
} = defineScopedStore('HolidaysScopedStore', useHolidaysStore)
```

### Symbol(key) は毎回別チャネル

`defineScopedStore` は内部で `Symbol(key)` を1回だけ生成して `InjectionKey` として保持する（`composables/shared/store/defineScopedStore.ts` の `Symbol(key)` 行を参照）。`Symbol(description)` は description 文字列を「識別のためのラベル」として保持するだけで、呼び出しごとに必ずユニークな Symbol を返すのが JavaScript の言語仕様（`Symbol('a') === Symbol('a')` は `false`）。したがって、旧手書き側の `Symbol('holidayStore')` と `defineScopedStore('holidayStore', ...)` は description が完全一致していても**別チャネル**であり、片方に provide しても他方の inject には届かない。ラベル文字列を近い名前にすると誤解を招くため、新チャネル側は `'HolidaysScopedStore'` のように意図的にずらす方が読者の混乱を減らせる。

### provideStore の戻り値活用

`provideStore` は setup 実行 → `provide()` → **ストアインスタンス自身を return** する（前節「基本性質」）。手書き provide 時代の `const store = useXxxStore()` + `provide(KEY, store)` の2行は、scoped 版に統一する場面では `const store = provideXxxScopedStore()` の1行にたためる。併存期間中に「旧チャネル向けの手書き provide と、新チャネル向けの provideStore を同時に走らせる」構成が必要な親コンポーネントでは、以下のように両方を並列に呼ぶ:

```ts
const holidayStore = provideHolidaysScopedStore() // 新チャネル
provide(HOLIDAY_STORE_KEY, holidayStore)          // 旧チャネル（同じインスタンスを共有）
```

### 旧 defaultFactory inject の機械置換は不可

旧経路の inject が `inject<HolidaysStore>(HOLIDAY_STORE_KEY, () => useHolidaysStore(), true)` のように defaultFactory 付きになっているケースでは、**祖先で provide されていなくてもローカル生成にフォールバックする**という緩い契約になっている。これを何も考えずに `useHolidaysScopedStore()` に置換すると、`useStore` は inject 未提供時に throw する仕様（前節「基本性質」）のため、祖先で provide していないコンポーネントで実行時エラーになる。置換時は必ず祖先の provide 有無をトレースし、必要なら祖先側に `provideHolidaysScopedStore()` を追加してから inject を置換する。

### 併存追加チェックリスト

1. ファイル冒頭の手書き `InjectionKey` 宣言に「レガシー・別チャネル」を明示する JSDoc を追加
2. ファイル末尾に `defineScopedStore` を追加し、「手動 InjectionKey とは別チャネル」の一行コメントを添える
3. 型 export（`ReturnType` 型）は旧経路がまだ使うので残す
4. 新チャネルのラベル文字列は旧 `InjectionKey` の description と意図的にずらす（例: `'holidayStore'` に対して `'HolidaysScopedStore'`）
5. `useXxxStore` を直接呼ぶ既存の単体テストは書き換え不要
6. `vi.mock` で全 export を差し替えるモックファイルがある場合、新 scoped 経路の export（`useXxxScopedStore` / `provideXxxScopedStore`）もモック側で同型に提供する（未対応だと下流テストが落ちる）

## 参考実装

- 本体: `composables/shared/store/defineScopedStore.ts`（TSDoc に引数あり/なし両方の @example あり）
- 本体テスト: `composables/shared/store/__tests__/defineScopedStore.test.ts`
- 適用例（稼働表 `/schedules/shift_board` の3ストア）:
  - `composables/stores/schedules/useShiftBoardConfigStore.ts`
  - `composables/stores/schedules/useShiftBoardTableDataStore.ts`
  - `composables/stores/schedules/useScheduleListStore.ts`
- 併存パターン適用例（旧手書き `InjectionKey` を残しつつ末尾で `defineScopedStore` を追加）:
  - `composables/stores/schedules/UseHolidaysStore.ts`
  - `composables/stores/schedules/useEditAndDetailModalStore.ts`
