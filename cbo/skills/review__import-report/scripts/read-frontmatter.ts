import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  process.stderr.write('read-frontmatter.ts: <report-path> は必須です\n');
  process.exit(2);
}

const abs = path.resolve(target);
const text = fs.readFileSync(abs, 'utf-8');

const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
if (!match) {
  process.stdout.write('has_frontmatter=false\nreporter=\nmodel=\n');
  process.exit(0);
}

const fm = match[1];

function getField(key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return '';
  return m[1].replace(/^["']|["']$/g, '');
}

const reporter = getField('reporter');
const model = getField('model');

process.stdout.write(`has_frontmatter=true\nreporter=${reporter}\nmodel=${model}\n`);
