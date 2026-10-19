import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEdit, canView } from '../src/authz.js';

test('edit', () => {
  assert.equal(canEdit({ id: 1, role: 'editor' }, { id: 9, ownerId: 2 }), true);
  assert.equal(canEdit({ id: 3, role: 'viewer' }, { id: 9, ownerId: 2 }), false);
});
test('view', () => assert.equal(canView({ role: 'viewer' }), true));
