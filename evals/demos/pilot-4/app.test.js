import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from './app.js';

test('format', () => assert.equal(format(65), '01:05'));
