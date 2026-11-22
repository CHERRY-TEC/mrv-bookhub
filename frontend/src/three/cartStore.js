/**
 * Books the reader has chosen to take to the counter, plus the receipt.
 * The chosen books appear stacked on the biller's table and the receipt is
 * printed from the biller panel.
 */
export const cartStore = {
  items: [],        // { key, title, author, price, color }
  receipt: null,    // { lines, total, date, floor }
};

const listeners = new Set();
export function subscribeCart(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn({ ...cartStore, items: [...cartStore.items] })); }

export function addToCart(book) {
  if (!book || cartStore.items.some((i) => i.key === book.key)) return false;
  cartStore.items.push({
    key: book.key,
    title: book.title || 'Untitled',
    author: book.author || 'MRV Press',
    price: Number(book.listing?.price || 0),
    color: book.color || '#8a5a1e',
  });
  cartStore.receipt = null;
  emit();
  return true;
}

export function removeFromCart(key) {
  const i = cartStore.items.findIndex((b) => b.key === key);
  if (i >= 0) { cartStore.items.splice(i, 1); cartStore.receipt = null; emit(); }
}

export function clearCart() { cartStore.items = []; cartStore.receipt = null; emit(); }

export function makeReceipt(floorName) {
  const total = cartStore.items.reduce((s, b) => s + b.price, 0);
  cartStore.receipt = {
    lines: cartStore.items.map((b, i) => `${String(i + 1).padStart(2, '0')} ${b.title.slice(0, 26).padEnd(27)} Rs.${b.price.toFixed(2)}`),
    total,
    date: new Date().toLocaleString(),
    floor: floorName,
  };
  emit();
  return cartStore.receipt;
}
