const API_URL = '/api';

// Работа с локальной корзиной
function getCart() {
  return JSON.parse(localStorage.getItem('oshpos_cart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('oshpos_cart', JSON.stringify(cart));
  updateCartCount();
}

function addToCart(dishId, name, price) {
  const cart = getCart();
  const existing = cart.find(item => item.dish_id === dishId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ dish_id: dishId, name, price, quantity: 1 });
  }
  saveCart(cart);
  alert(`Блюдо "${name}" добавлено в корзину!`);
}

function updateCartCount() {
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.quantity, 0);
  const el = document.getElementById('cart-count');
  if (el) el.innerText = total;
}

document.addEventListener('DOMContentLoaded', updateCartCount);