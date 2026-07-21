// レビュー報告書（正本 JSON）を difit で開く・コメントを取得する共有スクリプト。
// スキーマ: cbo/skills/document-saver/references/format-review-result-json.md
//
// usage:
//   bun run difit-review.ts launch <report.json> --diff <head> <base>
//   bun run difit-review.ts launch <report.json> --file <path>
//   bun run difit-review.ts comments <port>
//   bun run difit-review.ts wait <report.json | session.json> [--timeout <seconds>]
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

export interface FileValidLines {
  newLines: Set<number>;
  oldLines: Set<number>;
}
export type ValidLines = Map<string, FileValidLines>;
export interface AdjustedAnchor {
  id: string;
  from: string;
  to: string;
}

const SEVERITY_LABELS: Record<number, string> = {
  5: "必須修正 (ブロッカー)",
  4: "強く推奨",
  3: "推奨",
  2: "軽微",
  1: "情報",
};

// コメント本文は difit 側で markdown レンダリングされるため、提案コードはフェンスで囲む。
// コード自体がフェンスを含む場合に備え、フェンス長は内容中の最長バックティック連続 + 1 とする
function fenceCode(code: string): string[] {
  const runs = code.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const marker = "`".repeat(Math.max(3, longest + 1));
  return [marker, code, marker];
}

// difit が表示する unified diff から、コメントを配置できる行番号（ハンク内の行）を
// ファイルごとに収集する。difit は diff に表示されない行のコメントをインライン表示できない
export function parseValidLines(diffText: string): ValidLines {
  const map: ValidLines = new Map();
  let current: FileValidLines | null = null;
  let pendingOldPath: string | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      pendingOldPath = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("--- ")) {
      const path = line.slice(4);
      pendingOldPath = path.startsWith("a/") ? path.slice(2) : null;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const path = line.slice(4);
      const newPath = path.startsWith("b/") ? path.slice(2) : null;
      const key = newPath ?? pendingOldPath;
      if (key !== null) {
        const existing = map.get(key);
        current = existing ?? { newLines: new Set(), oldLines: new Set() };
        map.set(key, current);
      }
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || current === null) continue;
    if (line.startsWith("+")) {
      current.newLines.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      current.oldLines.add(oldLine);
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      current.newLines.add(newLine);
      current.oldLines.add(oldLine);
      newLine += 1;
      oldLine += 1;
    }
    // "\ No newline at end of file" や空行はカウントしない
  }
  return map;
}

function nearestLine(target: number, valid: Set<number>): number | null {
  let best: number | null = null;
  for (const v of valid) {
    if (
      best === null ||
      Math.abs(v - target) < Math.abs(best - target) ||
      (Math.abs(v - target) === Math.abs(best - target) && v < best)
    ) {
      best = v;
    }
  }
  return best;
}

function describeAnchor(anchor: Anchor): string {
  const line =
    typeof anchor.line === "number" ? String(anchor.line) : `${anchor.line.start}-${anchor.line.end}`;
  return `${anchor.side}:${line}`;
}

// アンカーを diff の表示行に収まるよう補正する。指定 side に表示行が無ければ反対 side に
// 倒す（削除のみ／追加のみのファイル対策）。どちらにも無ければ null（unanchored 扱い）
function snapAnchor(anchor: Anchor, file: FileValidLines): Anchor | null {
  const sides: Side[] = anchor.side === "new" ? ["new", "old"] : ["old", "new"];
  for (const side of sides) {
    const valid = side === "new" ? file.newLines : file.oldLines;
    if (valid.size === 0) continue;
    if (typeof anchor.line === "number") {
      const snapped = nearestLine(anchor.line, valid);
      if (snapped === null) continue;
      return { side, line: snapped };
    }
    const start = nearestLine(anchor.line.start, valid);
    const end = nearestLine(anchor.line.end, valid);
    if (start === null || end === null) continue;
    if (start === end) return { side, line: start };
    return { side, line: { start: Math.min(start, end), end: Math.max(start, end) } };
  }
  return null;
}

