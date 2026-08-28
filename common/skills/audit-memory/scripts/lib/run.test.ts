import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "./run.ts";

let home: string;
const projectDir = "/proj/app";
// projectSlug("/proj/app") === "-proj-app"
const memDir = () => join(home, ".claude", "projects", "-proj-app", "memory");

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "audit-memory-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("runCheck", () => {
  test("memory ディレクトリが無ければ error 行と終了コード 1", () => {
    const r = runCheck(projectDir, home);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([`error=memory_dir_not_found dir=${memDir()}`]);
  });

  test("記憶一覧と issue を key=value で出力する", () => {
    mkdirSync(memDir(), { recursive: true });
    writeFileSync(
      join(memDir(), "MEMORY.md"),
      "# Memory Index\n\n- [A](feedback_a.md) — a\n- [Gone](project_gone.md) — gone\n",
    );
    writeFileSync(
      join(memDir(), "feedback_a.md"),
      "---\nname: feedback-a\ndescription: 説明 A に スペース\nmetadata:\n  type: feedback\n---\n本文 [[nothing]]\n",
    );
    writeFileSync(
      join(memDir(), "project_b.md"),
      "---\nname: project-b\ndescription: 説明 B\nmetadata:\n  type: project\n  foo: bar\n---\n本文\n",
    );
    mkdirSync(join(memDir(), "sub"));
    writeFileSync(join(memDir(), "sub", "project_ignored.md"), "---\nname: x\n---\n");
    writeFileSync(join(memDir(), "notes.txt"), "ignored");

    const r = runCheck(projectDir, home);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([
      `dir=${memDir()}`,
      "count=2",
      "memory=feedback_a.md type=feedback name=feedback-a description=説明 A に スペース",
      "memory=project_b.md type=project name=project-b description=説明 B",
      "issue=broken_link file=feedback_a.md detail=nothing",
      "issue=extra_key file=project_b.md detail=foo",
      "issue=index_missing file=project_b.md detail=MEMORY.md に索引行が無い",
      "issue=file_missing file=project_gone.md detail=MEMORY.md に索引行があるがファイルが無い",
    ]);
  });

  test("MEMORY.md が無くても記憶は列挙し、全件 index_missing になる", () => {
    rmSync(join(memDir(), "MEMORY.md"));
    const r = runCheck(projectDir, home);
    expect(r.exitCode).toBe(0);
    expect(r.lines.filter((l) => l.startsWith("issue=index_missing")).length).toBe(2);
  });

  test("欠落した値は - で埋める", () => {
    writeFileSync(join(memDir(), "project_c.md"), "本文だけ\n");
    const r = runCheck(projectDir, home);
    expect(r.lines).toContain("memory=project_c.md type=- name=- description=-");
    expect(r.lines).toContain("issue=frontmatter_unparsable file=project_c.md detail=フロントマターが無いか YAML として読めない");
  });

  test("壊れたシンボリックリンクは無視して止まらない", () => {
    symlinkSync(join(memDir(), "nonexistent.md"), join(memDir(), "project_dangling.md"));
    const r = runCheck(projectDir, home);
    expect(r.lines.some((l) => l.startsWith("memory=project_dangling.md"))).toBe(false);
  });

  test("description の複数行は 1 行に潰す", () => {
    writeFileSync(
      join(memDir(), "project_d.md"),
      "---\nname: project-d\ndescription: |\n  1行目\n  2行目\nmetadata:\n  type: project\n---\n本文\n",
    );
    const r = runCheck(projectDir, home);
    expect(r.lines).toContain("memory=project_d.md type=project name=project-d description=1行目 2行目");
  });
});
