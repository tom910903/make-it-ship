import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.ts';

test('hours and minutes', () => {
  assert.equal(parseDuration('1h30m'), 5400);
  assert.equal(parseDuration('45m'), 2700);
});
