import { fileURLToPath } from "node:url";
import type { TextlintKernelDescriptor, TextlintKernelRule } from "@textlint/kernel";
import type { TargetContext } from "./commands.ts";

/**
 * severity オプションが効かないルールの ruleId 集合。
 * ai-tech-writing-guideline は RuleError ではなくプレーンオブジェクトで報告するため、
 * textlint 側で severity が error に固定される。info 扱いはこちらで判定する。
 */
export const INFO_RULE_IDS: ReadonlySet<string> = new Set(["ai-writing/ai-tech-writing-guideline"]);

// fileURLToPath でデコードする: pathname はパーセントエンコードされたままなので、
// プラグインのインストール先パスに空白等が含まれると prh の rulePaths が読めなくなり lint 全体が黙って無効化される
const PRH_PATH = fileURLToPath(new URL("../../rules/prh.yml", import.meta.url));

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

/**
 * プリセットを kernel が受け取れる TextlintKernelRule[] に展開する。
 * @textlint/kernel はプリセットを解釈しないため、ここで自前で展開する必要がある。
 * overrides に false を指定したルールは配列に入れないことで無効化する。
 */
function expandPreset(
  namespace: string,
  presetModule: unknown,
  overrides: Record<string, unknown>,
  interop: <T>(m: T) => T,
): TextlintKernelRule[] {
  const preset = interop(presetModule);
  if (!isPreset(preset)) return [];
  const rules: TextlintKernelRule[] = [];
  for (const [name, rule] of Object.entries(preset.rules)) {
    const options = name in overrides ? overrides[name] : preset.rulesConfig[name];
    if (options === false) continue;
    rules.push({
      ruleId: `${namespace}/${name}`,
      // as: kernel の TextlintRuleModule 型は各ルールの実体型を保持しないため、
      // 動的 import した値をここで受け渡す際に型情報を落とす必要がある
      rule: rule as TextlintKernelRule["rule"],
      options: options as TextlintKernelRule["options"],
    });
  }
  return rules;
}

/** 文脈ごとの descriptor を組み立てる。textlint 系は起動コスト回避のため動的 import する */
export async function buildDescriptor(context: TargetContext): Promise<TextlintKernelDescriptor> {
  const [
    kernel,
    interopModule,
    textPluginModule,
    markdownPluginModule,
    jaTechModule,
    aiWritingModule,
    prhModule,
  ] = await Promise.all([
    import("@textlint/kernel"),
    import("@textlint/module-interop"),
    import("@textlint/textlint-plugin-text"),
    import("@textlint/textlint-plugin-markdown"),
    import("textlint-rule-preset-ja-technical-writing"),
    import("@textlint-ja/textlint-rule-preset-ai-writing"),
    import("textlint-rule-prh"),
  ]);

  const interop = interopModule.moduleInterop;

  /** Markdown として解析され、地の文が散文として書かれる文脈か */
  const isProse = context === "pr" || context === "markdown";

  // 句点は PR 本文と Markdown ファイルだけで必須にする。コメントやコミットメッセージでは名詞で終わる書き方を許す
  const jaOverrides: Record<string, unknown> = isProse ? {} : { "ja-no-mixed-period": false };

  // Markdown 構造を前提とする 4 ルールは、コメントやコミットメッセージでは誤検知になる
  const aiOverrides: Record<string, unknown> = isProse
    ? {}
    : {
        "no-ai-list-formatting": false,
        "no-ai-emphasis-patterns": false,
        "no-ai-colon-continuation": false,
        "ai-tech-writing-guideline": false,
      };

  const rules: TextlintKernelRule[] = [
    ...expandPreset(
      "ja-technical-writing",
      jaTechModule.default ?? jaTechModule,
      jaOverrides,
      interop,
    ),
    ...expandPreset("ai-writing", aiWritingModule.default ?? aiWritingModule, aiOverrides, interop),
    {
      ruleId: "prh",
      // as: interop の戻り値は型情報を持たないが、kernel は具体的な TextlintKernelRule["rule"] 型を要求するため
      rule: interop(prhModule.default ?? prhModule) as TextlintKernelRule["rule"],
      options: { rulePaths: [PRH_PATH] },
    },
  ];

  return new kernel.TextlintKernelDescriptor({
    rules,
    filterRules: [],
    plugins: [
      {
        pluginId: "text",
        // as: plugin モジュールの型は動的 import では解決できないため受け渡し時に落とす
        plugin: interop(textPluginModule.default ?? textPluginModule) as never,
        options: true,
      },
      {
        pluginId: "markdown",
        // as: plugin モジュールの型は動的 import では解決できないため受け渡し時に落とす
        plugin: interop(markdownPluginModule.default ?? markdownPluginModule) as never,
        options: true,
      },
    ],
  });
}
