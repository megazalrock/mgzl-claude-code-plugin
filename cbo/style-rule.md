# style-rule（コーディングスタイル規約）

> `reviewer-for-style` エージェントから抽出した、コードの「書き方」に関する規約。
> 対象は Vue 3 + TypeScript フロントエンドコードベース。
> **適用方法は未確定で、一旦この文書に保管しているだけ**（後で取捨選択する）。
>
> ここで扱うのは「どう書くか」（共有コンポーネントの利用・CSS 規約・命名・配置・コードサイズ・TypeScript の書式）であり、
> ロジックの正当性・責務分離・セキュリティ・パフォーマンスは対象外とする。

## 1. 共有コンポーネント・CSS/SCSS 規約

- 利用可能なプロジェクト固有の共有コンポーネントがある場合は、自前で同等品を作らず共有コンポーネントを使う。
- プロジェクトの CSS/SCSS 規約（セレクタの書き方、スコープ、宣言順序）に従う。

## 2. コードサイズの基準

以下は**数値的な目安**であり、超過したら「分割の候補」として扱う。責務分離の良し悪し（設計の領域）はここでは判断しない。サイズのシグナルだけを見る。

- **関数 50 行**を超える → 分割候補
- **ファイル 400 行**を超える → 分割候補
- **ネスト 4 段**を超える → early-return / ガード節を検討する

## 3. 命名規約

以下の命名規約はプロジェクトのために定めたもの。ここに無い独自規則を勝手に増やさない。

### コンポーネント

- **形式**: PascalCase
- **例**: `OrderList.vue`, `ScheduleForm.vue`

### API 関数

- **形式**: `Use` 接頭辞
- **例**: `UseGetOrders.ts`, `UseUpdateSchedule.ts`

### ストア

- **形式**: `Use*Store.ts`
- **例**: `UseIndexStore.ts`, `UseOrderStore.ts`

### 型

- **配置**: `types/` 配下に、ドメイン単位で整理する
- **分離**: API レスポンス型・フォーム型・業務ロジック型は、それぞれ別に定義する

### boolean を返す関数

- **引数なし**: `is` で始める — 例: `isValid()`, `isEmpty()`, `isActive()`
- **引数あり**: `getIs` で始める — 例: `getIsValid(value)`, `getIsEmpty(array)`, `getIsActive(status)`

### Vue イベントハンドラ

- **形式**: `handle` で始める — 例: `handleClick()`, `handleSubmit()`, `handleChange()`

### boolean 変数

- **形式**: `is` で始める — 例: `isSuccess`, `isLoading`

## 4. ディレクトリ配置

- ファイルはプロジェクトのアーキテクチャ規約（`pages/`, `api/`, `types/` など）に従って配置する。配置がそのファイルの目的と合っていない場合は問題として扱う。

## 5. TypeScript 整形ルール

以下はコードの「書き方」に関する規約。依存関係の管理や例外処理に関するルールは対象外（別の領域で扱う）。

### ベース設定

- プロジェクトは `@tsconfig/strictest` を使用する。strict モード由来のシグナル（暗黙の any、未使用ローカル変数など）は、書き方のシグナルとして扱う。

### 制御構文は必ずブロック文を使う

`if` などの制御構文は波括弧 `{}` を使う。

```typescript
// Good
if (isOk) {
  return
}
```

### ネスト三項演算子の禁止

三項演算子のネスト（三項の中の三項）は可読性を著しく損なうため禁止。`if-else` や early-return を使う。

```typescript
// Bad
const result = a ? (b ? 'x' : 'y') : 'z'

// Good
if (a && b) {
  return 'x'
}
if (a) {
  return 'y'
}
return 'z'
```

### 引数が 2 つ以上ならオブジェクトで受ける

関数が 2 つ以上の引数を取る場合は、変更に強くするためオブジェクトで受け取る。

```typescript
// Bad
const add = (a: number, b: number) => a + b

// Good
const add = ({ a, b }: { a: number; b: number }) => a + b

// Good
type AddParams = { a: number; b: number }
const add = ({ a, b }: AddParams) => a + b
```

### 制限機能: `!`, `as`, `any`

以下の機能は避ける。使う場合は**なぜ必要かをコメントで残す**こと。

- `!`（非 null アサーション）
- `as`（型アサーション）
- `any` 型

コメント付きで許容される使用例:

```typescript
// このスコープの手前で null チェック済みのため `!` は許容
const value = foo.bar!
```

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 無効化する理由
const data: any = fetchData()
```

`!`・`as`・`any` が理由コメントなしで使われている場合は問題として扱う。

### 型定義の配置

- 型定義ファイルは `types/` ディレクトリ配下に置く。