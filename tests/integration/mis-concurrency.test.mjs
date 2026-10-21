import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot } from '../../scripts/lib/state.mjs';
import { makeRepo, mis, MIS } from '../helpers.mjs';

const CFG = { version: 1, checks: {
  unit: { argv: ['node', '-e', '0'] },
  // blocks until the test creates ./release, so "the fast check finished while the slow one was still running" is deterministic
  slow: { argv: ['node', '-e', 'const fs=require("fs"); const t=setInterval(()=>{ if (fs.existsSync("release")) { clearInterval(t); } }, 20)'], timeoutSec: 120 },
} };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
// the lock wait is raised so that "waits instead of failing" holds under heavy load (8 writers exceeded the 30 s default at load avg ~170)
const env = () => { const e = { ...process.env, MIS_LOCK_WAIT_MS: '600000' }; delete e.NODE_TEST_CONTEXT; return e; };
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
  const { runId } = ok(mis(dir, ['status', '--json'])).state;
  const running = join(stateRoot(dir), 'runs', runId, 'running');
  for (let k = 0; k < 600 && !(existsSync(running) && readdirSync(running).length); k++) await new Promise((r) => setTimeout(r, 50));
  ok(mis(dir, ['check', 'unit'])); // must complete while the slow check is still running (it cannot end before ./release exists)
  assert.ok(readdirSync(running).length > 0, 'slow check still running after the fast one finished');
  writeFileSync(join(dir, 'release'), '1');
  assert.equal((await slow).code, 0);
  const ev = ok(mis(dir, ['status', '--json'])).state.evidence;
  assert.deepEqual(ev.map((e) => e.check).sort(), ['slow', 'unit']);
  assert.equal(new Set(ev.map((e) => e.id)).size, 2);
});
