import axios from 'axios'

export interface OrderItem {
  productId: string
  quantity: number
  unitPrice: number
}

export interface Order {
  id: string
  userId: string
  items: OrderItem[]
  status: 'pending' | 'confirmed' | 'shipped' | 'cancelled'
}

const API_BASE = 'https://api.example.com'

export class OrderService {
  calculateTotal(order: Order): number {
    return order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  }

  async fetchOrder(id: string): Promise<Order> {
    const res = await axios.get(`${API_BASE}/orders/${id}`)
    return res.data
  }
}
