// TypeScript type definitions for the review DB tables.
// The original Drizzle schema is preserved in drizzle.config.ts (dev-only).

export type Report = {
  id: string;
  file_path: string;
  created_at: string;
  model: string | null;
};

export type Finding = {
  id: string;
  report_id: string;
  body: string;
  target_path: string | null;
  line_start: number | null;
  line_end: number | null;
  code_before: string | null;
  code_after: string | null;
  severity: number;
  category: string;
  reporter: string;
  verdict: string | null;
  verdict_reason: string | null;
};
