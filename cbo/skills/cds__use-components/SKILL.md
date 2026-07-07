---
name: cds:use-components
description: CraftBank Design System (CDS) の Cb* コンポーネントを使って、消費側アプリ(arrangement-front 等)の UI を Vue SFC で実装する。環境変数 CDS_REPO_PATH のカタログ→guide.md→spec.yaml を辿って最適な released コンポーネントを選定し、status(使用可/開発中/提案中/廃止)・利用ルール・禁止事項・a11y を守って実装する。自前の HTML/SVG を書かず既存の Cb* を優先し、@craftbank/design-system から named import する。「CDSで実装して」「Cbコンポーネントで作って」「デザインシステムのコンポーネントで」「@craftbank/design-system で作って」などの依頼時に使用する。
argument-hint: [実装したいUIの説明]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# cds:use-components

消費側アプリ (主に `arrangement-front`, Nuxt 3) の UI を、CraftBank Design System (CDS) の `Cb*` コンポーネントで実装するスキル。手書きの HTML/SVG を積み上げる前に、まず「使える既存コンポーネントはどれか」をカタログとガイドから突き止め、その利用ルールに沿って組み立てる。

## なぜこの手順が要るのか

素朴に「ボタンなら `CbButton` を import」とやると事故る。理由は 3 つ:

1. **使えるのはごく一部**。全 80 超のうち `status: released`(使用可)は十数件だけで、大多数は `proposed`(実装未着手)や `wip`(開発中・本番非推奨)。名前があっても本番で使えるとは限らない。例えば `CbButton` は現状 `wip`。status を確認せずに import すると、未実装・非推奨のものを掴む。
2. **コンポーネントごとに守るべき利用ルール・禁止事項・a11y がある**。「`src` を渡すなら `alt` 必須」「アイコン単独なら `CbIconButton` + `aria-label`」「inline `<svg>` 禁止、アイコンは必ず `CbIcon`」など。これらは各 `guide.md` にあり、守らないと DS が担保する一貫性・アクセシビリティが崩れる。
3. **選択肢が紛らわしい**。`CbButton` / `CbIconButton` / `CbTextButton`、`CbAvatar` / `CbUserName` のように役割が近いものは、各 guide の「いつ使う / いつ使わない」で使い分けが決まっている。

だから「探す → status を見る → guide を読む → ルールごと実装する」を毎回踏む。

## 前提: CDS_REPO_PATH

`spec.yaml` / `guide.md` / カタログは DS リポジトリの **ソース (`src/`, `.claude/docs/`) にしか無く、配布物 `@craftbank/design-system` (dist) には含まれない**。よって DS リポジトリをローカルに持ち、その場所を環境変数 `CDS_REPO_PATH` で指す必要がある。

最初に必ず確認する:

```bash
echo "CDS_REPO_PATH=${CDS_REPO_PATH:-（未設定）}"
```

未設定・存在しない場合は、その旨を伝えて `export CDS_REPO_PATH=/path/to/craftbank-design-system` の設定を促し、**推測でパスを埋めずに停止する**。以降、参照パスはすべて `$CDS_REPO_PATH` 起点。

補足: **環境変数は Bash の呼び出しごとにリセットされ、`export` は次のコマンドへ引き継がれない**（ツール実行が別プロセスのため）。一度確認できたパスは、各コマンドで絶対パスを直接使うか、コマンド先頭に付けて渡す（例: `CDS_REPO_PATH=/path/to/craftbank-design-system grep -n "status:" "$CDS_REPO_PATH"/src/...`）。「`export` したのに次のコマンドで空になる」で足を取られないこと。

## ワークフロー

### Step 1: UI 要件をキーワード化

実装したい UI を、探索に使う語に落とす。例: 「ユーザーのアイコンと名前」→ avatar / user / アバター、「保存ボタン」→ button / 送信、「削除アイコンのボタン」→ icon button / 削除。

### Step 2: カタログで候補を探す

`$CDS_REPO_PATH/.claude/docs/component-catalog.md` が全コンポーネントの機械可読インデックス (Status・Props・型・用途)。ここをキーワードで検索して候補を挙げる。

```bash
grep -n -i -e "アバター" -e "avatar" "$CDS_REPO_PATH/.claude/docs/component-catalog.md"
```

用途行 (「用途: …」) と Props を見て、当たりを付ける。近い候補が複数あるときは Step 4 の guide 「いつ使う / いつ使わない」で絞る。

