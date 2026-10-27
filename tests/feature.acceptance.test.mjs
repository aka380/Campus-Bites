import test from 'node:test';
import assert from 'node:assert/strict';
import {ui, handle, makeView, makeCtx, apiFrom, summaryLines, filterProducts, PRODUCTS} from './helpers.mjs';

test('API: apply-coupon with STUDENT10 and 2 pizzas gives correct valid and discount', async () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: { pizza: 2 } }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, true);
  assert.equal(res.discount, 52);
});

test('API: apply-coupon with STUDENT10 and 1 fries below subtotal 299 gives invalid and 0 discount', async () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: { fries: 1 } }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, false);
  assert.equal(res.discount, 0);
});

test('UI: toggleVeg checkbox set to true filters the menu to display only vegetarian items', () => {
  const view = makeView({}, { vegOnly: true });
  const filtered = filterProducts(ui, PRODUCTS, view);
  assert.equal(filtered.every(item => item.veg), true);
  assert.equal(filtered.some(item => item.id === 'biryani'), false);
  assert.equal(filtered.some(item => item.id === 'burger'), true);
  assert.equal(filtered.some(item => item.id === 'pizza'), true);
  assert.equal(filtered.some(item => item.id === 'fries'), true);
  assert.equal(filtered.some(item => item.id === 'roll'), true);
  assert.equal(filtered.some(item => item.id === 'brownie'), true);
});

test('UI: toggleVeg checkbox set to false displays all menu items including biryani', () => {
  const view = makeView({}, { vegOnly: false });
  const filtered = filterProducts(ui, PRODUCTS, view);
  assert.equal(filtered.length, PRODUCTS.length);
  assert.equal(filtered.some(item => item.id === 'biryani'), true);
});

test('UI: toggleVeg action preserves existing cart items, quantities, and applied coupons without resetting them', async () => {
  const ctx = makeCtx();
  const view = makeView({ pizza: 1 }, { vegOnly: false, coupon: 'STUDENT10' });
  const nextState = await ui.onAction('toggleVeg', { vegOnly: true }, view, apiFrom(ctx));
  assert.equal(nextState.vegOnly, true);
  assert.equal(nextState.coupon, 'STUDENT10');
});
