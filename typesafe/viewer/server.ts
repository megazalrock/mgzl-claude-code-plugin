import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LOG_FILE_NAME } from "../hooks/lib/log.ts";
import { toViewRecord, type ViewRecord } from "./lib/records.ts";
import { createTail } from "./lib/tail.ts";

export type ViewerOptions = {
  file: string;
  /** 0 を渡すと空きポートを使う（テスト用） */
  port: number;
  pollMs?: number;
  pingMs?: number;
};

export type Viewer = {
  /** 末尾に "/" が付いた形 */
  url: string;
  stop(): void;
};

export const DEFAULT_PORT = 47391;
export const DEFAULT_POLL_MS = 1000;
export const DEFAULT_PING_MS = 15000;
const HOST = "127.0.0.1";

/** Claude Code が typesafe プラグインに与える CLAUDE_PLUGIN_DATA の実体。hook 側と同じファイル名を使う */
export const DEFAULT_LOG_FILE = join(
  homedir(),
  ".claude",
  "plugins",
  "data",
  "typesafe-mgzl-marketplace",
  LOG_FILE_NAME,
);

const HTML_PATH = join(import.meta.dir, "index.html");

type Client = ReadableStreamDefaultController<Uint8Array>;

function sseFrame(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export function startViewer(options: ViewerOptions): Viewer {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const pingMs = options.pingMs ?? DEFAULT_PING_MS;
  const tail = createTail(options.file);
  const records: ViewRecord[] = [];
  let droppedLines = 0;
  let lastSize = -1;
  const clients = new Set<Client>();

  function broadcast(frame: Uint8Array): void {
    for (const client of clients) {
      try {
        client.enqueue(frame);
      } catch {
        // 切断済みの client。cancel が走る前に enqueue すると投げるので外す
        clients.delete(client);
      }
    }
  }

  function ingest(lines: string[]): ViewRecord[] {
    const added: ViewRecord[] = [];
    for (const line of lines) {
      const view = toViewRecord(line);
      if (view === null) {
        droppedLines += 1;
        continue;
      }
      records.push(view);
      added.push(view);
    }
    return added;
  }

  function poll(): void {
    let size = -2;
    try {
      size = statSync(options.file).size;
    } catch {
      size = -1;
    }
    if (size === lastSize) return;
    lastSize = size;
    const result = tail.read();
    if (result.reset) {
      records.length = 0;
      droppedLines = 0;
      broadcast(sseFrame("reset", "{}"));
    }
    for (const view of ingest(result.lines)) {
      broadcast(sseFrame("record", JSON.stringify(view)));
    }
  }

  // 起動時の全件読み込みも同じ経路。offset 0 からの差分読み取りに等しい
  poll();
  const pollTimer = setInterval(poll, pollMs);
  const pingTimer = setInterval(() => broadcast(new TextEncoder().encode(": ping\n\n")), pingMs);

  const server = Bun.serve({
    hostname: HOST,
    port: options.port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        // Bun.file() のゼロコピー送出は Bash サンドボックスが sendfile を拒否するため使わない。毎回読むので index.html の編集は再起動なしで反映される
        return new Response(readFileSync(HTML_PATH, "utf8"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/api/records") {
        return Response.json({ records, warnings: { droppedLines } });
      }
      if (pathname === "/events") {
        let self: Client | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            self = controller;
            clients.add(controller);
            controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            if (self !== undefined) clients.delete(self);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://${HOST}:${server.port}/`,
    stop() {
      clearInterval(pollTimer);
      clearInterval(pingTimer);
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // 既に閉じている
        }
      }
      clients.clear();
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: "string" },
      port: { type: "string" },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`error=invalid port: ${values.port}`);
    process.exit(1);
  }
  try {
    const viewer = startViewer({ file: values.file ?? DEFAULT_LOG_FILE, port });
    console.log(`url=${viewer.url}`);
    console.log(`file=${values.file ?? DEFAULT_LOG_FILE}`);
  } catch (error) {
    console.error(`error=${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
