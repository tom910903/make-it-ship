import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const CFG = { version: 1, checks: {
  unit: { argv: ['node', '-e', '0'] },
  perf: { argv: ['node', '-e', 'const t=Date.now(); while(Date.now()-t < (require("fs").existsSync("slow") ? 250 : 40));'] },
  broken: { argv: ['node', '-e', 'process.exit(1)'] },
} };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('bench: median of N runs, compared with the first measurement in the run; regression shows in the report', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  const base = ok(mis(dir, ['bench', 'perf', '--runs', '3']));
  assert.equal(base.runs, 3);
  assert.ok(base.medianMs >= 30, JSON.stringify(base));
  assert.equal(base.status, 'BASELINE');
  const same = ok(mis(dir, ['bench', 'perf', '--runs', '5']));
  assert.equal(same.status, 'OK', JSON.stringify(same));
  write(dir, { slow: '1' });
  const slow = ok(mis(dir, ['bench', 'perf', '--runs', '3']));
  assert.equal(slow.status, 'REGRESSION');
  assert.ok(slow.deltaPct > 50);
  const md = readFileSync(join(dir, ok(mis(dir, ['report'])).path), 'utf8');
  assert.match(md, /성능 회귀: perf/);
});

test('bench of a failing command reports FAILED, undefined check is an error', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  assert.equal(ok(mis(dir, ['bench', 'broken', '--runs', '2'])).status, 'FAILED');
  assert.notEqual(mis(dir, ['bench', 'nope']).code, 0);
});
