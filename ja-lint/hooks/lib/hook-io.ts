/** textlint の 1 件の指摘を、行番号ではなく引用文で位置を示す形に落としたもの */
export type Finding = {
  ruleId: string;
  message: string;
  /** 指摘位置を含む文。長い場合は前後を省略記号で切り詰めてある */
  quote: string;
  /** lint にかけたテキスト内での行番号（1 始まり）。変更行への絞り込みに使う */
  line: number;
};

/** lint 結果を block 対象（error）と参考情報（info）に分けたもの */
export type LintOutcome = {
  errors: Finding[];
  infos: Finding[];
};

export type HookPayload = {
  toolName: string;
  toolInput: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** stdin の JSON を解析する。壊れていた場合は hook を素通しさせるため undefined を返す */
export function parseHookPayload(raw: string): HookPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const toolName = parsed["tool_name"];
  if (typeof toolName !== "string") return undefined;
  const toolInput = parsed["tool_input"];
  return { toolName, toolInput: isRecord(toolInput) ? toolInput : {} };
}

export function readStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

const SENTENCE_BOUNDARY = /[。\n]/;

/**
 * 指摘位置を含む「文」を切り出す。index は text 内のオフセットとして解釈する。
 * 行番号ではなく引用で位置を示すのは、Claude が編集箇所を探す手がかりとして文面のほうが確実なため。
 */
export function extractQuote(text: string, index: number, maxLength = 60): string {
  const clamped = Math.min(Math.max(index, 0), Math.max(text.length - 1, 0));

  let start = 0;
  for (let i = clamped; i > 0; i--) {
    if (SENTENCE_BOUNDARY.test(text[i - 1] ?? "")) {
      start = i;
      break;
    }
  }

  let end = text.length;
  for (let i = clamped; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "\n") {
      end = i;
      break;
    }
    if (ch === "。") {
      end = i + 1;
      break;
    }
  }

  const sentence = text.slice(start, end).trim();
  if (sentence.length <= maxLength) return sentence;

  const offset = Math.min(Math.max(clamped - start, 0), sentence.length);
  const half = Math.floor(maxLength / 2);
  const from = Math.max(offset - half, 0);
  const to = Math.min(from + maxLength, sentence.length);
  const head = from > 0 ? "…" : "";
  const tail = to < sentence.length ? "…" : "";
  return `${head}${sentence.slice(from, to)}${tail}`;
}

function renderFinding(finding: Finding): string {
  const firstLine = finding.message.split("\n")[0] ?? finding.message;
  return `- 「${finding.quote}」 [${finding.ruleId}] ${firstLine}`;
}

export function formatReason(outcome: LintOutcome): string {
  const sections: string[] = [];
  if (outcome.errors.length > 0) {
    sections.push(
      [
        `ja-lint: 日本語の文章に修正が必要です（error ${outcome.errors.length} 件）`,
        ...outcome.errors.map(renderFinding),
      ].join("\n"),
    );
  }
  if (outcome.infos.length > 0) {
    sections.push(
      [`参考（info ${outcome.infos.length} 件）`, ...outcome.infos.map(renderFinding)].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function preToolUseDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function preToolUseAdvisory(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
  });
}

/** PostToolUse は hookSpecificOutput ではなく上位の decision / reason で Claude に理由を渡す */
export function postToolUseBlock(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

export function postToolUseAdvisory(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
  });
}

function hasErrorCode(e: object): e is { code: unknown } {
  return "code" in e;
}

/**
 * hook 起動時の catch で使う。依存パッケージ未インストール（bun install 未実行）は
 * 利用者が最初に踏みやすい失敗なので、生のスタックトレース文言より対処法が分かる文言に変換する。
 */
export function describeHookError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const code = e instanceof Error && hasErrorCode(e) ? e.code : undefined;
  const isMissingModule = message.includes("Cannot find module") || code === "ERR_MODULE_NOT_FOUND";
  return isMissingModule ? `依存が未インストールです（${message}）` : message;
}