### Step 3: status を確認する（最重要）

候補の `status` を **単一ソースである spec.yaml** で確認する。本番採用してよいのは `released` のみ。

```bash
grep -n "status:" "$CDS_REPO_PATH"/src/components/*/<Name>/<Name>.spec.yaml
```

- `released`(🟢 使用可) のみ本番採用してよい。
- `wip`(🟡 開発中) / `proposed`(🔵 提案中) / `deprecated`(🔴 廃止) は **本番実装に使用禁止**。とくに `wip` は実装が存在し `import` できてしまうが、API・見た目・存在自体が未確定なので使わない（`proposed` は未実装、`deprecated` は廃止）。
- 該当しそうな候補がこれらの status だった場合は握りつぶさず、「`CbXxx` は status:○○ のため本番採用不可」とユーザーに報告し、released の代替を探す。released の代替が無ければ **手書きで似せて作らず、実装を保留して DS 側のギャップとして伝え、判断を仰ぐ**。wip を「注意書きつきで使う」といった妥協もしない。

### Step 4: guide.md と spec.yaml で使い方を確定する

採用するコンポーネントについて、隣接する 2 ファイルを読む:

- `<Name>.guide.md` — 用途 / いつ使う / いつ使わない / **利用ルール** / **禁止事項** / アクセシビリティ / ペルソナ別考慮 / 関連。ここが実装の指針の本体。
- `<Name>.spec.yaml` — `status` と Props/Events/Slots/型の要点。Props の正確な名前・型・required・default はカタログまたは spec で確定する。

guide の「いつ使わない」に自分のケースが載っていたら、そこで指定された別コンポーネントに乗り換える。

### Step 5: 実装する

- import は配布パッケージから named import: `import { CbAvatar, CbUserName } from '@craftbank/design-system'`。DS リポジトリの `src/` を直接 import しない。
- Props は spec/カタログの型どおりに渡す。union 型は列挙値のみ。required を満たす。
- guide の **利用ルール・禁止事項をすべて満たす**。典型例:
  - inline `<svg>` を書かない → アイコンは `CbIcon` / `CbIconButton` 経由。
  - 画像 (`src`) には `alt` を付ける。アイコン単独ボタンには `aria-label`。
  - `size` 等の固定値制約を `style="width:…"` で上書きしない。
  - フォーム内のボタンは `type` を明示 (`submit`/`button`)。API 通信や router 遷移はコンポーネントに書かず emit で親に委ねる。
- ペルソナ別考慮 (現場作業員=大きめ, PC 事務=小さめ 等) がある場合は文脈に合うサイズを選ぶ。判断材料が無ければ既定値を使い、その旨を一言添える。

### Step 6: コンポーネントで賄えないカスタム UI

余白・色・枠線などを自前で書く部分は、hex 直書きせず CSS 変数を使う。一覧は `$CDS_REPO_PATH/.claude/docs/token-catalog.md`。

```vue
<style scoped>
.panel { padding: var(--cb-space-md); background: var(--cb-color-neutral-100); }
</style>
```

### Step 7: 該当コンポーネントが無いとき

released に適切なものが無ければ、手書きで似せて作らない。「この UI に対応する released コンポーネントは無い（近いのは `CbXxx` だが status:proposed）」と報告し、判断を仰ぐ。既存 UI 断片の再発明を避けるのが DS の原則。

## 出力形式

実装コード (Vue SFC など) に加えて、末尾に簡潔な採用理由メモを付ける。冗長な表は使わず key=value 相当で:

```
使用コンポーネント: CbUserName (status: released)
参照ガイド: src/components/molecules/CbUserName/CbUserName.guide.md
守ったルール: src指定時のalt付与 / サイズは固定値(24px, PC一覧想定) / 自前imgを書かず CbUserName に委譲
```

status が released 以外で採用を見送った候補があれば、それも 1 行で書く（例: `見送り: CbButton (status: wip=開発中のため本番採用不可)`）。

## クイックリファレンス（$CDS_REPO_PATH 起点）

- 全コンポーネント索引（Status/Props/用途）: `.claude/docs/component-catalog.md`
- 個別の利用ルール: `src/components/<atoms|molecules|organisms>/<Name>/<Name>.guide.md`
- status と仕様の単一ソース: 同ディレクトリの `<Name>.spec.yaml`
- CSS 変数（トークン）一覧: `.claude/docs/token-catalog.md`
- consumer 側の import/セットアップ: `docs/getting-started.md`
