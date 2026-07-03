export interface UsageEvent {
  id: string
  userId: string
  units: number
  occurredAt: Date
}

export const totalUnits = (events: UsageEvent[]): number => {
  return events.reduce((sum, e) => sum + e.units, 0)
}
