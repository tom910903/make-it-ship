import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { makeRepo, mis, MIS } from '../helpers.mjs';

const CFG = { version: 1, checks: {
  unit: { argv: ['node', '-e', '0'] },
  slow: { argv: ['node', '-e', 'setTimeout(()=>{}, 3000)'], timeoutSec: 60 },
} };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const env = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
const runAsync = (cwd, args) => new Promise((res) => {
  const c = spawn(process.execPath, [MIS, ...args], { cwd, env: env() });
  let out = '', err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.on('exit', (code) => res({ code, out, err }));
});

test('concurrent mis writers wait for the lock instead of failing or losing updates', async () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  const N = 8;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => runAsync(dir, ['interview', 'add', JSON.stringify({ question: `q${i}?`, impact: 'LOW' })])));
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const items = ok(mis(dir, ['status', '--json'])).state.interview;
  assert.equal(items.length, N);
  assert.equal(new Set(items.map((q) => q.id)).size, N, 'unique ids');
});

test('a long-running check does not hold the run lock', async () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  const slow = runAsync(dir, ['check', 'slow']);
  await new Promise((r) => setTimeout(r, 800));
  const t0 = Date.now();
  ok(mis(dir, ['check', 'unit']));
  assert.ok(Date.now() - t0 < 2500, 'other commands proceed while slow check runs');
  assert.equal((await slow).code, 0);
  const ev = ok(mis(dir, ['status', '--json'])).state.evidence;
  assert.deepEqual(ev.map((e) => e.check).sort(), ['slow', 'unit']);
  assert.equal(new Set(ev.map((e) => e.id)).size, 2);
});
