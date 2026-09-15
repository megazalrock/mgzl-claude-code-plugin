/**
 * 自前の prh 辞書の expected が、textlint プリセット ja-technical-writing の
 * 表記正規化ルールに指摘されないことを検査する。
 *
 * 衝突とは「prh が要求する置換後の表記そのものを ja-technical-writing が指摘する」状態を指す。
 * この状態ではどちらの表記で書いても差し戻され、書き手に選べる表記が残らない。
 * 辞書へルールを足すときの安全装置として使う。
 *
 * 実行: bun ja-lint/scripts/check-prh-conflicts.ts
 */
import { fileURLToPath } from "node:url";
import { TextlintKernelDescriptor, type TextlintKernelRule } from "@textlint/kernel";
import { moduleInterop } from "@textlint/module-interop";

/** ja-lint が使う自前の校正辞書 */
const DICTIONARY_PATH = fileURLToPath(new URL("../rules/prh.yml", import.meta.url));

/**
 * 衝突判定に使う ja-technical-writing のルール名。
 *
 * 判定対象は prh の expected（「ユーザー」「バックアップ」などの単語断片）であって文ではない。
 * 全ルールで lint すると、文章構造を見るルールが断片を相手に総当たりで反応する。
 * そのため、文脈を持たない断片だけで可否を判定できる表記・字種の正規化ルールに絞る。
 *
 * 除外したうち ja-no-successive-word（同語の連続）は語の重複を嫌うルールであり、
 * 表記の正規化ではないため判定には使わない。
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

/** 辞書の全ルールの expected を重複なく返す */
export async function readDictionaryExpectations(): Promise<string[]> {
  const prh = await import("prh");
  const engine = prh.fromYAMLFilePath(DICTIONARY_PATH);
  return [...new Set(engine.rules.map((rule) => rule.expected))];
}

/** 渡した expected のうち、表記正規化ルールに指摘されるものを重複なく返す */
export async function findConflictingExpectations(expectations: string[]): Promise<string[]> {
  const linter = await buildNormalizationLinter();

  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const expected of expectations) {
    // $1 などの後方参照を含む expected は、単独では置換後の文字列が確定しない。
    // プレースホルダのまま lint すると、実際には現れない文字列を判定してしまうので除く。
    // 辞書側で後方参照を持つのは送りがなや活用語尾を受けるルールに限られ、
    // 表記正規化ルールが見る漢数字・全角半角・字種の並びは定数の部分に現れる。
    if (/\$\d/.test(expected)) continue;
    if (seen.has(expected)) continue;
    const result = await linter.lintText(expected, "/ja-lint/input.txt");
    if (result.messages.length === 0) continue;
    seen.add(expected);
    conflicts.push(expected);
  }
  return conflicts;
}

/** 辞書を読み込み、衝突する expected の一覧を返す */
export async function collectConflictingExpectations(): Promise<string[]> {
  return findConflictingExpectations(await readDictionaryExpectations());
}

if (import.meta.main) {
  const expectations = await collectConflictingExpectations();
  for (const expected of expectations) {
    console.log(`expected=${expected}`);
  }
  console.log(`conflicts=${expectations.length}`);
  if (expectations.length > 0) {
    process.exit(1);
  }
}
