import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildBlock,
  buildReverseIndex,
  collectDomains,
  detectDomain,
  extractImportSpecifiers,
  formatBlocks,
  hasPagesDirectory,
  isAutoImportTarget,
  normalizeDomainName,
  parseArgs,
  parseTargetList,
  resolveSpecifier,
  sortImporters,
} from "./find-reverse-deps";

const DOMAINS = new Set(["schedule", "workflow", "attendance"]);

describe("parseArgs", () => {
  it("必須の引数をすべて受け取ると limit は既定の 10 になる", () => {
    const result = parseArgs(["--root", "/tmp/front", "--files", "/tmp/f.txt", "--out", "/tmp/o.txt"]);

    expect(result).toStrictEqual({
      ok: true,
      options: { root: "/tmp/front", filesPath: "/tmp/f.txt", outPath: "/tmp/o.txt", limit: 10 },
    });
  });

  it("--limit を指定するとその値を使う", () => {
    const result = parseArgs([
      "--root",
      "/tmp/front",
      "--files",
      "/tmp/f.txt",
      "--out",
      "/tmp/o.txt",
      "--limit",
      "3",
    ]);

    expect(result.ok && result.options.limit).toBe(3);
  });

  it("--root が無ければエラーを返す", () => {
    expect(parseArgs(["--files", "/tmp/f.txt", "--out", "/tmp/o.txt"])).toStrictEqual({
      ok: false,
      error: "missing_root",
    });
  });

  it("--limit が数値でなければエラーを返す", () => {
    const result = parseArgs([
      "--root",
      "/tmp/front",
      "--files",
      "/tmp/f.txt",
      "--out",
      "/tmp/o.txt",
      "--limit",
      "abc",
    ]);

    expect(result).toStrictEqual({ ok: false, error: "invalid_limit" });
  });
});

describe("extractImportSpecifiers", () => {
  it("import / export from・動的 import・副作用 import をすべて拾う", () => {
    const content = [
      "import { a } from '~/utils/Type'",
      'export { b } from "@/components/B.vue"',
      "const c = await import('./C')",
      "import '~/assets/style.css'",
    ].join("\n");

    expect(extractImportSpecifiers(content).sort()).toStrictEqual([
      "./C",
      "@/components/B.vue",
      "~/assets/style.css",
      "~/utils/Type",
    ]);
  });

  it("同じ指定子が複数回現れても 1 件にまとめる", () => {
    const content = ["import { a } from '~/utils/Type'", "import type { B } from '~/utils/Type'"].join("\n");

    expect(extractImportSpecifiers(content)).toStrictEqual(["~/utils/Type"]);
  });
});

describe("resolveSpecifier", () => {
  const exists = (relPath: string): boolean =>
    new Set([
      "utils/Type.ts",
      "types/Api.d.ts",
      "components/atoms/Button.vue",
      "composables/stores/index.ts",
    ]).has(relPath);

  it("~/ 始まりは root 相対として解決する", () => {
    expect(resolveSpecifier({ specifier: "~/utils/Type", importerRelPath: "pages/index.vue", exists })).toBe(
      "utils/Type.ts",
    );
  });

  it("./ 始まりは import 元のディレクトリ基準で解決する", () => {
    expect(resolveSpecifier({ specifier: "./Button.vue", importerRelPath: "components/atoms/List.vue", exists })).toBe(
      "components/atoms/Button.vue",
    );
  });

  it(".d.ts も解決候補に含む", () => {
    expect(resolveSpecifier({ specifier: "@/types/Api", importerRelPath: "pages/index.vue", exists })).toBe(
      "types/Api.d.ts",
    );
  });

  it("ディレクトリ指定は index.ts へ解決する", () => {
    expect(resolveSpecifier({ specifier: "~/composables/stores", importerRelPath: "pages/index.vue", exists })).toBe(
      "composables/stores/index.ts",
    );
  });

  it("裸のパッケージ名や仮想モジュールは解決しない", () => {
    expect(resolveSpecifier({ specifier: "vue", importerRelPath: "pages/index.vue", exists })).toBeNull();
    expect(resolveSpecifier({ specifier: "#imports", importerRelPath: "pages/index.vue", exists })).toBeNull();
  });

  it("実在しないパスは解決しない", () => {
    expect(resolveSpecifier({ specifier: "~/utils/Missing", importerRelPath: "pages/index.vue", exists })).toBeNull();
  });
});

