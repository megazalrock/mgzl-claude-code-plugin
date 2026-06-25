import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, 'migrations');

export function runMigrations(): void {
  const { db } = getDb();

  // Check if __migrations tracking table already exists
  const migrationsTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'")
    .get();

  db.exec(
    'CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const files = fs
    .readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // If __migrations was just created but the schema tables already exist
  // (created by the old Drizzle migrator), record all migrations as applied.
  if (!migrationsTableExists) {
    const schemaExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reports'")
      .get();
    if (schemaExists) {
      for (const file of files) {
        db.prepare('INSERT OR IGNORE INTO __migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          new Date().toISOString(),
        );
      }
      return;
    }
  }

  for (const file of files) {
    const alreadyApplied = db.prepare('SELECT 1 FROM __migrations WHERE name = ?').get(file);
    if (alreadyApplied) continue;

    const sql = fs.readFileSync(path.join(migrationsFolder, file), 'utf-8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      db.exec(stmt);
    }
    db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
      file,
      new Date().toISOString(),
    );
  }
}
