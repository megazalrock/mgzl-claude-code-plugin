import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getDb } from './db';
import { runMigrations } from './migrate';

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_VALUES = [
  'design',
  'logic',
  'style',
  'comments',
  'security',
  'performance',
  'test',
] as const;
const VERDICT_VALUES = ['tp', 'fp', 'nit', 'oos'] as const;

type Category = (typeof CATEGORY_VALUES)[number];
type Verdict = (typeof VERDICT_VALUES)[number];

type FindingInput = {
  body: string;
  targetPath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  codeBefore: string | null;
  codeAfter: string | null;
  severity: 1 | 2 | 3 | 4 | 5;
  category: Category;
  reporter: string;
  verdict: Verdict | null;
  verdictReason: string | null;
};

// ── UUIDv7 (RFC 9562, Bun built-in crypto) ─────────────────────────────────

function uuidv7(): string {
  const ms = BigInt(Date.now());
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── Validation (no zod) ────────────────────────────────────────────────────

function validateFindings(raw: unknown): FindingInput[] {
  if (!Array.isArray(raw)) throw new Error('findings JSON はルートが配列である必要があります');
  return raw.map((v, i) => {
    if (!v || typeof v !== 'object') throw new Error(`findings[${i}] はオブジェクトである必要があります`);
    const o = v as Record<string, unknown>;
    if (typeof o.body !== 'string' || !o.body) throw new Error(`findings[${i}].body が無効`);
    if (o.targetPath !== null && typeof o.targetPath !== 'string')
      throw new Error(`findings[${i}].targetPath が無効`);
    if (o.lineStart !== null && typeof o.lineStart !== 'number')
      throw new Error(`findings[${i}].lineStart が無効`);
    if (o.lineEnd !== null && typeof o.lineEnd !== 'number')
      throw new Error(`findings[${i}].lineEnd が無効`);
    if (o.codeBefore !== null && typeof o.codeBefore !== 'string')
      throw new Error(`findings[${i}].codeBefore が無効`);
    if (o.codeAfter !== null && typeof o.codeAfter !== 'string')
      throw new Error(`findings[${i}].codeAfter が無効`);
    if (typeof o.severity !== 'number' || ![1, 2, 3, 4, 5].includes(o.severity))
      throw new Error(`findings[${i}].severity が無効 (1-5)`);
    if (
      typeof o.category !== 'string' ||
      !(CATEGORY_VALUES as readonly string[]).includes(o.category)
    )
      throw new Error(`findings[${i}].category が無効`);
    if (typeof o.reporter !== 'string' || !o.reporter) throw new Error(`findings[${i}].reporter が無効`);
    if (
      o.verdict !== null &&
      (typeof o.verdict !== 'string' ||
        !(VERDICT_VALUES as readonly string[]).includes(o.verdict))
    )
      throw new Error(`findings[${i}].verdict が無効`);
    if (o.verdictReason !== null && typeof o.verdictReason !== 'string')
      throw new Error(`findings[${i}].verdictReason が無効`);
    return {
      body: o.body as string,
      targetPath: (o.targetPath ?? null) as string | null,
      lineStart: (o.lineStart ?? null) as number | null,
      lineEnd: (o.lineEnd ?? null) as number | null,
      codeBefore: (o.codeBefore ?? null) as string | null,
      codeAfter: (o.codeAfter ?? null) as string | null,
      severity: o.severity as 1 | 2 | 3 | 4 | 5,
      category: o.category as Category,
      reporter: o.reporter as string,
      verdict: (o.verdict ?? null) as Verdict | null,
      verdictReason: (o.verdictReason ?? null) as string | null,
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function escapeInline(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
}

function parseLimit(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(`--limit は正の整数 (${raw})\n`);
    process.exit(2);
  }
  return n;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return (
    [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))].join(
      '\n',
    ) + '\n'
  );
}

// ── Help ───────────────────────────────────────────────────────────────────

const HELP_TEXT = `review-db.ts — レビュー報告書 DB CLI

使い方:
  bun run review-db.ts <subcommand> [options]

サブコマンド:
  migrate
      未適用マイグレーションを適用する。

  import-report <path> --findings <jsonpath> [--model <name>]
      finding 配列 JSON を読み込み、<path> をキーに UPSERT する。

  set-verdict <finding-id> <verdict> [--reason <text>]
      単一 finding の verdict/verdict_reason を更新する。
      verdict は tp / fp / nit / oos のいずれか。

  list reports [--limit N] [--json]
      レビュー報告書を新しい順に一覧表示する。

  list findings [--report-id <id>] [--unverdicted] [--reporter <name>]
                [--full] [--json]
      finding を一覧表示する。既定では body を 80 字に省略する。

  show finding <id> [--full] [--json]
      finding の詳細を表示する。既定では body を 200 字に省略する。

  export [--format json|csv] [--output <path>]
      findings を reports と JOIN してエクスポートする。
      --output 省略時は標準出力。

  --help
      このヘルプを表示する。
`;

// ── Main ───────────────────────────────────────────────────────────────────

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean' },
      findings: { type: 'string' },
      model: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      full: { type: 'boolean' },
      'report-id': { type: 'string' },
      unverdicted: { type: 'boolean' },
      reporter: { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
      reason: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const [sub, ...rest] = positionals;
  switch (sub) {
    case 'migrate':
      runMigrations();
      process.stdout.write('migrated=ok\n');
      return;
    case 'import-report':
      cmdImportReport(rest, values);
      return;
    case 'set-verdict':
      cmdSetVerdict(rest, values);
      return;
    case 'list':
      cmdList(rest, values);
      return;
    case 'show':
      cmdShow(rest, values);
      return;
    case 'export':
      cmdExport(values);
      return;
    default:
      process.stderr.write(`unknown subcommand: ${sub}\n\n${HELP_TEXT}`);
      process.exit(2);
  }
}

// ── Subcommands ────────────────────────────────────────────────────────────

function cmdImportReport(positionals: string[], values: Record<string, unknown>): void {
  const target = positionals[0];
  if (!target) {
    process.stderr.write('import-report: <path> が指定されていません\n');
    process.exit(2);
  }
  const findingsArg = values.findings;
  if (typeof findingsArg !== 'string' || !findingsArg) {
    process.stderr.write('import-report: --findings <jsonpath> は必須です\n');
    process.exit(2);
  }

  const absPath = path.resolve(target);
  if (!fs.existsSync(absPath)) {
    process.stderr.write(`import-report: 報告書ファイルが存在しません: ${absPath}\n`);
    process.exit(1);
  }
  const findingsPath = path.resolve(findingsArg);
  if (!fs.existsSync(findingsPath)) {
    process.stderr.write(`import-report: findings JSON が存在しません: ${findingsPath}\n`);
    process.exit(1);
  }

  const model =
    typeof values.model === 'string' && values.model ? (values.model as string) : null;
  const mtime = fs.statSync(absPath).mtime.toISOString();

  let findingsInput: FindingInput[];
  try {
    findingsInput = validateFindings(JSON.parse(fs.readFileSync(findingsPath, 'utf-8')));
  } catch (e) {
    process.stderr.write(
      `import-report: findings JSON の検証に失敗\n${(e as Error).message}\n`,
    );
    process.exit(1);
  }

  runMigrations();
  const { db } = getDb();

  const doUpsert = db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM reports WHERE file_path = ?')
      .get(absPath) as { id: string } | null;

    let reportId: string;
    if (existing) {
      reportId = existing.id;
      db.prepare('UPDATE reports SET created_at = ?, model = ? WHERE id = ?').run(
        mtime,
        model,
        reportId,
      );
      db.prepare('DELETE FROM findings WHERE report_id = ?').run(reportId);
    } else {
      reportId = uuidv7();
      db.prepare(
        'INSERT INTO reports (id, file_path, created_at, model) VALUES (?, ?, ?, ?)',
      ).run(reportId, absPath, mtime, model);
    }

    const insertFinding = db.prepare(
      'INSERT INTO findings (id, report_id, body, target_path, line_start, line_end, code_before, code_after, severity, category, reporter, verdict, verdict_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const f of findingsInput) {
      insertFinding.run(
        uuidv7(),
        reportId,
        f.body,
        f.targetPath,
        f.lineStart,
        f.lineEnd,
        f.codeBefore,
        f.codeAfter,
        f.severity,
        f.category,
        f.reporter,
        f.verdict,
        f.verdictReason,
      );
    }

    const verdicted = findingsInput.filter((f) => f.verdict !== null).length;
    return { reportId, total: findingsInput.length, verdicted };
  });

  const result = doUpsert();
  process.stdout.write(
    `report_id=${result.reportId}\n` +
      `findings_count=${result.total}\n` +
      `verdicted_count=${result.verdicted}\n` +
      `unverdicted_count=${result.total - result.verdicted}\n`,
  );
}

