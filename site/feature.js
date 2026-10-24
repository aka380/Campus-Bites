// site/feature.js
/** CampusBites feature: Student Discount coupon handling in the bag view */
export const feature = {
  name: 'Student Discount',
  slot: 'bag',
};

/** Initial UI state */
export function initialState() {
  return {
    coupon: '', // entered coupon code
    discount: 0, // last known discount from server (used for immediate feedback)
    error: '', // error message to display
  };
}

/** Helper to compute discount based on view subtotal and coupon */
function computeDiscount(coupon, view) {
  if (!coupon) return 0;
  const code = coupon.trim().toUpperCase();
  if (code !== 'STUDENT10') return 0;
  const subtotal = view.subtotal; // food subtotal (delivery excluded)
  if (subtotal < 299) return 0;
  let disc = Math.round(subtotal * 0.10);
  if (disc > 100) disc = 100;
  return disc;
}

/** Render the bag panel */
export function render(view) {
  const { coupon, error, discount } = view.state;
  const input = `<input name="coupon" value="${view.esc(coupon)}" placeholder="Enter coupon code" />`;
  const button = `<button data-action="apply-coupon">Apply</button>`;
  const errorMsg = error ? `<p class="error">${view.esc(error)}</p>` : '';
  // Show current discount (recomputed) for user feedback
  const currentDiscount = computeDiscount(coupon, view);
  const status = currentDiscount > 0 ? `<p class="success">Discount applied: -₹${currentDiscount}</p>` : '';
  return `
    <div class="row">
      ${input}
      ${button}
    </div>
    ${status}
    ${errorMsg}
  `;
}

/** Handle actions from the UI */
export async function onAction(action, input, view, api) {
  const state = view.state;
  if (action === 'apply-coupon') {
    const couponCode = (input.coupon ?? '').trim();
    // Prepare items for server validation (id and qty only)
    const items = view.items.map((it) => ({ id: it.id, qty: it.qty }));
    try {
      const res = await api('apply-coupon', { code: couponCode, items });
      if (res.valid) {
        // Store coupon; discount will be recomputed in summaryLines/render
        return { ...state, coupon: couponCode, discount: res.discount, error: '' };
      }
      // Invalid or not eligible
      return { ...state, coupon: couponCode, discount: 0, error: 'Invalid coupon or not eligible' };
    } catch (e) {
      return { ...state, error: e.message || 'Error applying coupon', discount: 0 };
    }
  }
  // Unknown action – no state change
  return state;
}

/** Provide extra summary line for the bag */
export function summaryLines(view) {
  const { coupon } = view.state;
  const disc = computeDiscount(coupon, view);
  if (disc > 0) {
    return [{ label: `Student Discount (${coupon.trim().toUpperCase()})`, amount: -disc }];
  }
  return [];
}
