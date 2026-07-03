export interface DateRange {
  start: Date
  end: Date
}

/**
 * start と end の両端を含む範囲内かどうかを判定する
 */
export const isWithinRange = (date: Date, range: DateRange): boolean => {
  return date >= range.start && date <= range.end
}

export const formatRange = (range: DateRange): string => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `${fmt(range.start)} 〜 ${fmt(range.end)}`
}