function cmdSetVerdict(positionals: string[], values: Record<string, unknown>): void {
  const [findingId, verdictRaw] = positionals;
  if (!findingId || !verdictRaw) {
    process.stderr.write('set-verdict: <finding-id> <verdict> は必須です\n');
    process.exit(2);
  }
  if (!(VERDICT_VALUES as readonly string[]).includes(verdictRaw)) {
    process.stderr.write(
      `set-verdict: verdict は ${VERDICT_VALUES.join('/')} のいずれか (${verdictRaw})\n`,
    );
    process.exit(2);
  }
  const reason =
    typeof values.reason === 'string' && values.reason ? (values.reason as string) : null;

  runMigrations();
  const { db } = getDb();
  const updated = db
    .prepare('UPDATE findings SET verdict = ?, verdict_reason = ? WHERE id = ?')
    .run(verdictRaw, reason, findingId);
  if (updated.changes === 0) {
    process.stderr.write(`set-verdict: 該当 finding がありません: ${findingId}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `finding_id=${findingId}\nverdict=${verdictRaw}\nverdict_reason=${reason ?? ''}\n`,
  );
}

function cmdList(positionals: string[], values: Record<string, unknown>): void {
  const target = positionals[0];
  if (target === 'reports') { listReports(values); return; }
  if (target === 'findings') { listFindings(values); return; }
  process.stderr.write('list: サブターゲットは reports / findings のいずれか\n');
  process.exit(2);
}

function listReports(values: Record<string, unknown>): void {
  const limit = parseLimit(values.limit);
  runMigrations();
  const { db } = getDb();
  const sql = `SELECT id, file_path, created_at, model FROM reports ORDER BY created_at DESC${limit !== null ? ' LIMIT ?' : ''}`;
  const rows = (
    limit !== null ? db.prepare(sql).all(limit) : db.prepare(sql).all()
  ) as Record<string, unknown>[];
  if (values.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `id=${r.id}\tfile_path=${r.file_path}\tcreated_at=${r.created_at}\tmodel=${r.model ?? ''}\n`,
    );
  }
}

function listFindings(values: Record<string, unknown>): void {
  const reportId =
    typeof values['report-id'] === 'string' && values['report-id']
      ? (values['report-id'] as string)
      : null;
  const reporter =
    typeof values.reporter === 'string' && values.reporter
      ? (values.reporter as string)
      : null;
  const unverdicted = Boolean(values.unverdicted);
  const full = Boolean(values.full);

  runMigrations();
  const { db } = getDb();

  const conditions: string[] = [];
  const params: (string | null)[] = [];
  if (reportId) { conditions.push('report_id = ?'); params.push(reportId); }
  if (reporter) { conditions.push('reporter = ?'); params.push(reporter); }
  if (unverdicted) conditions.push('verdict IS NULL');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT * FROM findings ${where}`)
    .all(...params) as Record<string, unknown>[];

  if (values.json) {
    const out = rows.map((r) => ({ ...r, body: full ? r.body : truncate(r.body as string, 80) }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  for (const r of rows) {
    const body = full ? (r.body as string) : truncate(r.body as string, 80);
    process.stdout.write(
      `id=${r.id}\treport_id=${r.report_id}\tseverity=${r.severity}\tcategory=${r.category}\tverdict=${r.verdict ?? ''}\treporter=${r.reporter}\tbody=${escapeInline(body)}\n`,
    );
  }
}

function cmdShow(positionals: string[], values: Record<string, unknown>): void {
  const [target, id] = positionals;
  if (target !== 'finding' || !id) {
    process.stderr.write('show: 用法は `show finding <id>`\n');
    process.exit(2);
  }
  runMigrations();
  const { db } = getDb();
  const row = db
    .prepare('SELECT * FROM findings WHERE id = ?')
    .get(id) as Record<string, unknown> | null;
  if (!row) {
    process.stderr.write(`show: finding が見つかりません: ${id}\n`);
    process.exit(1);
  }
  const full = Boolean(values.full);
  const body = full ? (row.body as string) : truncate(row.body as string, 200);
  if (values.json) {
    process.stdout.write(JSON.stringify({ ...row, body }, null, 2) + '\n');
    return;
  }
  process.stdout.write(
    `id=${row.id}\n` +
      `report_id=${row.report_id}\n` +
      `severity=${row.severity}\n` +
      `category=${row.category}\n` +
      `reporter=${row.reporter}\n` +
      `verdict=${row.verdict ?? ''}\n` +
      `verdict_reason=${row.verdict_reason ?? ''}\n` +
      `target_path=${row.target_path ?? ''}\n` +
      `line_start=${row.line_start ?? ''}\n` +
      `line_end=${row.line_end ?? ''}\n` +
      `body=${escapeInline(body)}\n`,
  );
}

function cmdExport(values: Record<string, unknown>): void {
  const format = typeof values.format === 'string' ? values.format : 'json';
  if (format !== 'json' && format !== 'csv') {
    process.stderr.write(`export: --format は json|csv (${format})\n`);
    process.exit(2);
  }
  runMigrations();
  const { db } = getDb();
  const rows = db
    .prepare(
      `SELECT
        f.id AS finding_id, f.report_id, r.file_path, r.created_at, r.model,
        f.body, f.target_path, f.line_start, f.line_end, f.code_before, f.code_after,
        f.severity, f.category, f.reporter, f.verdict, f.verdict_reason
      FROM findings f
      INNER JOIN reports r ON f.report_id = r.id
      ORDER BY r.created_at DESC, f.id`,
    )
    .all() as Record<string, unknown>[];

  const content = format === 'json' ? JSON.stringify(rows, null, 2) + '\n' : toCsv(rows);
  const outPath =
    typeof values.output === 'string' && values.output
      ? path.resolve(values.output as string)
      : null;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
    process.stdout.write(`exported=${outPath}\ncount=${rows.length}\nformat=${format}\n`);
  } else {
    process.stdout.write(content);
  }
}

main(process.argv.slice(2));
