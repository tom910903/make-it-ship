import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, lineTotal } from '../src/cart.js';

test('lineTotal', () => {
  assert.equal(lineTotal({ priceCents: 250, qty: 3 }), 750);
});

test('cartTotal without discount', () => {
  assert.equal(cartTotal([{ priceCents: 100, qty: 2 }, { priceCents: 50, qty: 1 }]), 250);
});

test('cartTotal with 15% discount rounds the discount half up', () => {
  // subtotal 1050, 15% = 157.5 → discount 158 → total 892
  assert.equal(cartTotal([{ priceCents: 1050, qty: 1 }], { percent: 15 }), 892);
});