describe("normalizeDomainName", () => {
  it("複数形のディレクトリ名と単数形のコンポーネント名が同じ文字列になる", () => {
    expect(normalizeDomainName("schedules")).toBe("schedule");
    expect(normalizeDomainName("Schedule")).toBe("schedule");
  });

  it("スネークケースやハイフンの区切りを取り除く", () => {
    expect(normalizeDomainName("accounts_receivable")).toBe("accountsreceivable");
    expect(normalizeDomainName("accounts-receivables")).toBe("accountsreceivable");
  });

  it("-ies で終わる複数形のディレクトリ名と単数形のコンポーネント名が同じ文字列になる", () => {
    expect(normalizeDomainName("inventories")).toBe("inventory");
    expect(normalizeDomainName("Inventory")).toBe("inventory");
    expect(normalizeDomainName("companies")).toBe("company");
    expect(normalizeDomainName("Company")).toBe("company");
  });

  it("-ies ルール追加後も通常の -s 除去は回帰しない", () => {
    expect(normalizeDomainName("schedules")).toBe("schedule");
    expect(normalizeDomainName("Schedule")).toBe("schedule");
  });
});

describe("detectDomain", () => {
  it("ディレクトリ名からドメインを判定する", () => {
    expect(detectDomain("pages/schedules/index.vue", DOMAINS)).toBe("schedule");
    expect(detectDomain("components/organisms/Schedule/Parts/ScheduleTooltip.vue", DOMAINS)).toBe("schedule");
  });

  it("機能横断ディレクトリが挟まっていても奥のセグメントで判定する", () => {
    expect(detectDomain("components/organisms/Modal/Attendance/EditModal.vue", DOMAINS)).toBe("attendance");
  });

  it("ドメイン名を含むだけの名前は誤判定しない", () => {
    expect(detectDomain("types/SupplierPaySchedule.ts", DOMAINS)).toBe("");
    expect(detectDomain("types/ScheduledHolidayAllocationRevision.ts", DOMAINS)).toBe("");
  });

  it("共通領域のファイルはドメイン無しになる", () => {
    expect(detectDomain("utils/Type.ts", DOMAINS)).toBe("");
    expect(detectDomain("composables/shared/UseFoo.ts", DOMAINS)).toBe("");
  });

  it("-ies 型の複数形ディレクトリと単数形のコンポーネント名が同一ドメインと判定される", () => {
    const domains = new Set(["inventory", "company"]);

    expect(detectDomain("pages/inventories/index.vue", domains)).toBe("inventory");
    expect(detectDomain("types/Inventory/Inventory.ts", domains)).toBe("inventory");
    expect(detectDomain("pages/companies/index.vue", domains)).toBe("company");
    expect(detectDomain("types/Company.ts", domains)).toBe("company");
  });
});

