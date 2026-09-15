/**
 * prh 辞書と textlint プリセット ja-technical-writing が正面衝突するルールを洗い出す。
 * 衝突したルールの expected を rules/prh.yml の ignoreRules 自動生成区間へ書き出す。
 *
 * 衝突とは「prh が要求する置換後の表記そのものを ja-technical-writing が指摘する」状態を指す。
 * この状態ではどちらの表記で書いても差し戻され、書き手に選べる表記が残らない。
 * 「衝突したら ja-technical-writing を優先する」という方針に従い、prh 側を落とす。
 *
 * 実行: bun run ja-lint/scripts/generate-prh-ignore-rules.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TextlintKernelDescriptor, type TextlintKernelRule } from "@textlint/kernel";
import { moduleInterop } from "@textlint/module-interop";

/** prh が同梱する技術書向け辞書。rules/prh.yml が imports で読み込んでいる実体 */
const DICTIONARY_PATH = fileURLToPath(
  new URL("../node_modules/prh/prh-rules/media/WEB+DB_PRESS.yml", import.meta.url),
);

const PRH_YML_PATH = fileURLToPath(new URL("../rules/prh.yml", import.meta.url));

const BEGIN_MARKER = "      # >>> ここから自動生成";
const END_MARKER = "      # <<< ここまで自動生成";

/**
 * 衝突判定に使う ja-technical-writing のルール名。
 *
 * 判定対象は prh の expected（「ユーザー」「バックアップ」などの単語断片）であって文ではない。
 * 全ルールで lint すると、文章構造を見るルールが断片を相手に総当たりで反応する。
 * 実測では ja-no-mixed-period が 1017 件中 686 件に反応し、辞書がほぼ全滅した。
 * そのため、文脈を持たない断片だけで可否を判定できる表記・字種の正規化ルールに絞る。
 *
 * この絞り込みで実際に反応したのは arabic-kanji-numbers の 3 件だけである（実測）。
 * 残りは将来の辞書更新やプリセット更新で衝突しうるため、先回りで入れてある。
 *
 * 除外したうち ja-no-successive-word（同語の連続）は語の重複を嫌うルールであり、
 * 表記の正規化ではないため判定には使わない。
 * このルールが反応する辞書ルールは arabic-kanji-numbers 側でも反応し、結果は変わらない。
 */
const NORMALIZATION_RULE_NAMES: ReadonlySet<string> = new Set([
  "arabic-kanji-numbers",
  "no-nfd",
  "no-hankaku-kana",
  "ja-unnatural-alphabet",
  "no-zero-width-spaces",
  "no-invalid-control-character",
]);

type Preset = {
  rules: Record<string, unknown>;
  rulesConfig: Record<string, unknown>;
};

function isPreset(value: unknown): value is Preset {
  return (
    typeof value === "object" &&
    value !== null &&
    "rules" in value &&
    "rulesConfig" in value &&
    typeof value.rules === "object"
  );
}

/** 表記正規化系のルールだけを載せた linter を組み立てる */
async function buildNormalizationLinter() {
  const [presetModule, textPluginModule, textlint] = await Promise.all([
    import("textlint-rule-preset-ja-technical-writing"),
    import("@textlint/textlint-plugin-text"),
    import("textlint"),
  ]);

  const preset = moduleInterop(presetModule.default ?? presetModule);
  if (!isPreset(preset)) {
    throw new Error("ja-technical-writing プリセットの形が想定と違う");
  }

  const rules: TextlintKernelRule[] = [];
  for (const [name, rule] of Object.entries(preset.rules)) {
    if (!NORMALIZATION_RULE_NAMES.has(name)) continue;
    rules.push({
      ruleId: `ja-technical-writing/${name}`,
      // as: kernel の TextlintRuleModule 型は各ルールの実体型を保持しないため、
      // プリセットから取り出した値を渡すときに型情報を落とす必要がある
      rule: rule as TextlintKernelRule["rule"],
      options: preset.rulesConfig[name] as TextlintKernelRule["options"],
    });
  }

  const descriptor = new TextlintKernelDescriptor({
    rules,
    filterRules: [],
    plugins: [
      {
        pluginId: "text",
        // as: plugin モジュールの型は動的 import では解決できないため受け渡しのときに落とす
        plugin: moduleInterop(textPluginModule.default ?? textPluginModule) as never,
        options: true,
      },
    ],
  });
  return textlint.createLinter({ descriptor });
}

/**
 * 辞書の全ルールの expected を lint し、指摘の出た expected を重複なく返す。
 * 返る文字列はそのまま ignoreRules の expected として使える。
 */
export async function collectConflictingExpectations(): Promise<string[]> {
  const prh = await import("prh");
  const engine = prh.fromYAMLFilePath(DICTIONARY_PATH);
  const linter = await buildNormalizationLinter();

  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const rule of engine.rules) {
    const expected = rule.expected;
    // $1 などの後方参照を含む expected は、単独では置換後の文字列が確定しない。
    // プレースホルダのまま lint すると、実際には現れない文字列を判定してしまうので除く。
    // 辞書側で後方参照を持つのは送りがなや活用語尾を受けるルールに限られる。
    // 表記正規化ルールが見る漢数字・全角半角・字種の並びは定数の部分に現れるため、
    // 除いても取りこぼしは起きない（実測: 除いた 275 件に該当する並びはなかった）。
    if (/\$\d/.test(expected)) continue;
    if (seen.has(expected)) continue;
    const result = await linter.lintText(expected, "/ja-lint/input.txt");
    if (result.messages.length === 0) continue;
    seen.add(expected);
    conflicts.push(expected);
  }
  return conflicts;
}

/** ignoreRules の自動生成区間の中身をマーカー込みで組み立てる */
export function renderGeneratedBlock(expectations: string[]): string {
  const lines = [
    BEGIN_MARKER,
    "      # ja-technical-writing と正面衝突する辞書ルール。",
    "      # scripts/generate-prh-ignore-rules.ts の出力で置き換わる",
    ...expectations.map((expected) => `      - expected: ${expected}`),
    END_MARKER,
  ];
  return lines.join("\n");
}

/** prh.yml の自動生成区間だけを差し替える。手書きの ignoreRules と rules はそのまま残す */
export function replaceGeneratedBlock(yaml: string, block: string): string {
  const begin = yaml.indexOf(BEGIN_MARKER);
  const end = yaml.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    throw new Error(`${PRH_YML_PATH} に自動生成区間のマーカーが見当たらない`);
  }
  return yaml.slice(0, begin) + block + yaml.slice(end + END_MARKER.length);
}

if (import.meta.main) {
  const expectations = await collectConflictingExpectations();
  const yaml = readFileSync(PRH_YML_PATH, "utf8");
  writeFileSync(PRH_YML_PATH, replaceGeneratedBlock(yaml, renderGeneratedBlock(expectations)));
  console.log(`conflicts=${expectations.length}`);
  for (const expected of expectations) {
    console.log(`expected=${expected}`);
  }
}
