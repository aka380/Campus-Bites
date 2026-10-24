/** CampusBites feature slot (backend), served at POST /api/feature/<action>.
 * Implements the STUDENT10 coupon logic.
 */
export function handle(action, body, ctx) {
  // Only support the apply-coupon action.
  if (action !== 'apply-coupon') {
    return { status: 404, error: 'Action not found' };
  }

  // Basic validation of the request body.
  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Missing request body' };
  }
  const { code, items } = body;
  if (typeof code !== 'string') {
    return { status: 400, error: 'Missing or invalid coupon code' };
  }
  if (!Array.isArray(items)) {
    return { status: 400, error: 'Missing or invalid items array' };
  }
  // Validate each item.
  for (const it of items) {
    if (!it || typeof it !== 'object') {
      return { status: 400, error: 'Invalid item format' };
    }
    if (typeof it.id !== 'string' || typeof it.qty !== 'number' || !Number.isInteger(it.qty) || it.qty < 0) {
      return { status: 400, error: 'Invalid item fields' };
    }
  }

  // Compute subtotal using server‑side product prices (ignore delivery).
  const priceMap = {};
  for (const p of ctx.products) {
    priceMap[p.id] = p.price;
  }
  let subtotal = 0;
  for (const it of items) {
    const price = priceMap[it.id];
    if (price == null) {
      // Unknown product id – treat as error.
      return { status: 400, error: `Unknown product id: ${it.id}` };
    }
    subtotal += price * it.qty;
  }

  // Default response.
  let valid = false;
  let discount = 0;

  // STUDENT10 coupon logic.
  if (code === 'STUDENT10') {
    if (subtotal >= 299) {
      // 10% discount, rounded to nearest rupee, capped at 100.
      discount = Math.round(subtotal * 0.10);
      if (discount > 100) discount = 100;
      valid = true;
    }
  }

  // Return the result.
  return { status: 200, valid, discount };
}
