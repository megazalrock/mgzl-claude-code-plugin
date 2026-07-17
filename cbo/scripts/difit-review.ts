// レビュー報告書（正本 JSON）を difit で開く・コメントを取得する共有スクリプト。
// スキーマ: cbo/skills/document-saver/references/format-review-result-json.md
//
// usage:
//   bun run difit-review.ts launch <report.json> --diff <head> <base>
//   bun run difit-review.ts launch <report.json> --file <path>
//   bun run difit-review.ts comments <port>
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Side = "new" | "old";
export type AnchorLine = number | { start: number; end: number };
export interface Anchor {
  side: Side;
  line: AnchorLine;
}
export interface Proposal {
  label: string | null;
  code: string;
}
export interface Evaluation {
  value: "tp" | "fp" | "nit" | "oos" | null;
  directive: string | null;
}
export interface Finding {
  id: string;
  severity: 1 | 2 | 3 | 4 | 5;
  file: string | null;
  anchor: Anchor | null;
  problem: string;
  reason: string;
  reporter: string;
  proposals: Proposal[];
  evaluation: Evaluation;
}
export interface Report {
  reporter: string;
  model: string;
  base_commit: string | null;
  head_commit: string | null;
  created_at: string;
  target: string | null;
  good_points: string[];
  findings: Finding[];
  references: string[];
}
export interface CommentPayload {
  type: "thread";
  filePath: string;
  position: Anchor;
  body: string;
  author: string;
}

const SEVERITY_LABELS: Record<number, string> = {
  5: "必須修正 (ブロッカー)",
  4: "強く推奨",
  3: "推奨",
  2: "軽微",
  1: "情報",
};

export function buildCommentPayloads(report: Report): {
  comments: CommentPayload[];
  unanchored: Finding[];
} {
  const comments: CommentPayload[] = [];
  const unanchored: Finding[] = [];
  for (const f of report.findings) {
    if (f.file === null) {
      unanchored.push(f);
      continue;
    }
    const position: Anchor = f.anchor ?? { side: "new", line: 1 };
    const lines: string[] = [`${f.id} [${f.severity}] ${SEVERITY_LABELS[f.severity]}`];
    if (f.anchor === null) {
      lines.push("【ファイル全体への指摘】");
    }
    lines.push(`問題: ${f.problem}`, `理由: ${f.reason}`, `報告者: ${f.reporter}`);
    for (const p of f.proposals) {
      lines.push(p.label === null ? "提案:" : `提案（${p.label}）:`, p.code);
    }
    lines.push("--- 返信例: tp 対応：案A（評価値: tp / fp / nit / oos）");
    comments.push({
      type: "thread",
      filePath: f.file,
      position,
      body: lines.join("\n"),
      author: f.reporter,
    });
  }
  return { comments, unanchored };
}

function resolveDifitCommand(): string[] {
  return Bun.which("difit") === null ? ["npx", "--yes", "difit@latest"] : ["difit"];
}

function fail(message: string): never {
  console.error(`error=${message}`);
  process.exit(1);
}

async function launch(reportPath: string, mode: string, modeArgs: string[]): Promise<void> {
  let report: Report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf-8")) as Report;
    // as を使う理由: JSON.parse の戻り値に実行時スキーマ検証を導入するほどの規模ではなく、
    // スキーマ不一致は後続処理のエラーとして顕在化するため型表明で扱う
  } catch {
    fail(`報告書を読み込めませんでした（${reportPath}）`);
  }
  const { comments, unanchored } = buildCommentPayloads(report);
  const workDir = mkdtempSync(join(tmpdir(), "difit-review-"));

  const args = [...resolveDifitCommand()];
  let stdinFd: number | "ignore" = "ignore";
  if (mode === "--diff") {
    if (modeArgs.length < 2) fail("--diff には <head> <base> の 2 引数が必要です");
    args.push(modeArgs[0], modeArgs[1]);
  } else if (mode === "--file") {
    if (modeArgs.length < 1) fail("--file には対象ファイルパスが必要です");
    const diff = spawnSync("git", ["diff", "--", "/dev/null", modeArgs[0]], {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    if (typeof diff.stdout !== "string" || diff.stdout === "") {
      fail("対象ファイルの diff を生成できませんでした");
    }
    const diffPath = join(workDir, "target.diff");
    writeFileSync(diffPath, diff.stdout);
    stdinFd = openSync(diffPath, "r");
  } else {
    fail("不明なモードです（--diff / --file）");
  }
  for (const c of comments) {
    args.push("--comment", JSON.stringify(c));
  }

  const logPath = join(workDir, "launch.log");
  const logFd = openSync(logPath, "w");
  const child = spawn(args[0], args.slice(1), {
    detached: true,
    stdio: [stdinFd, logFd, logFd],
  });
  child.unref();
  child.on("error", (e: Error) => {
    fail(`difit コマンドを起動できませんでした: ${e.message}`);
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await Bun.sleep(500);
    const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    const m = log.match(/started on (http:\/\/localhost:(\d+))/);
    if (m !== null) {
      const sessionPath = reportPath.replace(/\.json$/, ".difit-session.json");
      const session = {
        url: m[1],
        port: Number(m[2]),
        pid: child.pid,
        started_at: new Date().toISOString(),
      };
      writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
      console.log(`url=${m[1]}`);
      console.log(`port=${m[2]}`);
      console.log(`pid=${child.pid}`);
      console.log(`session=${sessionPath}`);
      console.log(
        `unanchored=${unanchored.length === 0 ? "none" : unanchored.map((f) => f.id).join(",")}`
      );
      return;
    }
  }
  fail(`difit の起動を 90 秒以内に確認できませんでした（ログ: ${logPath}）`);
}

async function comments(port: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}/api/comments-json`);
  } catch {
    fail(`サーバーに接続できませんでした（port=${port}）`);
  }
  if (!res.ok) fail(`HTTP ${res.status}`);
  console.log(await res.text());
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "launch" && rest.length >= 2) {
    await launch(rest[0], rest[1], rest.slice(2));
  } else if (cmd === "comments" && rest.length >= 1) {
    await comments(rest[0]);
  } else {
    console.error(
      "usage: difit-review.ts launch <report.json> --diff <head> <base> | launch <report.json> --file <path> | comments <port>"
    );
    process.exit(1);
  }
}
