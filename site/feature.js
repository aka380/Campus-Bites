// site/feature.js
/** CampusBites feature implementation for menu slot.
 * Provides a vegetarian filter and coupon application.
 */
export const feature = { name: 'Veg-Only Filter and Coupon', slot: 'menu' };

// Initial state for the feature
export function initialState() {
  return {
    vegOnly: false,
    coupon: null,
    discount: 0,
  };
}

// Render the UI for the feature panel
export function render(view) {
  const { vegOnly, coupon } = view.state;
  // Checkbox for veg filter
  const vegChecked = vegOnly ? 'checked' : '';
  const vegHtml = `<div class="row"><label><input type="checkbox" name="vegOnly" data-action="toggleVeg" ${vegChecked}> Veg Only</label></div>`;
  // Coupon input and apply button
  const codeVal = coupon ? view.esc(coupon) : '';
  const couponHtml = `<div class="row"><input name="code" placeholder="Coupon code" value="${codeVal}"><button data-action="apply">Apply</button></div>`;
  return vegHtml + couponHtml;
}

// Handle actions from the UI
export async function onAction(action, input, view, api) {
  const state = view.state;
  if (action === 'toggleVeg') {
    // input.vegOnly is boolean from checkbox
    return { ...state, vegOnly: !!input.vegOnly };
  }
  if (action === 'apply') {
    const code = (input.code || '').trim();
    if (!code) return state;
    // Build items map from view.items (array of {id, qty})
    const items = {};
    for (const it of view.items) {
      if (it.qty > 0) items[it.id] = it.qty;
    }
    try {
      const res = await api('apply-coupon', { code, items });
      if (res.valid) {
        return { ...state, coupon: code, discount: res.discount };
      } else {
        // invalid coupon clears discount but keep code for UI display
        return { ...state, coupon: code, discount: 0 };
      }
    } catch (e) {
      // network or server error – keep state unchanged
      return state;
    }
  }
  // unknown action – no state change
  return state;
}

// Optional: add a summary line for discount
export function summaryLines(view) {
  const { coupon, discount } = view.state;
  if (coupon && discount > 0) {
    return [{ label: coupon, amount: -discount }];
  }
  return [];
}

// Optional: filter products based on vegOnly flag
export function filterProducts(products, view) {
  if (view.state.vegOnly) {
    return products.filter(p => p.veg);
  }
  return products;
}
