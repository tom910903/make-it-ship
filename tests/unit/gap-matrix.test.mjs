// docs/research/gap-matrix.md integrity: well-formed rows, one status each, open rows say what and why, and the
// generated count blocks equal a recount of the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILE, parse, render } from '../../scripts/gap-matrix.mjs';

test('every gap-matrix row has 7 cells, one valid status, and open rows name the missing part, the reason and one group', () => {
  const { rows, errors } = parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(errors, []);
  assert.ok(rows.length > 300);
});

test('gap-matrix count blocks match the rows (regenerate with node scripts/gap-matrix.mjs --write)', () => {
  const text = readFileSync(FILE, 'utf8');
  assert.equal(render(text), text);
});

test('the parser catches an unescaped pipe and a missing reason', () => {
  const bad = '| OMC | x | skill | d | ABSORBED | `a|b` | — |\n| OMC | y | skill | d | MISSING | — | 남음: z → M9-A |\n';
  const { errors } = parse(bad);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /8 cells/);
  assert.match(errors[1], /사유/);
});
