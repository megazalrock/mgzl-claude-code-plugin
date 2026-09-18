import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir);
const REPO_ROOT = join(import.meta.dir, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

describe("typesafe のマニフェスト", () => {
  test("plugin.json は name / description / author を持ち version を持たない", async () => {
    const plugin = await readJson(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));
    expect(plugin).toMatchObject({ name: "typesafe", author: { name: "otto" } });
    expect(JSON.stringify(plugin)).not.toContain('"version"');
  });

  test("hooks.json は UserPromptSubmit に suggest-skill.ts を timeout 10 で登録する", async () => {
    const hooks = await readJson(join(PLUGIN_ROOT, "hooks", "hooks.json"));
    expect(hooks).toMatchObject({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'bun run "${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skill.ts"',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
  });

  test("marketplace.json の plugins に typesafe が含まれる", async () => {
    const marketplace = await readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json"));
    expect(marketplace).toMatchObject({
      plugins: expect.arrayContaining([
        expect.objectContaining({ name: "typesafe", source: "./typesafe" }),
      ]),
    });
  });
});
