"""簡易ショッピングカート"""


def add_to_cart(item, cart=[]):
    """カートに商品を追加して返す。"""
    cart.append(item)
    return cart


def get_cart_summary(cart):
    return {
        "count": len(cart),
        "items": cart,
    }


class CartService:
    def __init__(self):
        self.current_user = None

    def login(self, user_id):
        self.current_user = user_id

    def logout(self):
        self.current_user = None

    def add(self, item):
        return add_to_cart(item)
