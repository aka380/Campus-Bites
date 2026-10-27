/** CampusBites feature implementation
 * Provides a Veg‑Only filter for the menu (via hook) and a coupon input for the bag.
 */
export const feature = {
  name: 'Veg Filter and Coupon',
  slot: 'bag', // coupon UI appears in bag panel; veg filter works via hook
};

export function initialState() {
  return {
    vegOnly: false,
    code: '',
    // discount and valid are kept for backward compatibility but not used for calculation
    discount: 0,
    valid: false,
  };
}

// Render coupon controls first, then veg‑only filter.
export function render(view) {
  const s = view.state || {};
  const codeVal = s.code ? view.esc(s.code) : '';
  return (
    `<div class="row"><input name="code" value="${codeVal}"><button data-action="apply-coupon">Apply</button></div>` +
    `<div class="row"><label><input type="checkbox" name="vegOnly" data-action="toggleVeg"${s.vegOnly ? ' checked' : ''}> Veg-Only</label></div>`
  );
}

export async function onAction(action, input, view, api) {
  const prev = view.state || {};
  if (action === 'toggleVeg') {
    return { ...prev, vegOnly: Boolean(input.vegOnly) };
  }
  if (action === 'apply-coupon') {
    const code = input.code || '';
    // send to backend to validate and get discount (may be used elsewhere)
    const items = (view.items || []).map(i => ({ id: i.id, qty: i.qty }));
    const resp = await api('apply-coupon', { code, items });
    const valid = !!resp.valid;
    const discount = Number.isFinite(resp.discount) ? resp.discount : 0;
    return { ...prev, code, valid, discount };
  }
  return prev;
}

// Compute discount line dynamically based on current subtotal and stored coupon code.
export function summaryLines(view) {
  const s = view.state || {};
  if (s.code !== 'STUDENT10') return [];
  // STUDENT10 discount rules: 10% of subtotal, rounded to nearest rupee, min subtotal 299, max discount 100.
  if (view.subtotal < 299) return [];
  const raw = view.subtotal * 0.10;
  const rounded = Math.round(raw);
  const discount = Math.min(100, rounded);
  return [{ label: `Discount (${s.code})`, amount: -discount }];
}

export function filterProducts(products, view) {
  if (view.state?.vegOnly) {
    return products.filter(p => p.veg);
  }
  return products;
}
