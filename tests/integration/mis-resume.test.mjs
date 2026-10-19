import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeRepo, write, mis, MIS } from '../helpers.mjs';
import { stateRoot } from '../../scripts/lib/state.mjs';

const CFG = { version: 1, checks: {
  unit: { argv: ['node', '-e', 'process.exit(require("fs").existsSync("broken.txt") ? 1 : 0)'] },
  slow: { argv: ['node', '-e', 'setTimeout(()=>{}, 60000)'], timeoutSec: 120 },
} };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('resume after a session is killed mid-check: stale lock reclaimed, changes and stale evidence listed', async () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'src.txt': 'v1\n' });
  const { runId } = ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }, { id: 'T2', title: 'u', acceptance: ['b'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  ok(mis(dir, ['task', 'T1', 'start']));
  ok(mis(dir, ['check', 'unit']));

  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [MIS, 'check', 'slow'], { cwd: dir, env, stdio: 'ignore' });
  const marker = join(stateRoot(dir), 'runs', runId, 'running', `${child.pid}.json`);
  for (let i = 0; i < 100 && !existsSync(marker); i++) await sleep(50);
  assert.ok(existsSync(marker), 'running check leaves a marker');
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));

  write(dir, { 'src.txt': 'v2\n', 'added.txt': 'new' });
  const r = ok(mis(dir, ['resume']));
  assert.equal(r.runId, runId);
  assert.equal(r.state, 'EXECUTING');
  assert.deepEqual(r.interruptedChecks.map((c) => c.check), ['slow'], 'killed check reported');
  assert.ok(!existsSync(marker), 'marker cleaned up');
  assert.deepEqual(r.changedSinceLastEvent.map((c) => c.path).sort(), ['added.txt', 'src.txt']);
  assert.deepEqual(r.staleEvidence.map((e) => e.id), ['E1']);
  assert.deepEqual(r.inProgressTasks, ['T1']);
  assert.ok(r.next.length > 0);
  assert.equal(ok(mis(dir, ['task', 'T1', 'done'])).status, 'DONE', 'usable again');
});

test('resume by run id switches the current run; unknown id fails', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  const a = ok(mis(dir, ['start', '--input', 'first']));
  ok(mis(dir, ['cancel']));
  ok(mis(dir, ['start', '--input', 'second']));
  assert.notEqual(mis(dir, ['resume', 'nope']).code, 0);
  const r = ok(mis(dir, ['resume', a.runId]));
  assert.equal(r.runId, a.runId);
  assert.equal(r.state, 'CANCELLED');
  const cur = readFileSync(join(stateRoot(dir), 'current'), 'utf8').trim();
  assert.equal(cur, a.runId);
});
