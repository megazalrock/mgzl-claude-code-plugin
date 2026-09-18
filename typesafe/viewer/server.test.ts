import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "./server.ts";

const root = mkdtempSync(join(tmpdir(), "typesafe-viewer-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function line(ts: string, prompt: string): string {
  return `${JSON.stringify({
    ts,
    session_id: "s",
    cwd: "/tmp",
    event: "UserPromptSubmit",
    prompt,
    outcome: "no_fit",
    winner: null,
    noneProbability: 0.9,
    shortlist: [],
    calls: [],
    elapsedMs: 10,
    rosterSize: 3,
  })}\n`;
}

/** SSE の本文から目的の event 行が現れるまで読む。届かなければ timeoutMs で諦める */
async function waitForEvent(res: Response, name: string, timeoutMs: number): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(`event: ${name}\n`)) {
      await reader.cancel();
      return buffer;
    }
  }
  await reader.cancel();
  throw new Error(`event ${name} が ${timeoutMs}ms 以内に届かなかった: ${buffer}`);
}

describe("startViewer", () => {
  test("/ は HTML を返す", async () => {
    const file = join(root, "a.jsonl");
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("typesafe suggestions viewer");
      expect(html).toContain("id=\"filters\"");
      expect(html).toContain("id=\"list\"");
      expect(html).toContain("id=\"detail\"");
      expect(html).toContain("new EventSource(\"/events\")");
    } finally {
      viewer.stop();
    }
  });

  test("/api/records は起動時のファイル内容を返し、壊れた行は数える", async () => {
    const file = join(root, "b.jsonl");
    writeFileSync(file, `${line("2026-09-19T00:00:00.000Z", "one")}{broken\n${line("2026-09-19T00:00:01.000Z", "two")}`);
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}api/records`);
      const json = await res.json();
      expect(json.records.map((r: { prompt: string }) => r.prompt)).toEqual(["one", "two"]);
      expect(json.warnings).toEqual({ droppedLines: 1 });
    } finally {
      viewer.stop();
    }
  });

  test("ファイルが無くても起動し、生成後の追記が SSE で届く", async () => {
    const file = join(root, "c.jsonl");
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const first = await (await fetch(`${viewer.url}api/records`)).json();
      expect(first.records).toEqual([]);
      const sse = await fetch(`${viewer.url}events`);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      appendFileSync(file, line("2026-09-19T00:00:02.000Z", "fresh"));
      const body = await waitForEvent(sse, "record", 2000);
      expect(body).toContain("\"prompt\":\"fresh\"");
    } finally {
      viewer.stop();
    }
  });

  test("切り詰められたら reset が届く", async () => {
    const file = join(root, "d.jsonl");
    writeFileSync(file, line("2026-09-19T00:00:00.000Z", "one") + line("2026-09-19T00:00:01.000Z", "two"));
    const viewer = startViewer({ file, port: 0, pollMs: 20 });
    try {
      const sse = await fetch(`${viewer.url}events`);
      writeFileSync(file, line("2026-09-19T00:00:03.000Z", "x"));
      const body = await waitForEvent(sse, "reset", 2000);
      expect(body).toContain("event: reset\n");
      const after = await (await fetch(`${viewer.url}api/records`)).json();
      expect(after.records.map((r: { prompt: string }) => r.prompt)).toEqual(["x"]);
    } finally {
      viewer.stop();
    }
  });

  test("知らないパスは 404", async () => {
    const viewer = startViewer({ file: join(root, "e.jsonl"), port: 0, pollMs: 20 });
    try {
      const res = await fetch(`${viewer.url}nope`);
      expect(res.status).toBe(404);
    } finally {
      viewer.stop();
    }
  });
});
