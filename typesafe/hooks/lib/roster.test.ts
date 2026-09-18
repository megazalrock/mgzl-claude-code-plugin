import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BODY_CHARS, discover, MAX_ENTRIES, parseFrontmatter } from "./roster.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-roster-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let caseCounter = 0;

type Fixture = { home: string; cwd: string; installRoot: string };

function newFixture(): Fixture {
  const base = join(root, `case-${caseCounter++}`);
  const fixture = {
    home: join(base, "home"),
    cwd: join(base, "project"),
    installRoot: join(base, "installed"),
  };
  mkdirSync(join(fixture.home, ".claude", "plugins"), { recursive: true });
  mkdirSync(join(fixture.cwd, ".claude"), { recursive: true });
  mkdirSync(fixture.installRoot, { recursive: true });
  return fixture;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function writeSkill(skillsDir: string, dir: string, frontmatter: string, body = "本文です。"): void {
  mkdirSync(join(skillsDir, dir), { recursive: true });
  writeFileSync(join(skillsDir, dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

/** 1 プラグイン（demo@mkt）だけを user スコープで有効にした fixture を作る */
function singlePluginFixture(): Fixture & { skillsDir: string } {
  const fixture = newFixture();
  const installPath = join(fixture.installRoot, "demo");
  writeJson(join(fixture.home, ".claude", "settings.json"), {
    enabledPlugins: { "demo@mkt": true },
  });
  writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
    plugins: { "demo@mkt": [{ scope: "user", installPath }] },
  });
  return { ...fixture, skillsDir: join(installPath, "skills") };
}

describe("parseFrontmatter", () => {
  test("key: value を読み、引用符を外す", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: "差分をレビューする"\n---\n\n本文\n`,
    );
    expect(parsed.frontmatter.name).toBe("alpha");
    expect(parsed.frontmatter.description).toBe("差分をレビューする");
    expect(parsed.frontmatter.disableModelInvocation).toBe(false);
    expect(parsed.body).toBe("本文\n");
  });

  test("値に含まれるコロンは落とさない", () => {
    const parsed = parseFrontmatter(`---\ndescription: 使い方: bun run x.ts\n---\n本文\n`);
    expect(parsed.frontmatter.description).toBe("使い方: bun run x.ts");
  });

  test("disable-model-invocation: true を読む", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: x\ndisable-model-invocation: true\n---\n本文\n`,
    );
    expect(parsed.frontmatter.disableModelInvocation).toBe(true);
  });

  test("フロントマターが無いときは本文全体を body にする", () => {
    const parsed = parseFrontmatter(`# 見出し\n本文\n`);
    expect(parsed.frontmatter.name).toBeUndefined();
    expect(parsed.frontmatter.description).toBeUndefined();
    expect(parsed.body).toBe("# 見出し\n本文\n");
  });

  test("閉じの --- が無いときは本文を空として扱う", () => {
    const parsed = parseFrontmatter(`---\nname: alpha\ndescription: x\n`);
    expect(parsed.frontmatter.name).toBe("alpha");
    expect(parsed.body).toBe("");
  });

  test("description: >- のブロックスカラーは空白で連結する", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: >-\n  一行目です。\n  二行目です。\n---\n本文\n`,
    );
    expect(parsed.frontmatter.description).toBe("一行目です。 二行目です。");
  });

  test("description: | のブロックスカラーは改行で連結する", () => {
    const parsed = parseFrontmatter(
      `---\nname: alpha\ndescription: |\n  一行目です。\n  二行目です。\n---\n本文\n`,
    );
    expect(parsed.frontmatter.description).toBe("一行目です。\n二行目です。");
  });

  test("ブロックスカラーの直後のキーは飲み込まれず読まれる", () => {
    const parsed = parseFrontmatter(
      `---\ndescription: >-\n  説明です。\nname: alpha\n---\n本文\n`,
    );
    expect(parsed.frontmatter.description).toBe("説明です。");
    expect(parsed.frontmatter.name).toBe("alpha");
  });
});

describe("discover", () => {
  test("有効なプラグインのスキルを plugin:name で拾う", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");

    const roster = discover(fixture.cwd, { home: fixture.home });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe("demo:alpha");
    expect(roster[0]?.description).toBe("アルファをする");
    expect(roster[0]?.body).toBe("本文です。\n");
    expect(roster[0]?.path).toBe(join(fixture.skillsDir, "alpha", "SKILL.md"));
  });

  test("フロントマターに name が無ければディレクトリ名を使う", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "beta", "description: ベータをする");
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.name).toBe("demo:beta");
  });

  test("enabledPlugins は後勝ちで、settings.local.json の false が無効化する", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeJson(join(fixture.cwd, ".claude", "settings.local.json"), {
      enabledPlugins: { "demo@mkt": false },
    });
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(0);
  });

  test("プロジェクトの settings.json で有効化できる", () => {
    const fixture = newFixture();
    const installPath = join(fixture.installRoot, "demo");
    writeJson(join(fixture.cwd, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: { "demo@mkt": [{ scope: "user", installPath }] },
    });
    writeSkill(join(installPath, "skills"), "alpha", "name: alpha\ndescription: アルファをする");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(1);
  });

  test("projectPath が cwd に一致するエントリを採用する", () => {
    const fixture = newFixture();
    const mine = join(fixture.installRoot, "mine");
    const other = join(fixture.installRoot, "other");
    writeJson(join(fixture.home, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: {
        "demo@mkt": [
          { scope: "local", projectPath: join(fixture.installRoot, "elsewhere"), installPath: other },
          { scope: "local", projectPath: fixture.cwd, installPath: mine },
        ],
      },
    });
    writeSkill(join(mine, "skills"), "alpha", "name: mine\ndescription: こちらを拾う");
    writeSkill(join(other, "skills"), "alpha", "name: other\ndescription: 拾わない");
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.name).toBe("demo:mine");
  });

  test("scope も projectPath も一致しなければそのプラグインを読み飛ばす", () => {
    const fixture = newFixture();
    const other = join(fixture.installRoot, "other");
    writeJson(join(fixture.home, ".claude", "settings.json"), {
      enabledPlugins: { "demo@mkt": true },
    });
    writeJson(join(fixture.home, ".claude", "plugins", "installed_plugins.json"), {
      plugins: {
        "demo@mkt": [
          { scope: "local", projectPath: join(fixture.installRoot, "elsewhere"), installPath: other },
        ],
      },
    });
    writeSkill(join(other, "skills"), "alpha", "name: other\ndescription: 拾わない");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(0);
  });

  test("disable-model-invocation: true と description 欠落を除外する", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeSkill(
      fixture.skillsDir,
      "hidden",
      "name: hidden\ndescription: 隠す\ndisable-model-invocation: true",
    );
    writeSkill(fixture.skillsDir, "nodesc", "name: nodesc");

    const names = discover(fixture.cwd, { home: fixture.home }).map((entry) => entry.name);
    expect(names).toEqual(["demo:alpha"]);
  });

  test("ユーザーとプロジェクトのスキルはプレフィックスなしで拾う", () => {
    const fixture = newFixture();
    writeSkill(join(fixture.home, ".claude", "skills"), "u", "name: user-skill\ndescription: ユーザー");
    writeSkill(join(fixture.cwd, ".claude", "skills"), "p", "name: proj-skill\ndescription: プロジェクト");

    const names = discover(fixture.cwd, { home: fixture.home }).map((entry) => entry.name);
    expect(names).toEqual(["user-skill", "proj-skill"]);
  });

  test("同名は先に見つかったものを残す", () => {
    const fixture = newFixture();
    writeSkill(join(fixture.home, ".claude", "skills"), "dup", "name: dup\ndescription: ユーザー側");
    writeSkill(join(fixture.cwd, ".claude", "skills"), "dup", "name: dup\ndescription: プロジェクト側");

    const roster = discover(fixture.cwd, { home: fixture.home });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.description).toBe("ユーザー側");
  });

  test("body は先頭 1600 文字で打ち切る", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "long", "name: long\ndescription: 長い", "あ".repeat(3000));
    expect(discover(fixture.cwd, { home: fixture.home })[0]?.body.length).toBe(BODY_CHARS);
  });

  test("255 件を超えたら先頭 255 件で打ち切る", () => {
    const fixture = singlePluginFixture();
    for (let i = 0; i < MAX_ENTRIES + 45; i++) {
      writeSkill(fixture.skillsDir, `s${String(i).padStart(4, "0")}`, `name: s${i}\ndescription: d${i}`);
    }
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(MAX_ENTRIES);
  });

  test("設定ファイルが無くても例外にならず空を返す", () => {
    const fixture = newFixture();
    expect(discover(fixture.cwd, { home: fixture.home })).toEqual([]);
  });

  test("壊れた JSON の設定は読み飛ばす", () => {
    const fixture = singlePluginFixture();
    writeSkill(fixture.skillsDir, "alpha", "name: alpha\ndescription: アルファをする");
    writeFileSync(join(fixture.cwd, ".claude", "settings.json"), "{ broken");
    expect(discover(fixture.cwd, { home: fixture.home })).toHaveLength(1);
  });
});
