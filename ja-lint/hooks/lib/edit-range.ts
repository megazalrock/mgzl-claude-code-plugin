/**
 * 同じ new_string がファイル内に何度も現れる場合の上限。
 * これを超えたら書き換え位置を特定できたとは見なさない。
 */
const MAX_OCCURRENCES = 64;

function occurrencesOf(content: string, needle: string): number[] | undefined {
  if (needle === "") return undefined;
  const found: number[] = [];
  for (let at = content.indexOf(needle); at >= 0; at = content.indexOf(needle, at + 1)) {
    found.push(at);
    if (found.length > MAX_OCCURRENCES) return undefined;
  }
  return found.length === 0 ? undefined : found;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  let i = 0;
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function lineStartsOf(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 文字オフセットが何行目（1 始まり）に属するかを二分探索で求める */
function lineOf(starts: number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= index) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}

/**
 * Edit が実際に書き換えた行番号（1 始まり）を、編集後のファイル全文から求める。
 * old_string と new_string の共通前後を除いた差分だけを見るので、
 * 置換範囲に巻き込まれただけで内容の変わらなかった行は含まれない。
 * 書き換え位置を特定できなかった場合は undefined を返す。
 */
export function changedLineNumbers(
  content: string,
  oldString: string,
  newString: string,
): Set<number> | undefined {
  const occurrences = occurrencesOf(content, newString);
  if (occurrences === undefined) return undefined;

  const prefix = commonPrefixLength(oldString, newString);
  const suffix = commonSuffixLength(
    oldString,
    newString,
    Math.min(oldString.length, newString.length) - prefix,
  );

  const starts = lineStartsOf(content);
  const changed = new Set<number>();
  for (const at of occurrences) {
    const from = at + prefix;
    // 差分が空（純粋な削除）でも、削除の起きた行は変更行として扱う
    const to = Math.max(at + newString.length - suffix - 1, from);
    for (let line = lineOf(starts, from); line <= lineOf(starts, to); line++) {
      changed.add(line);
    }
  }
  return changed;
}
