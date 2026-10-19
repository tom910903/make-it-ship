import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets } from '../../scripts/lib/mask.mjs';

test('masks env secret values and well-known token shapes', () => {
  const env = { API_TOKEN: 'supersecretvalue123', DB_PASSWORD: 'hunter2hunter2', HOME: '/Users/x', SHORT_KEY: 'abc' };
  const text = [
    'token=supersecretvalue123 used',
    'db hunter2hunter2',
    'home /Users/x',
    'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'openai sk-proj-abcdefghijklmnopqrstuvwx',
    'aws AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdef0123456789abcdef',
    'password: p@ss',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const m = maskSecrets(text, env);
  for (const secret of ['supersecretvalue123', 'hunter2hunter2', 'ghp_abcdef', 'sk-proj-abc', 'AKIAABCDEFGHIJKLMNOP', 'abcdef0123456789abcdef', 'p@ss', 'MIIabc']) {
    assert.ok(!m.includes(secret), `leaked ${secret}:\n${m}`);
  }
  assert.ok(m.includes('/Users/x'), 'non-secret env kept');
  assert.ok(m.includes('***'));
});
