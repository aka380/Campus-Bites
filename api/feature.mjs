/** CampusBites feature slot (backend), served at POST /api/feature/<action>.
 * Implements coupon application and future extensions.
 */
export function handle(action, body, ctx) {
  // Ensure ctx has required shape
  if (!ctx || typeof ctx !== 'object' || !Array.isArray(ctx.products)) {
    return { status: 400, error: 'Invalid context' };
  }
  const productsById = {};
  for (const p of ctx.products) {
    if (p && typeof p.id === 'string') productsById[p.id] = p;
  }

  if (action === 'apply-coupon') {
    // Validate body
    if (!body || typeof body !== 'object') {
      return { status: 400, error: 'Missing body' };
    }
    const { code, items } = body;
    if (typeof code !== 'string' || typeof items !== 'object' || items === null) {
      return { status: 400, error: 'Invalid payload' };
    }
    // Compute subtotal using server-side prices
    let subtotal = 0;
    for (const [id, qty] of Object.entries(items)) {
      const prod = productsById[id];
      if (!prod) {
        return { status: 400, error: `Unknown product ${id}` };
      }
      const q = Number(qty);
      if (!Number.isInteger(q) || q < 0) {
        return { status: 400, error: `Invalid quantity for ${id}` };
      }
      subtotal += prod.price * q;
    }
    // Default response
    let valid = false;
    let discount = 0;
    if (code === 'STUDENT10') {
      if (subtotal >= 299) {
        valid = true;
        // 10% discount, rounded to nearest rupee, capped at 100
        discount = Math.round(subtotal * 0.10);
        if (discount > 100) discount = 100;
      }
    }
    return { status: 200, valid, discount };
  }

  // Unknown action
  return { status: 404, error: 'Action not supported' };
}
