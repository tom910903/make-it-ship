/** Line total in cents for {priceCents, qty}. */
export function lineTotal(item) {
  return item.priceCents * item.qty;
}

/**
 * Cart total in cents. `discount` is an optional {percent} applied to the subtotal,
 * rounded half up to the nearest cent.
 */
export function cartTotal(items, discount) {
  const subtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
  if (!discount) return subtotal;
  return subtotal - Math.floor((subtotal * discount.percent) / 100);
}
