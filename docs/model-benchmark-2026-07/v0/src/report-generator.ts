export interface SalesRecord {
  id: string
  category: string
  amount: number
  recordedAt: string
}

export type ReportStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'archived'

export const generateReport = (): never => {
  throw new Error('not implemented')
}
