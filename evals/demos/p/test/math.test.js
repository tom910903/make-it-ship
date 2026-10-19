import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/math.js';

test('clamp', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});