export function buildCommentPayloads(
  report: Report,
  validLines?: ValidLines
): {
  comments: CommentPayload[];
  unanchored: Finding[];
  adjusted: AdjustedAnchor[];
} {
  const comments: CommentPayload[] = [];
  const unanchored: Finding[] = [];
  const adjusted: AdjustedAnchor[] = [];
  for (const f of report.findings) {
    if (f.file === null) {
      unanchored.push(f);
      continue;
    }
    let position: Anchor = f.anchor ?? { side: "new", line: 1 };
    if (validLines !== undefined) {
      const fileValid = validLines.get(f.file);
      if (fileValid === undefined) {
        unanchored.push(f);
        continue;
      }
      const snapped = snapAnchor(position, fileValid);
      if (snapped === null) {
        unanchored.push(f);
        continue;
      }
      // f.anchor === null の合成アンカー（先頭行）の補正は報告対象にしない
      if (f.anchor !== null && describeAnchor(snapped) !== describeAnchor(position)) {
        adjusted.push({ id: f.id, from: describeAnchor(position), to: describeAnchor(snapped) });
      }
      position = snapped;
    }
    const lines: string[] = [`${f.id} [${f.severity}] ${SEVERITY_LABELS[f.severity]}`];
    if (f.anchor === null) {
      lines.push("【ファイル全体への指摘】");
    }
    lines.push(`問題: ${f.problem}`, `理由: ${f.reason}`, `報告者: ${f.reporter}`);
    for (const p of f.proposals) {
      lines.push(p.label === null ? "提案:" : `提案（${p.label}）:`, ...fenceCode(p.code));
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
  return { comments, unanchored, adjusted };
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
  const workDir = mkdtempSync(join(tmpdir(), "difit-review-"));

  const args = [...resolveDifitCommand()];
  let stdinFd: number | "ignore" = "ignore";
  // difit が表示するのと同じ diff テキスト。取得できない場合はアンカー補正なしで続行する
  let diffText: string | null = null;
  if (mode === "--diff") {
    if (modeArgs.length < 2) fail("--diff には <head> <base> の 2 引数が必要です");
    args.push(modeArgs[0], modeArgs[1]);
    const diff = spawnSync("git", ["diff", modeArgs[1], modeArgs[0]], {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    if (diff.status === 0 && typeof diff.stdout === "string") {
      diffText = diff.stdout;
    }
  } else if (mode === "--file") {
    if (modeArgs.length < 1) fail("--file には対象ファイルパスが必要です");
    const diff = spawnSync("git", ["diff", "--", "/dev/null", modeArgs[0]], {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    if (typeof diff.stdout !== "string" || diff.stdout === "") {
      fail("対象ファイルの diff を生成できませんでした");
    }
    diffText = diff.stdout;
    const diffPath = join(workDir, "target.diff");
    writeFileSync(diffPath, diff.stdout);
    stdinFd = openSync(diffPath, "r");
  } else {
    fail("不明なモードです（--diff / --file）");
  }
  const validLines = diffText === null ? undefined : parseValidLines(diffText);
  const { comments, unanchored, adjusted } = buildCommentPayloads(report, validLines);
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
        log: logPath,
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
      console.log(
        `adjusted=${
          adjusted.length === 0
            ? "none"
            : adjusted.map((a) => `${a.id}:${a.from}->${a.to}`).join(",")
        }`
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

// difit は（--keep-alive なしの場合）ブラウザタブが閉じられると、全コメント＋リプライを
// 整形したブロックを stdout に出力してから終了する。detached 起動のため出力はログに落ちる
export function extractCommentsOutput(log: string): string | null {
  const marker = "📝 Comments from review session:";
  const index = log.lastIndexOf(marker);
  if (index < 0) return null;
  return log.slice(index).trim();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM は「存在するが操作権限が無い」= 生存
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

async function waitForExit(target: string, timeoutSeconds: number): Promise<void> {
  const sessionPath = target.endsWith(".difit-session.json")
    ? target
    : target.replace(/\.json$/, ".difit-session.json");
  let session: Partial<{ pid: number; log: string }>;
  try {
    session = JSON.parse(readFileSync(sessionPath, "utf-8")) as Partial<{
      pid: number;
      log: string;
    }>;
    // as を使う理由: launch の Report 読み込みと同様、実行時スキーマ検証を導入するほどの
    // 規模ではなく、必須フィールドは直後の存在チェックで検証するため
  } catch {
    fail(`セッションファイルを読み込めませんでした（${sessionPath}）`);
  }
  const { pid, log } = session;
  if (typeof pid !== "number") fail("セッションに pid がありません");
  if (typeof log !== "string") {
    fail("セッションに log がありません（旧形式）。review:open で difit を開き直してください");
  }
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) {
      console.log("status=timeout");
      return;
    }
    await Bun.sleep(1000);
  }
  // 終了直後のログ書き込みを待つ
  await Bun.sleep(500);
  const content = existsSync(log) ? readFileSync(log, "utf-8") : "";
  const output = extractCommentsOutput(content);
  console.log("status=exited");
  if (output === null) {
    console.log("comments=none");
    return;
  }
  console.log("comments=captured");
  console.log("");
  console.log(output);
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "launch" && rest.length >= 2) {
    await launch(rest[0], rest[1], rest.slice(2));
  } else if (cmd === "comments" && rest.length >= 1) {
    await comments(rest[0]);
  } else if (cmd === "wait" && rest.length >= 1) {
    const timeoutIndex = rest.indexOf("--timeout");
    const timeoutSeconds = timeoutIndex >= 0 ? Number(rest[timeoutIndex + 1]) : 3600;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      fail("--timeout は正の秒数で指定してください");
    }
    await waitForExit(rest[0], timeoutSeconds);
  } else {
    console.error(
      "usage: difit-review.ts launch <report.json> --diff <head> <base> | launch <report.json> --file <path> | comments <port> | wait <report.json | session.json> [--timeout <seconds>]"
    );
    process.exit(1);
  }
}
