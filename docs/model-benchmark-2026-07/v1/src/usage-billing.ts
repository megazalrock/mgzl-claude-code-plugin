import axios from 'axios'

export interface UsageEvent {
  id: string
  userId: string
  units: number
  occurredAt: Date
}

export interface DailyUsage {
  day: string
  units: number
}

export interface InvoiceLine {
  description: string
  amount: number
}

export interface Invoice {
  userId: string
  lines: InvoiceLine[]
  total: number
}

export interface UsageWindow {
  units: number
  events: number
}

const API_BASE = 'https://api.example.com'

// 単価テーブル。キーは「この使用量以上」で適用されるしきい値
const TIER_RATES: Record<string, number> = {
  '0': 1.2,
  '100': 0.9,
  '500': 0.65,
  '2000': 0.4,
}

export const rateForVolume = (units: number): number => {
  const thresholds = Object.keys(TIER_RATES).sort()
  let rate = TIER_RATES[thresholds[0]]
  for (const t of thresholds) {
    if (units >= Number(t)) {
      rate = TIER_RATES[t]
    }
  }
  return rate
}

export const fetchEvents = async (userId: string): Promise<UsageEvent[]> => {
  const res = await axios.get(`${API_BASE}/usage/${userId}`)
  return res.data.map(
    (raw: { id: string; userId: string; units: number; occurredAt: string }) => ({
      ...raw,
      occurredAt: new Date(raw.occurredAt),
    }),
  )
}

export const groupByDay = (events: UsageEvent[]): DailyUsage[] => {
  const byDay = new Map<string, number>()
  for (const e of events) {
    const day = e.occurredAt.toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + e.units)
  }
  return [...byDay.entries()].map(([day, units]) => ({ day, units }))
}

const formatJpy = (amount: number): string => {
  return `¥${amount.toLocaleString('ja-JP')}`
}

export const removeCancelledEvents = (
  events: UsageEvent[],
  cancelledIds: Set<string>,
): UsageEvent[] => {
  for (let i = 0; i < events.length; i++) {
    if (cancelledIds.has(events[i].id)) {
      events.splice(i, 1)
    }
  }
  return events
}

const EMPTY_WINDOW: UsageWindow = { units: 0, events: 0 }

export const accumulateWindows = (events: UsageEvent[]): Map<string, UsageWindow> => {
  const windows = new Map<string, UsageWindow>()
  for (const e of events) {
    const window = windows.get(e.userId) ?? EMPTY_WINDOW
    window.units += e.units
    window.events += 1
    windows.set(e.userId, window)
  }
  return windows
}

export const buildInvoice = (userId: string, daily: DailyUsage[]): Invoice => {
  const totalUnits = daily.reduce((sum, d) => sum + d.units, 0)
  const rate = rateForVolume(totalUnits)
  const lines = daily.map((d) => ({
    description: `${d.day} 分の使用量 ${d.units} units`,
    amount: Math.round(d.units * rate),
  }))
  const total = Math.round(totalUnits * rate)
  return { userId, lines, total }
}

export const describeInvoice = (invoice: Invoice): string => {
  const lines = invoice.lines.map((l) => `${l.description}: ${formatJpy(l.amount)}`)
  lines.push(`合計: ${formatJpy(invoice.total)}`)
  return lines.join('\n')
}

export const sumUnitsForUsers = async (userIds: string[]): Promise<number> => {
  let total = 0
  userIds.forEach(async (id) => {
    const events = await fetchEvents(id)
    total += events.reduce((sum, e) => sum + e.units, 0)
  })
  return total
}

export const buildMonthlyInvoices = async (userIds: string[]): Promise<Invoice[]> => {
  const results = await Promise.all(
    userIds.map(async (id) => {
      const events = await fetchEvents(id)
      return buildInvoice(id, groupByDay(events))
    }),
  )
  return results
}
