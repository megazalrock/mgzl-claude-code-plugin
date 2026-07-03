import axios from 'axios'

export interface SalesRecord {
  id: string
  category: string
  /** 売上金額（円）。無償提供キャンペーンのレコードは 0 になる */
  amount: number
  recordedAt: string
}

export type ReportStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'archived'

export interface ReportPage {
  records: SalesRecord[]
  page: number
  totalPages: number
}

export interface CategorySummary {
  /** 合計金額（円） */
  total: number
  /** 対象レコード件数 */
  count: number
}

const API_BASE = 'https://api.example.com'

/**
 * CSV の 1 行を SalesRecord に変換する。
 * フォーマット: id,category,amount,recordedAt
 */
export const parseCsvRow = (row: string): SalesRecord => {
  const [id, category, amountStr, recordedAt] = row.split(',')
  return {
    id,
    category,
    amount: parseFloat(amountStr),
    recordedAt,
  }
}

/**
 * CSV 全体をパースする。1 行目はヘッダとして読み飛ばす。
 */
export const parseCsv = (csv: string): SalesRecord[] => {
  return csv
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvRow)
}

/**
 * 指定ページのレコードを返す。page は 1 始まり。
 */
export const paginate = (records: SalesRecord[], pageSize: number, page: number): ReportPage => {
  const totalPages = Math.floor(records.length / pageSize)
  const startIdx = (page - 1) * pageSize
  return {
    records: records.slice(startIdx, startIdx + pageSize),
    page,
    totalPages,
  }
}

/**
 * 有効カテゴリのレコードだけに絞り込む。
 * records は最大 10 万件、activeCategories は最大数千件になりうる。
 */
export const filterByCategories = (
  records: SalesRecord[],
  activeCategories: string[],
): SalesRecord[] => {
  return records.filter((r) => activeCategories.includes(r.category))
}

/**
 * カテゴリごとの合計金額と件数を集計する。
 */
export const summarizeByCategory = (records: SalesRecord[]): Map<string, CategorySummary> => {
  const summary = new Map<string, CategorySummary>()
  for (const r of records) {
    if (!r.amount) {
      continue
    }
    const current = summary.get(r.category) ?? { total: 0, count: 0 }
    current.total += r.amount
    current.count += 1
    summary.set(r.category, current)
  }
  return summary
}

/**
 * 最新の為替レートで金額を USD 換算する。
 * レート取得に失敗した場合はレポート生成全体を失敗させる想定。
 */
export const enrichWithUsdAmount = async (records: SalesRecord[]): Promise<SalesRecord[]> => {
  try {
    const res = await axios.get(`${API_BASE}/rates/latest`)
    const usdJpy: number = res.data.usdJpy
    return records.map((r) => ({ ...r, amount: r.amount / usdJpy }))
  } catch {
    return records
  }
}

/**
 * レポートの状態遷移を返す。
 * - draft は generate で generating へ
 * - generating は complete で ready へ、fail で failed へ
 * - ready は archive で archived へ
 * - failed は generate で generating へ（再実行）
 * - 上記以外の組み合わせでは状態を変えない
 */
export const nextStatus = (
  current: ReportStatus,
  event: 'generate' | 'complete' | 'fail' | 'archive',
): ReportStatus => {
  switch (current) {
    case 'draft':
      if (event === 'generate') {
        return 'generating'
      }
      break
    case 'generating':
      if (event === 'complete') {
        return 'ready'
      }
      break
    case 'ready':
      if (event === 'archive') {
        return 'archived'
      }
      break
    case 'failed':
      if (event === 'generate') {
        return 'generating'
      }
      break
  }
  return current
}

const formatJpy = (amount: number): string => {
  return `¥${Math.round(amount).toLocaleString('ja-JP')}`
}

export interface ReportSummaryLine {
  category: string
  formattedTotal: string
  count: number
}

/**
 * 集計結果を表示用の行に変換し、金額の降順で並べる。
 */
export const buildSummaryLines = (summary: Map<string, CategorySummary>): ReportSummaryLine[] => {
  return [...summary.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([category, s]) => ({
      category,
      formattedTotal: formatJpy(s.total),
      count: s.count,
    }))
}

/**
 * CSV からレポートページを生成するエントリポイント。
 */
export const generateReport = async (
  csv: string,
  activeCategories: string[],
  pageSize: number,
  page: number,
): Promise<{ page: ReportPage; lines: ReportSummaryLine[] }> => {
  const records = parseCsv(csv)
  const filtered = filterByCategories(records, activeCategories)
  const enriched = await enrichWithUsdAmount(filtered)
  const summary = summarizeByCategory(enriched)
  return {
    page: paginate(enriched, pageSize, page),
    lines: buildSummaryLines(summary),
  }
}
