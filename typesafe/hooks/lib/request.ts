/** request 文に載せる command / prompt の最大文字数。Agent の prompt は長くなりうる */
export const TOOL_INPUT_CHARS = 2000;

export type ToolRequestInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
};

const PREFIX = "The assistant is about to perform this action:";

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

/** ツールごとに本体として使う tool_input のキー。対象外のツールは undefined */
function bodyKeyFor(toolName: string): string | undefined {
  if (toolName === "Bash") return "command";
  if (toolName === "Agent") return "prompt";
  return undefined;
}

/**
 * これから取る行為を表す request 文を組み立てる。
 * 冒頭の一文は「ユーザーの依頼」ではなく「行為」であることを Jev に伝えるためにある。
 * 本体（command / prompt）が取れない場合は組み立てを諦め、呼び出し側は提案を打ち切る。
 */
export function buildToolRequest(input: ToolRequestInput): string | undefined {
  const bodyKey = bodyKeyFor(input.toolName);
  if (bodyKey === undefined) return undefined;
  const body = readString(input.toolInput, bodyKey).slice(0, TOOL_INPUT_CHARS);
  if (body === "") return undefined;
  const description = readString(input.toolInput, "description");
  const lines = description === "" ? [PREFIX, body] : [PREFIX, description, body];
  return lines.join("\n");
}
