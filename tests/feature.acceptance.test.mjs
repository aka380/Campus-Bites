import test from 'node:test';
import assert from 'node:assert/strict';
import {ui, handle, makeView, makeCtx, apiFrom, summaryLines, filterProducts, PRODUCTS} from './helpers.mjs';

test('API: apply-coupon with code STUDENT10 and items pizza (1) and biryani (1) returns valid true and discount 49', () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: [{id:'pizza', qty:1}, {id:'biryani', qty:1}] }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, true);
  assert.equal(res.discount, 49);
});

test('API: apply-coupon with code STUDENT10 and items pizza (1) (subtotal 259, below 299) returns valid false and discount 0', () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: [{id:'pizza', qty:1}] }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, false);
  assert.equal(res.discount, 0);
});

test('API: apply-coupon with invalid code NOTSTUDENT10 and items pizza (2) returns valid false and discount 0', () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'NOTSTUDENT10', items: [{id:'pizza', qty:2}] }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, false);
  assert.equal(res.discount, 0);
});

test('UI: Toggling the vegOnly checkbox filters the menu to display only vegetarian items while preserving all items when disabled', () => {
  const defaultView = makeView({}, { vegOnly: false });
  assert.match(ui.render(defaultView), /type=["']checkbox["']/i);
  assert.match(ui.render(defaultView), /data-action=["']toggleVeg["']/i);
  const allFiltered = filterProducts(ui, PRODUCTS, defaultView);
  assert.equal(allFiltered.length, PRODUCTS.length);

  const vegView = makeView({}, { vegOnly: true });
  const vegFiltered = filterProducts(ui, PRODUCTS, vegView);
  assert.ok(vegFiltered.length > 0);
  for (const item of vegFiltered) {
    assert.equal(item.veg, true);
  }
});

test('UI: Entering STUDENT10 and clicking the apply action on a 488 cart displays a negative summary line of -49', async () => {
  const ctx = makeCtx();
  const view = makeView({ pizza: 1, biryani: 1 });
  const html = ui.render(view);
  assert.match(html, /<input\b[^>]*name=["']code["']/i);
  assert.match(html, /data-action=["']apply-coupon["']/i);

  const newState = await ui.onAction('apply-coupon', { code: 'STUDENT10' }, view, apiFrom(ctx));
  const updatedView = makeView({ pizza: 1, biryani: 1 }, newState);
  const lines = summaryLines(ui, updatedView);

  const discountLine = lines.find(l => l.amount < 0);
  assert.ok(discountLine, 'Should have a negative summary line for discount');
  assert.equal(discountLine.amount, -49);
});

test('UI: changing bag items automatically recalculates discount based on current subtotal without retaining invalid discounts', () => {
  const reducedView = makeView({ pizza: 1 }, { code: 'STUDENT10', valid: true, discount: 49, vegOnly: false });
  const lines = summaryLines(ui, reducedView);
  assert.equal(lines.length, 0);
});
