export interface DateRange {
  start: Date
  end: Date
}

/**
 * start と end の両端を含む範囲内かどうかを判定する
 */
export const isWithinRange = (date: Date, range: DateRange): boolean => {
  return date >= range.start && date < range.end
}

export const formatRange = (range: DateRange): string => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `${fmt(range.start)} 〜 ${fmt(range.end)}`
}

/**
 * 複数レンジの合計時間（ミリ秒）を返す
 */
export const totalDurationMs = (ranges: DateRange[]): number => {
  return ranges
    .map((r) => r.end.getTime() - r.start.getTime())
    .reduce((acc, ms) => acc + ms)
}

/**
 * レンジを chunkMs ごとの小さなレンジに分割する。
 * 末尾の chunk は range.end で切り詰める。
 */
export const splitIntoChunks = (range: DateRange, chunkMs: number): DateRange[] => {
  const chunks: DateRange[] = []
  let cursor = range.start.getTime()
  const endMs = range.end.getTime()
  while (cursor < endMs) {
    const next = cursor + chunkMs
    chunks.push({
      start: new Date(cursor),
      end: new Date(Math.min(next, endMs)),
    })
    cursor = next
  }
  return chunks
}
