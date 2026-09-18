import type { JevCall } from "./lib/jev.ts";
import { append, type HookEvent } from "./lib/log.ts";
import {
  type Framing,
  PROMPT_FRAMING,
  type SuggestResult,
  suggest,
  TOOL_FRAMING,
} from "./lib/pipeline.ts";
import { buildToolRequest } from "./lib/request.ts";
import { agentHasSkillTool, discover } from "./lib/roster.ts";

const SUGGESTED_PREFIX = "Relevant to the current request: ";
const SUGGESTED_SUFFIX =
  ". Invoke it with the Skill tool if it fits. Ignore this if it does not fit what the user actually asked for.";
const NO_SUGGESTION =
  "No skill in the roster appears specifically relevant to this request. Load one only if the request clearly calls for it.";
const TOOL_SUGGESTED_PREFIX = "Relevant to the action you are about to take: ";
const TOOL_SUGGESTED_SUFFIX =
  ". If it fits, invoke it with the Skill tool instead of proceeding ad hoc. Ignore this if it does not fit what you are actually doing.";

type Payload = {
  event: HookEvent;
  prompt: string;
  cwd: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  agentId: string;
  agentType: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function parsePayload(raw: string): Payload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const cwd = readString(parsed, "cwd");
  const toolInput = parsed["tool_input"];
  return {
    // 既知の値以外は既存の挙動に倒す
    event:
      readString(parsed, "hook_event_name") === "PreToolUse" ? "PreToolUse" : "UserPromptSubmit",
    prompt: readString(parsed, "prompt"),
    cwd: cwd === "" ? process.cwd() : cwd,
    sessionId: readString(parsed, "session_id"),
    toolName: readString(parsed, "tool_name"),
    toolInput: isRecord(toolInput) ? toolInput : {},
    agentId: readString(parsed, "agent_id"),
    agentType: readString(parsed, "agent_type"),
  };
}

/** ログの共通部分。tool_name は PreToolUse のときだけ、agent_type はサブエージェント内で発火して値があるときだけ載せる */
function recordBase(payload: Payload): {
  session_id: string;
  cwd: string;
  event: HookEvent;
  tool_name?: string;
  agent_type?: string;
} {
  return {
    session_id: payload.sessionId,
    cwd: payload.cwd,
    event: payload.event,
    tool_name: payload.event === "PreToolUse" ? payload.toolName : undefined,
    agent_type: payload.agentType === "" ? undefined : payload.agentType,
  };
}

function additionalContext(result: SuggestResult): string | undefined {
  if (result.outcome === "suggested") {
    if (result.winner === null) {
      // pipeline.ts の型上は string | null だが、"suggested" は常に choice の結果を積む契約
      throw new Error("suggest returned outcome 'suggested' without a winner");
    }
    return `<skill_relevance>${SUGGESTED_PREFIX}${result.winner}${SUGGESTED_SUFFIX}</skill_relevance>`;
  }
  if (result.outcome === "gate_quiet" || result.outcome === "no_fit") {
    return `<skill_relevance>${NO_SUGGESTION}</skill_relevance>`;
  }
  return undefined;
}

/** PreToolUse では「該当なし」を出さない。Bash のたびに注入されるとノイズになるため */
function toolAdditionalContext(result: SuggestResult): string | undefined {
  if (result.outcome !== "suggested") return undefined;
  if (result.winner === null) {
    throw new Error("suggest returned outcome 'suggested' without a winner");
  }
  return `<skill_relevance>${TOOL_SUGGESTED_PREFIX}${result.winner}${TOOL_SUGGESTED_SUFFIX}</skill_relevance>`;
}

function emit(event: HookEvent, context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: context },
    }),
  );
}

function logSkipped(payload: Payload, rosterSize: number, prompt: string): void {
  append({
    ...recordBase(payload),
    prompt,
    outcome: "skipped",
    winner: null,
    gate: null,
    shortlist: [],
    calls: [],
    elapsedMs: 0,
    rosterSize,
  });
}

// main の進行に応じて更新し、途中で失敗しても catch 側でエラーログに payload / rosterSize / request / calls を残せるようにする
let currentPayload: Payload | undefined;
let currentRosterSize = 0;
let currentRequest = "";
let currentCalls: JevCall[] = [];

