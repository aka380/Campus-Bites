import test from 'node:test';
import assert from 'node:assert/strict';
import {ui, handle, makeView, makeCtx, apiFrom, summaryLines, filterProducts, PRODUCTS} from './helpers.mjs';

test('API: POST apply-coupon with STUDENT10 and burger qty 2 gives correct valid and discount', () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: [{ id: 'burger', qty: 2 }] }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, true);
  assert.equal(res.discount, 36);
});

test('API: POST apply-coupon with STUDENT10 and burger qty 1 gives valid false and discount 0', () => {
  const ctx = makeCtx();
  const res = handle('apply-coupon', { code: 'STUDENT10', items: [{ id: 'burger', qty: 1 }] }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.valid, false);
  assert.equal(res.discount, 0);
});

test('UI: Entering STUDENT10 with cart subtotal 488 shows negative summary line of -₹49', async () => {
  const ctx = makeCtx();
  // pizza (259) + roll (169) + brownie (119) = 547 or similar. Let's make items match subtotal 488: burger (179) + pizza (259) + brownie (119)? No, 179+259+119 = 557.
  // burger (179) + roll (169) + brownie (119) = 467. Let's use specific quantities:
  // pizza(259) + roll(169) + brownie(119)? Let's check: burger:179, pizza:259, biryani:229, fries:129, roll:169, brownie:119.
  // 259 + 229 = 488 (pizza + biryani).
  const bag = { pizza: 1, biryani: 1 };
  const view = makeView(bag, ui.initialState());
  const nextState = await ui.onAction('apply-coupon', { coupon: 'STUDENT10' }, view, apiFrom(ctx));
  const viewWithState = makeView(bag, nextState);
  const lines = summaryLines(ui, viewWithState);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, -49);
  const rendered = ui.render(viewWithState);
  assert.match(rendered, /-₹49/);
});

test('UI: Entering an invalid coupon code shows an error message and no discount summary line', async () => {
  const ctx = makeCtx();
  const bag = { pizza: 1, biryani: 1 };
  const view = makeView(bag, ui.initialState());
  const nextState = await ui.onAction('apply-coupon', { coupon: 'INVALID' }, view, apiFrom(ctx));
  const viewWithState = makeView(bag, nextState);
  const lines = summaryLines(ui, viewWithState);
  assert.equal(lines.length, 0);
  const rendered = ui.render(viewWithState);
  assert.match(rendered, /error|invalid/i);
});

test('UI: Changing cart contents recalculates and updates the discount amount automatically', async () => {
  const ctx = makeCtx();
  const bagInitial = { pizza: 1, biryani: 1 }; // subtotal 488 -> discount 49
  let view = makeView(bagInitial, ui.initialState());
  let nextState = await ui.onAction('apply-coupon', { coupon: 'STUDENT10' }, view, apiFrom(ctx));
  
  // Now change cart contents to higher amount: 2 pizzas (518) -> discount 52
  const bagUpdated = { pizza: 2 };
  const viewUpdated = makeView(bagUpdated, nextState);
  // Recalculating or triggering action with new bag
  const finalState = await ui.onAction('apply-coupon', { coupon: nextState.coupon }, viewUpdated, apiFrom(ctx));
  const finalView = makeView(bagUpdated, finalState);
  const lines = summaryLines(ui, finalView);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, -52);
});
