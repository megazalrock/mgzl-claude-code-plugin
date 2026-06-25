// This file is kept for reference only.
// To regenerate migrations, temporarily install drizzle-orm and drizzle-kit:
//   bun add drizzle-orm && bun add -d drizzle-kit
//   bunx drizzle-kit generate --config=<absolute-path-to-this-file>
// Then uninstall them again and commit the generated SQL to migrations/.
//
// The runtime scripts use bun:sqlite directly and do NOT require drizzle-orm.
//
// NOTE: schema.ts no longer exports Drizzle table definitions, so you would
// need to restore them before running drizzle-kit generate.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  dialect: 'sqlite',
  schema: path.join(here, 'schema.ts'),
  out: path.join(here, 'migrations'),
});
