import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendError } from "./log.ts";
import { dataPaths } from "./paths.ts";

function setup(projectDir: string, env?: Record<string, string | undefined>) {
  const home = mkdtempSync(join(tmpdir(), "fading-log-"));
  return dataPaths(projectDir, home, env ?? {});
}

describe("appendError", () => {
  test("ISO タイムスタンプ・発信元 projectDir・本文の順で 1 行を追記する", () => {
    const paths = setup("/proj/a");
    appendError(paths, "boom");
    const line = readFileSync(paths.errorLog, "utf8").trimEnd();
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[\/proj\/a\] boom$/,
    );
  });

  test("root を共有する複数プロジェクトの行を発信元で見分けられる", () => {
    const home = mkdtempSync(join(tmpdir(), "fading-log-"));
    const shared = join(home, "shared");
    const a = dataPaths("/proj/a", home, { FADING_MEMORY_DIR: shared });
    const b = dataPaths("/proj/b", home, { FADING_MEMORY_DIR: shared });
    expect(a.errorLog).toBe(b.errorLog);

    appendError(a, "from a");
    appendError(b, "from b");
    const lines = readFileSync(a.errorLog, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[/proj/a] from a");
    expect(lines[1]).toContain("[/proj/b] from b");
  });
});
