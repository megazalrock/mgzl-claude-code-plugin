/** codex exec --json の JSONL を読み、失敗判定に必要な情報だけを抜き出した結果 */
export type CodexEventSummary = {
  errors: string[];
  turnFailed: boolean;
  turnCompleted: boolean;
};

type ParsedEvent = {
  type?: unknown;
  message?: unknown;
  error?: { message?: unknown };
};

const parseLine = (line: string): ParsedEvent | undefined => {
  if (line.trim() === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null) {
      // JSON.parse の戻り値は unknown なので、フィールドを任意参照するための最小限の形に絞る
      return parsed as ParsedEvent;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const toMessage = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

export const parseCodexEvents = (jsonl: string): CodexEventSummary => {
  const summary: CodexEventSummary = { errors: [], turnFailed: false, turnCompleted: false };

  for (const line of jsonl.split("\n")) {
    const event = parseLine(line);
    if (event === undefined) {
      continue;
    }
    if (event.type === "error") {
      summary.errors.push(toMessage(event.message));
    } else if (event.type === "turn.failed") {
      summary.turnFailed = true;
      summary.errors.push(toMessage(event.error?.message));
    } else if (event.type === "turn.completed") {
      summary.turnCompleted = true;
    }
  }

  return summary;
};
