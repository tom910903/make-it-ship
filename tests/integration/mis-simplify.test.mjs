import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('check warns when a dependency manifest changed without a recorded reason (AC#7)', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'package.json': '{"name":"a"}' });
  ok(mis(dir, ['start', '--input', 'x']));
  assert.deepEqual(ok(mis(dir, ['check', 'unit'])).warnings, []);
  write(dir, { 'package.json': '{"name":"a","dependencies":{"left-pad":"1"}}' });
  const r = ok(mis(dir, ['check', 'unit']));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /package\.json.*mis note dep/);
  ok(mis(dir, ['note', 'dep', 'needed for X']));
  assert.deepEqual(ok(mis(dir, ['check', 'unit'])).warnings, []);
});

test('report lists shortcut: debt markers (ponytail-debt format) and flags missing upgrade triggers', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, '.gitignore': 'ignored/\n' });
  write(dir, {
    'a.js': 'const x = 1; // shortcut: in-memory cache only, move to redis above 1 node\n',
    'b.py': 'x = 2  # shortcut: no retry\n',
    'c.md': 'Use the shortcut: convention in docs prose\n',
    'ignored/d.js': '// shortcut: should not appear\n',
  });
  ok(mis(dir, ['start', '--input', 'x']));
  const r = ok(mis(dir, ['report']));
  const full = readFileSync(join(dir, r.path), 'utf8');
  assert.match(full, /## 10\. 의도적 지름길/);
  const md = full.split('## 10. ')[1].split('## 정직성')[0];
  assert.match(md, /a\.js:1`? — in-memory cache only, move to redis above 1 node/);
  assert.match(md, /b\.py:1`? — no retry \(no-trigger\)/);
  assert.doesNotMatch(md, /c\.md/);
  assert.doesNotMatch(md, /ignored\/d\.js/);
  assert.match(md, /2 markers, 1 with no trigger/);
});
