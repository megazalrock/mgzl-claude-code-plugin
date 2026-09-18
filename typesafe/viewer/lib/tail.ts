import { closeSync, openSync, readSync, statSync } from "node:fs";

export type TailResult = {
  lines: string[];
  /** ファイルが消えた・縮んだために offset を 0 に戻し、先頭から読み直したことを示す */
  reset: boolean;
};

export type Tail = { read(): TailResult };

/**
 * 追記専用ファイルを byte offset で差分読み取りする。
 * 複数の hook プロセスが同時に追記するため、改行で終わらない末尾は書きかけとみなして
 * 次回に持ち越す。行の分割は文字列化してから行うが、UTF-8 の途中で chunk が切れると
 * 文字が壊れるので、持ち越しは Buffer のまま保持し、連結してからデコードする。
 */
export function createTail(path: string): Tail {
  let offset = 0;
  let carry: Buffer = Buffer.alloc(0);

  function sizeOf(): number | undefined {
    try {
      return statSync(path).size;
    } catch {
      return undefined;
    }
  }

  function readFrom(start: number, end: number): Buffer {
    const fd = openSync(path, "r");
    try {
      const chunk = Buffer.alloc(end - start);
      let done = 0;
      while (done < chunk.length) {
        const got = readSync(fd, chunk, done, chunk.length - done, start + done);
        if (got === 0) break;
        done += got;
      }
      return chunk.subarray(0, done);
    } finally {
      closeSync(fd);
    }
  }

  function read(): TailResult {
    const size = sizeOf();
    let reset = false;
    if (size === undefined) {
      // ファイルが無い。次に現れたら先頭から読む
      if (offset !== 0 || carry.length !== 0) reset = true;
      offset = 0;
      carry = Buffer.alloc(0);
      return { lines: [], reset };
    }
    if (size < offset) {
      reset = true;
      offset = 0;
      carry = Buffer.alloc(0);
    }
    if (size === offset) return { lines: [], reset };

    const fresh = readFrom(offset, size);
    offset += fresh.length;
    const joined = Buffer.concat([carry, fresh]);
    const lastNewline = joined.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      carry = joined;
      return { lines: [], reset };
    }
    carry = joined.subarray(lastNewline + 1);
    const lines = joined
      .subarray(0, lastNewline)
      .toString("utf8")
      .split("\n");
    return { lines, reset };
  }

  return { read };
}