describe("collectDomains", () => {
  it("先頭が __ のディレクトリをドメイン集合から除外する", () => {
    const root = mkdtempSync(path.join(tmpdir(), "find-reverse-deps-"));
    try {
      mkdirSync(path.join(root, "pages", "schedules"), { recursive: true });
      mkdirSync(path.join(root, "pages", "__docs__"), { recursive: true });
      mkdirSync(path.join(root, "pages", "__stories__"), { recursive: true });

      const domains = collectDomains(root);

      expect(domains.has("schedule")).toBe(true);
      // `__docs__` `__stories__` はどう正規化されても Storybook 等のツール用ディレクトリなので、
      // 正規化後の文字列そのものではなく「元名を含む形で残っていないか」を確認する
      expect([...domains].some((domain) => domain.includes("doc") || domain.includes("stor"))).toBe(false);
      expect(domains.size).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("hasPagesDirectory", () => {
  it("pages/ ディレクトリを持つなら true を返す", () => {
    const root = mkdtempSync(path.join(tmpdir(), "find-reverse-deps-"));
    try {
      mkdirSync(path.join(root, "pages"), { recursive: true });

      expect(hasPagesDirectory(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pages/ ディレクトリを持たないなら false を返す", () => {
    const root = mkdtempSync(path.join(tmpdir(), "find-reverse-deps-"));
    try {
      expect(hasPagesDirectory(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("isAutoImportTarget", () => {
  it("composables/ 直下と utils/ 直下だけが対象になる", () => {
    expect(isAutoImportTarget("utils/Type.ts")).toBe(true);
    expect(isAutoImportTarget("composables/UseFoo.ts")).toBe(true);
    expect(isAutoImportTarget("composables/stores/workflow/UseWorkflowDetail.ts")).toBe(false);
    expect(isAutoImportTarget("pages/index.vue")).toBe(false);
  });
});

describe("buildReverseIndex", () => {
  it("import 先ごとに import 元を集める", () => {
    const index = buildReverseIndex([
      { relPath: "utils/Type.ts", content: "export type A = string" },
      { relPath: "pages/index.vue", content: "import type { A } from '~/utils/Type'" },
      { relPath: "components/atoms/Button.vue", content: "import { A } from '../../utils/Type'" },
    ]);

    expect(index.get("utils/Type.ts")).toStrictEqual(new Set(["pages/index.vue", "components/atoms/Button.vue"]));
  });

  it("自己参照は数えない", () => {
    const index = buildReverseIndex([{ relPath: "utils/Type.ts", content: "import { A } from '~/utils/Type'" }]);

    expect(index.get("utils/Type.ts")).toBeUndefined();
  });

  it("同じファイルから複数回 import されても 1 件として数える", () => {
    const index = buildReverseIndex([
      { relPath: "utils/Type.ts", content: "export type A = string" },
      {
        relPath: "pages/index.vue",
        content: ["import { A } from '~/utils/Type'", "const m = await import('~/utils/Type')"].join("\n"),
      },
    ]);

    expect(index.get("utils/Type.ts")?.size).toBe(1);
  });
});

describe("sortImporters", () => {
  it("同一ドメインの importer を先に、別ドメインを後に並べる", () => {
    const result = sortImporters({
      importers: [
        "pages/workflows/index.vue",
        "utils/Type.ts",
        "pages/schedules/index.vue",
        "components/organisms/Schedule/ScheduleTab.vue",
      ],
      targetDomain: "schedule",
      domains: DOMAINS,
    });

    expect(result).toStrictEqual([
      "components/organisms/Schedule/ScheduleTab.vue",
      "pages/schedules/index.vue",
      "pages/workflows/index.vue",
      "utils/Type.ts",
    ]);
  });

  it("ドメインが無い変更ファイルでは全件を辞書順にする", () => {
    const result = sortImporters({
      importers: ["pages/workflows/index.vue", "components/atoms/Button.vue"],
      targetDomain: "",
      domains: DOMAINS,
    });

    expect(result).toStrictEqual(["components/atoms/Button.vue", "pages/workflows/index.vue"]);
  });
});

describe("buildBlock", () => {
  it("上限を超えたぶんを omitted に数える", () => {
    const importers = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

    const block = buildBlock({ target: "utils/Type.ts", importers, domains: DOMAINS, limit: 2 });

    expect(block.related).toStrictEqual(["a.ts", "b.ts"]);
    expect(block.omitted).toBe(3);
  });

  it("上限以内なら omitted は 0 になる", () => {
    const block = buildBlock({ target: "utils/Type.ts", importers: ["a.ts"], domains: DOMAINS, limit: 10 });

    expect(block.omitted).toBe(0);
  });

  it("逆依存が 1 件も無くてもブロックを作る", () => {
    const block = buildBlock({ target: "pages/schedules/index.vue", importers: [], domains: DOMAINS, limit: 10 });

    expect(block).toStrictEqual({
      target: "pages/schedules/index.vue",
      domain: "schedule",
      related: [],
      omitted: 0,
      autoImport: false,
    });
  });
});

describe("formatBlocks", () => {
  it("ブロックを空行区切りの key=value で出力する", () => {
    const text = formatBlocks([
      {
        target: "components/organisms/Schedule/Parts/ScheduleTooltip.vue",
        domain: "schedule",
        related: ["pages/schedules/index.vue"],
        omitted: 0,
        autoImport: false,
      },
      { target: "utils/Type.ts", domain: "", related: ["pages/index.vue"], omitted: 1118, autoImport: true },
    ]);

    expect(text).toBe(
      [
        "target=components/organisms/Schedule/Parts/ScheduleTooltip.vue",
        "domain=schedule",
        "related=pages/schedules/index.vue",
        "omitted=0",
        "",
        "target=utils/Type.ts",
        "domain=",
        "related=pages/index.vue",
        "omitted=1118",
        "autoimport=true",
        "",
      ].join("\n"),
    );
  });

  it("ブロックが無ければ空文字になる", () => {
    expect(formatBlocks([])).toBe("");
  });
});

describe("parseTargetList", () => {
  it("空行を除き重複を 1 件にまとめる", () => {
    expect(parseTargetList("utils/Type.ts\n\npages/index.vue\nutils/Type.ts\n")).toStrictEqual([
      "utils/Type.ts",
      "pages/index.vue",
    ]);
  });
});
