// Backend implementation for CampusBites feature
// Handles coupon application logic for STUDENT10 discount.
// Exports handle(action, body, ctx) as required by the contract.

/**
 * Calculate subtotal from items using server-side product prices.
 * @param {Array} items - [{id:string, qty:number}]
 * @param {Array} products - product catalog
 * @returns {number} subtotal in rupees
 */
function calcSubtotal(items, products) {
  let sum = 0;
  for (const { id, qty } of items) {
    const prod = products.find(p => p.id === id);
    if (!prod || typeof qty !== 'number' || qty < 0) continue;
    sum += prod.price * qty;
  }
  return sum;
}

/**
 * Apply STUDENT10 coupon logic.
 * @param {Array} items
 * @param {Array} products
 * @returns {{valid:boolean, discount:number}}
 */
function applyStudent10(items, products) {
  const subtotal = calcSubtotal(items, products);
  if (subtotal < 299) return { valid: false, discount: 0 };
  // 10% off, rounded to nearest rupee
  let discount = Math.round(subtotal * 0.10);
  if (discount > 100) discount = 100;
  return { valid: true, discount };
}

export function handle(action, body, ctx) {
  // Validate ctx
  if (!ctx || !Array.isArray(ctx.products)) {
    return { status: 400, error: 'Invalid context' };
  }
  if (action === 'apply-coupon') {
    if (!body || typeof body.code !== 'string' || !Array.isArray(body.items)) {
      return { status: 400, error: 'Invalid request body' };
    }
    const code = body.code.trim().toUpperCase();
    // Ensure items have proper shape
    const items = body.items.map(it => ({ id: it.id, qty: Number(it.qty) || 0 }));
    let result = { valid: false, discount: 0 };
    if (code === 'STUDENT10') {
      result = applyStudent10(items, ctx.products);
    }
    return { status: 200, ...result };
  }
  return { status: 404, error: 'Unknown action' };
}
