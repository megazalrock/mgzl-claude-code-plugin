import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';

type DbHandle = {
  db: Database;
  dbPath: string;
};

let cached: DbHandle | null = null;

export function getDb(): DbHandle {
  if (cached) return cached;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) {
    throw new Error(
      'CLAUDE_PLUGIN_DATA is not set; this CLI expects to be invoked via the Claude Code plugin runtime.',
    );
  }
  fs.mkdirSync(pluginData, { recursive: true });
  const dbPath = path.join(pluginData, 'review.sqlite');
  const db = new Database(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  cached = { db, dbPath };
  return cached;
}
