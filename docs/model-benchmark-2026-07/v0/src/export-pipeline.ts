export interface ExportRecord {
  id: string
  name: string
  archived: boolean
  createdAt: string
  sizeBytes: number
}

export const toCsv = (records: ExportRecord[]): string => {
  const header = 'id,name,createdAt,sizeBytes'
  const rows = records.map((r) => [r.id, r.name, r.createdAt, String(r.sizeBytes)].join(','))
  return [header, ...rows].join('\n')
}