/**
 * 2 つのイベントに共通する提案の本体。roster の取得から stdout への注入とログの記録までを持つ。
 * イベントごとに違うのは request 文・framing・注入する文面の組み立て方の 3 つだけ。
 */
async function runSuggestion(
  payload: Payload,
  request: string,
  framing: Framing,
  toContext: (result: SuggestResult) => string | undefined,
  apiKey: string,
): Promise<void> {
  currentRequest = request;
  currentCalls = [];

  const roster = discover(payload.cwd);
  currentRosterSize = roster.length;
  if (roster.length === 0) {
    logSkipped(payload, 0, request);
    return;
  }

  const result = await suggest(
    request,
    roster,
    {
      apiKey,
      onCall: (call) => {
        currentCalls.push(call);
      },
    },
    framing,
  );
  const context = toContext(result);
  if (context !== undefined) emit(payload.event, context);

  append({
    ...recordBase(payload),
    prompt: request,
    outcome: result.outcome,
    winner: result.winner,
    gate: result.gate,
    shortlist: result.shortlist,
    calls: currentCalls,
    elapsedMs: result.elapsedMs,
    rosterSize: roster.length,
  });
}

async function runUserPromptSubmit(payload: Payload, apiKey: string): Promise<void> {
  // 明示的なスキル呼び出し（/ 始まり）には提案が不要
  if (payload.prompt === "" || payload.prompt.startsWith("/")) {
    logSkipped(payload, 0, payload.prompt);
    return;
  }
  await runSuggestion(payload, payload.prompt, PROMPT_FRAMING, additionalContext, apiKey);
}

async function runPreToolUse(payload: Payload, apiKey: string): Promise<void> {
  const request = buildToolRequest({ toolName: payload.toolName, toolInput: payload.toolInput });
  if (request === undefined) {
    logSkipped(payload, 0, "");
    return;
  }

  // サブエージェント内での発火は、Skill ツールを持たないと推定したら API を呼ばずに終わる
  if (payload.agentId !== "" && !agentHasSkillTool(payload.agentType, payload.cwd)) {
    logSkipped(payload, 0, request);
    return;
  }

  await runSuggestion(payload, request, TOOL_FRAMING, toolAdditionalContext, apiKey);
}

async function main(): Promise<void> {
  const payload = parsePayload(await Bun.stdin.text());
  currentPayload = payload;
  const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
  // キー未設定は機能そのものが無効なので、stdin が壊れていても含めて記録すら残さない
  if (apiKey === "") return;
  if (payload === undefined) {
    // stdin が壊れていて payload が組み立てられない場合も、記録だけは残す（キー設定時のみ）
    append({
      session_id: "",
      cwd: "",
      event: "UserPromptSubmit",
      prompt: "",
      outcome: "error",
      winner: null,
      gate: null,
      shortlist: [],
      calls: [],
      elapsedMs: 0,
      rosterSize: 0,
      error: "malformed stdin payload",
    });
    return;
  }

  if (payload.event === "PreToolUse") {
    await runPreToolUse(payload, apiKey);
    return;
  }
  await runUserPromptSubmit(payload, apiKey);
}

try {
  await main();
} catch (e) {
  // 提案の失敗でユーザーのターンを止めないため、記録だけして正常終了する
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`typesafe suggest-skill: ${message}\n`);
  append({
    session_id: currentPayload?.sessionId ?? "",
    cwd: currentPayload?.cwd ?? process.cwd(),
    event: currentPayload?.event ?? "UserPromptSubmit",
    tool_name: currentPayload?.event === "PreToolUse" ? currentPayload.toolName : undefined,
    agent_type:
      currentPayload === undefined || currentPayload.agentType === ""
        ? undefined
        : currentPayload.agentType,
    prompt: currentRequest,
    outcome: "error",
    winner: null,
    gate: null,
    shortlist: [],
    calls: currentCalls,
    elapsedMs: 0,
    rosterSize: currentRosterSize,
    error: message,
  });
}
process.exit(0);
