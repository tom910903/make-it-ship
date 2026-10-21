import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot } from '../../scripts/lib/state.mjs';
import { makeRepo, write, mis } from '../helpers.mjs';
import { benchStatus } from '../../scripts/lib/commands.mjs';

const CFG = { version: 1, checks: {
  unit: { argv: ['node', '-e', '0'] },
  perf: { argv: ['node', '-e', 'const t=Date.now(); while(Date.now()-t < (require("fs").existsSync("slow") ? 250 : 40));'] },
  broken: { argv: ['node', '-e', 'process.exit(1)'] },
} };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
// pins the baseline (first perf note) to an extreme value, so OK/REGRESSION do not depend on wall-clock jitter under load
const setBaseline = (dir, ms) => {
  const root = stateRoot(dir);
  const f = join(root, 'runs', readFileSync(join(root, 'current'), 'utf8').trim(), 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  s.notes.find((n) => n.kind === 'bench' && n.check === 'perf').medianMs = ms;
  writeFileSync(f, JSON.stringify(s));
};

test('bench: median of N runs, compared with the first measurement in the run; regression shows in the report', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  const base = ok(mis(dir, ['bench', 'perf', '--runs', '3']));
  assert.equal(base.runs, 3);
  assert.ok(base.medianMs >= 30, JSON.stringify(base));
  assert.equal(base.status, 'BASELINE');
  // end to end with a pinned baseline; the exact OK/WARN/REGRESSION thresholds are checked with fixed numbers below
  setBaseline(dir, 1e6);
  const same = ok(mis(dir, ['bench', 'perf', '--runs', '5']));
  assert.equal(same.status, 'OK', JSON.stringify(same));
  assert.equal(same.baselineMs, 1e6);
  setBaseline(dir, 1);
  write(dir, { slow: '1' });
  const slow = ok(mis(dir, ['bench', 'perf', '--runs', '3']));
  assert.equal(slow.status, 'REGRESSION');
  assert.equal(slow.baselineMs, 1);
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

test('bench thresholds: +20% WARN, +50% REGRESSION, first measurement is the baseline, failures are FAILED', () => {
  assert.deepEqual(benchStatus(100, undefined), { deltaPct: null, status: 'BASELINE' });
  assert.deepEqual(benchStatus(115, 100), { deltaPct: 15, status: 'OK' });
  assert.deepEqual(benchStatus(120, 100), { deltaPct: 20, status: 'OK' });
  assert.deepEqual(benchStatus(121, 100), { deltaPct: 21, status: 'WARN' });
  assert.deepEqual(benchStatus(151, 100), { deltaPct: 51, status: 'REGRESSION' });
  assert.deepEqual(benchStatus(80, 100), { deltaPct: -20, status: 'OK' });
  assert.equal(benchStatus(100, 100, 'exit 1').status, 'FAILED');
});
