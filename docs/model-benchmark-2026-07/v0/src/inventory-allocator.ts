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

const SKU_PATTERN = /^[A-Z]{2}-\d{4}$/

export const isValidSku = (sku: string): boolean => {
  return SKU_PATTERN.test(sku)
}
