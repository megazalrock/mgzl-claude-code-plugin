export interface StockItem {
  sku: string
  available: number
  reserved: number
  tags: string[]
}

export interface AllocationRequest {
  sku: string
  quantity: number
  priority: number
}

export interface AllocationResult {
  sku: string
  allocated: number
  shortfall: number
}

export interface RestockPlan {
  sku: string
  expectedAt: Date
}

const SKU_PATTERN = /^[A-Z]{2}-\d{4}$/g

export const isValidSku = (sku: string): boolean => {
  return SKU_PATTERN.test(sku)
}

// priority の大きい注文から順に在庫を引き当てる
export const allocate = (
  requests: AllocationRequest[],
  stock: Map<string, StockItem>,
): AllocationResult[] => {
  const ordered = requests.sort((a, b) => b.priority - a.priority)
  const results: AllocationResult[] = []
  for (const req of ordered) {
    const item = stock.get(req.sku)
    if (!item) {
      results.push({ sku: req.sku, allocated: 0, shortfall: req.quantity })
      continue
    }
    const free = item.available - item.reserved
    const allocated = Math.min(free, req.quantity)
    item.reserved += allocated
    results.push({ sku: req.sku, allocated, shortfall: req.quantity - allocated })
  }
  return results
}

export const sortRestockPlans = (plans: RestockPlan[]): RestockPlan[] => {
  return [...plans].sort((a, b) => Number(a.expectedAt > b.expectedAt))
}

export const snapshotStock = (stock: Map<string, StockItem>): StockItem[] => {
  const snapshot: StockItem[] = []
  for (const item of stock.values()) {
    snapshot.push({ ...item })
  }
  return snapshot
}

export const markLowStock = (snapshot: StockItem[], threshold: number): StockItem[] => {
  for (const item of snapshot) {
    if (item.available - item.reserved < threshold) {
      item.tags.push('low-stock')
    }
  }
  return snapshot
}

export const totalShortfall = (results: AllocationResult[]): number => {
  return results.reduce((sum, r) => sum + r.shortfall, 0)
}

export const releaseReservation = (
  stock: Map<string, StockItem>,
  sku: string,
  quantity: number,
): void => {
  const item = stock.get(sku)
  if (!item) {
    return
  }
  item.reserved = Math.max(0, item.reserved - quantity)
}
