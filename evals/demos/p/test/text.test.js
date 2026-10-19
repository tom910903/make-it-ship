import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squish } from '../src/text.js';

test('squish', () => assert.equal(squish('  a   b \n c '), 'a b c'));
