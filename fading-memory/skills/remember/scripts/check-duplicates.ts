import { checkDuplicates, type DedupCandidateResult } from "../../../hooks/lib/dedup.ts";
import { ensureDirs, loadMemories } from "../../../hooks/lib/maintenance.ts";
import { dataPaths } from "../../../hooks/lib/paths.ts";

/** API が使えなかったときは理由を 1 行だけ出し、呼び出し側を従来の目視判断へ戻す */
function unavailable(reason: string): never {
  console.log(`typesafe=unavailable reason=${reason}`);
  process.exit(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCandidates(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("input must be an object");
  const candidates = parsed["candidates"];
  if (!Array.isArray(candidates)) throw new Error("candidates must be an array");
  return candidates.map((candidate) => {
    if (typeof candidate !== "string") throw new Error("candidates must be strings");
    return candidate;
  });
}

function formatTop(result: DedupCandidateResult): string {
  if (result.top.length === 0) return "-";
  return result.top.map((item) => `${item.slug}:${item.probability.toFixed(2)}`).join(",");
}

const projectDir = process.argv[2] ?? process.cwd();

const apiKey = process.env["TYPESAFE_API_KEY"];
if (apiKey === undefined || apiKey === "") unavailable("no-api-key");

let candidates: string[];
try {
  candidates = readCandidates(await Bun.stdin.text());
} catch {
  unavailable("invalid-input");
}

const paths = dataPaths(projectDir);
ensureDirs(paths);
const { memories } = loadMemories(paths);
// 記憶が 1 件も無ければ比べる相手がいない。従来どおり「一覧が空なら全部新規」に任せる
if (memories.length === 0) unavailable("no-memories");

const outcome = await checkDuplicates(
  candidates,
  memories.map((memory) => ({ slug: memory.slug, title: memory.meta.title })),
  { apiKey },
);
if (outcome.status === "unavailable") unavailable(outcome.reason);

console.log("typesafe=ok");
outcome.results.forEach((result, index) => {
  // title は空白を含みうるため行末に置く
  console.log(
    `candidate=${index + 1} verdict=${result.verdict} none_p=${result.noneProbability.toFixed(2)} confidence=${result.confidence.toFixed(2)} top=${formatTop(result)} title=${result.candidate}`,
  );
});
