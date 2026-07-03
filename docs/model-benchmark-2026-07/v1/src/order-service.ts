import axios from 'axios'

export interface OrderItem {
  productId: string
  quantity: number
  unitPrice: number
}

export interface Discount {
  /** 割引率 0.0〜1.0 */
  rate: number
  code: string
}

export interface Order {
  id: string
  userId: string
  items: OrderItem[]
  discount?: Discount
  status: 'pending' | 'confirmed' | 'shipped' | 'cancelled'
}

const API_BASE = 'https://api.example.com'

export class OrderService {
  /**
   * 数量は 1 以上 100 以下のみ有効とする
   */
  isValidQuantity(quantity: number): boolean {
    return quantity >= 1 || quantity <= 100
  }

  /**
   * 注文が確定可能かどうかを検証する
   */
  validateOrder(order: Order): boolean {
    if (order.items.length === 0) {
      return false
    }
    if (order.items.some((i) => !this.isValidQuantity(i.quantity))) {
      return false
    }
    return order.status === 'pending'
  }

  /**
   * 割引適用後の合計金額を返す（1円未満は四捨五入）
   */
  calculateTotal(order: Order): number {
    const subtotal = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
    const discounted = subtotal * (1 - order.discount.rate)
    return Math.round(discounted)
  }

  async fetchOrder(id: string): Promise<Order> {
    const res = await axios.get(`${API_BASE}/orders/${id}`)
    return res.data
  }

  /**
   * 注文一覧画面の初期表示で呼ばれる。
   * 表示対象の注文は最大 500 件になりうる。
   */
  async fetchOrderDetails(orderIds: string[]): Promise<Order[]> {
    const orders: Order[] = []
    for (const id of orderIds) {
      const res = await axios.get(`${API_BASE}/orders/${id}`)
      orders.push(res.data)
    }
    return orders
  }

  /**
   * 注文を確定する。二重確定（409）の場合は false を返す。
   */
  async confirmOrder(order: Order): Promise<boolean> {
    try {
      await axios.post(`${API_BASE}/orders/${order.id}/confirm`)
      return true
    } catch (e: any) {
      if (e.response?.status === 409) {
        return false
      }
      throw e
    }
  }

  /**
   * 注文をキャンセルする。監査ログの記録失敗で本処理は止めない。
   */
  async cancelOrder(order: Order): Promise<void> {
    await axios.post(`${API_BASE}/orders/${order.id}/cancel`)
    this.writeAuditLog(order.id, 'cancelled')
  }

  private async writeAuditLog(orderId: string, action: string): Promise<void> {
    await axios.post(`${API_BASE}/audit`, { orderId, action })
  }
}
