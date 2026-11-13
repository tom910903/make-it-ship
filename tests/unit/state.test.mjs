import { mkdtempSync as _mk, writeFileSync as _wf, existsSync as _ex } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
import { join as _join } from 'node:path';
import { reclaimLock } from '../../scripts/lib/state.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, git } from '../helpers.mjs';
import { stateRoot, createRun, loadRun, saveState, withLock, canTransition, transition, newRunId, readEvents } from '../../scripts/lib/state.mjs';

test('state root lives in the git common dir, shared by worktrees', () => {
  const dir = makeRepo();
  assert.equal(stateRoot(dir), join(dir, '.git', 'make-it-ship'));
  const wt = dir + '-wt';
  git(dir, 'worktree', 'add', '-q', wt);
  assert.equal(stateRoot(wt), join(dir, '.git', 'make-it-ship'));
});

test('run id format', () => {
  assert.match(newRunId(new Date('2026-10-19T09:53:00')), /^20261019-0953-[0-9a-f]{4}$/);
});

test('create/load/save: atomic state + append-only events + current pointer', () => {
  const dir = makeRepo();
  const run = createRun(dir, { input: { kind: 'text', text: 'hi' }, baseCommit: 'abc' });
  assert.equal(run.state.state, 'PLANNING');
  assert.equal(run.state.schema, 1);
  const loaded = loadRun(dir);
  assert.equal(loaded.state.runId, run.state.runId);
  loaded.state.mode = 'quick';
  saveState(loaded, { type: 'mode', mode: 'quick' });
  assert.equal(loadRun(dir).state.mode, 'quick');
  const ev = readEvents(loaded);
  assert.deepEqual(ev.map((e) => e.type), ['start', 'mode']);
  assert.ok(ev.every((e) => e.at));
  assert.ok(!readdirSync(loaded.dir).some((f) => f.endsWith('.tmp')), 'no temp files left');
});

test('loadRun without a run returns null', () => {
  assert.equal(loadRun(makeRepo()), null);
});

test('transition table: allowed and refused', () => {
  const ok = [['PLANNING', 'AWAITING_APPROVAL'], ['PLANNING', 'EXECUTING'], ['AWAITING_APPROVAL', 'EXECUTING'],
    ['AWAITING_APPROVAL', 'PLANNING'], ['EXECUTING', 'VERIFYING'], ['VERIFYING', 'EXECUTING'], ['VERIFYING', 'REPORTED'], ['REPORTED', 'VERIFYING'],
    ['EXECUTING', 'BLOCKED'], ['PLANNING', 'CANCELLED'], ['VERIFYING', 'BLOCKED']];
  const bad = [['PLANNING', 'VERIFYING'], ['PLANNING', 'REPORTED'], ['AWAITING_APPROVAL', 'VERIFYING'],
    ['EXECUTING', 'REPORTED'], ['REPORTED', 'EXECUTING'], ['CANCELLED', 'PLANNING'], ['REPORTED', 'BLOCKED'],
    ['REPORTED', 'CANCELLED'], ['BLOCKED', 'VERIFYING'], ['CANCELLED', 'VERIFYING']];
  for (const [a, b] of ok) assert.ok(canTransition(a, b), `${a}->${b}`);
  for (const [a, b] of bad) assert.ok(!canTransition(a, b), `${a}-/->${b}`);
  const s = { state: 'PLANNING' };
  assert.throws(() => transition(s, 'REPORTED'), /PLANNING -> REPORTED/);
  transition(s, 'EXECUTING');
  assert.equal(s.state, 'EXECUTING');
});

test('lock: exclusive while holder alive, stale lock reclaimed', () => {
  const dir = makeRepo();
  const run = createRun(dir, { input: { kind: 'text', text: 'x' } });
  const lock = join(run.dir, 'lock');
  withLock(run, () => {
    assert.ok(existsSync(lock));
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
    assert.throws(() => withLock(run, () => {}, { waitMs: 100 }), /locked by pid/);
  });
  assert.ok(!existsSync(lock), 'released');
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: 'old' }));
  let ran = false;
  withLock(run, () => { ran = true; });
  assert.ok(ran, 'stale lock reclaimed');
});

test('lock reclaim removes only the stale lock it judged, never a lock someone created since', () => {
  const d = _mk(_join(_tmp(), 'mis-lock-'));
  const lock = _join(d, 'lock');
  _wf(lock, JSON.stringify({ pid: 999999, at: 'new-owner' }));
  reclaimLock(lock, JSON.stringify({ pid: 999998, at: 'old' }));
  assert.equal(_ex(lock), true, 'the current lock differs from what was judged stale');
  reclaimLock(lock, JSON.stringify({ pid: 999999, at: 'new-owner' }));
  assert.equal(_ex(lock), false);
  assert.equal(_ex(`${lock}.reclaim`), false);
});

test('an empty lock left by a crash between create and write is reclaimed once it is old', () => {
  const dir = makeRepo();
  const run = createRun(dir, { input: { kind: 'text', text: 'x' } });
  const lock = join(run.dir, 'lock');
  writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  utimesSync(lock, old, old);
  let ran = false;
  withLock(run, () => { ran = true; }, { waitMs: 2000 });
  assert.ok(ran);
});

test('a waiter does not spin while another process holds the reclaim marker', () => {
  const d = _mk(_join(_tmp(), 'mis-lock-'));
  const lock = _join(d, 'lock');
  _wf(lock, JSON.stringify({ pid: 999999, at: 'x' }));
  _wf(`${lock}.reclaim`, '');
  assert.equal(reclaimLock(lock, JSON.stringify({ pid: 999999, at: 'x' })), false, 'busy: report it so the caller sleeps');
  assert.ok(_ex(lock));
});

const require_fs = await import('node:fs');

test('reclaim never removes a lock that was replaced by a new file with the same (empty) content', () => {
  const d = _mk(_join(_tmp(), 'mis-lock-'));
  const lock = _join(d, 'lock');
  _wf(lock, '');
  const { statSync, unlinkSync } = require_fs;
  const oldIno = statSync(lock).ino;
  unlinkSync(lock); _wf(_join(d, 'pad'), 'x'); _wf(lock, '');
  if (statSync(lock).ino === oldIno) return; // filesystem reused the inode: nothing to distinguish here
  assert.equal(reclaimLock(lock, '', oldIno), true);
  assert.ok(_ex(lock), 'the new owner\'s lock is kept');
});

test('a fresh empty lock is kept even when the filesystem reuses the old inode number', () => {
  const d = _mk(_join(_tmp(), 'mis-lock-'));
  const lock = _join(d, 'lock');
  _wf(lock, ''); // brand-new owner mid-create; the reclaimer judged an older empty lock with this same inode number
  const { statSync } = require_fs;
  assert.equal(reclaimLock(lock, '', statSync(lock).ino), true);
  assert.ok(_ex(lock), 'a lock younger than the orphan age is never removed');
  const old = (Date.now() - 10000) / 1000;
  require_fs.utimesSync(lock, old, old);
  assert.equal(reclaimLock(lock, '', statSync(lock).ino), true);
  assert.ok(!_ex(lock), 'a still-old empty lock is reclaimed');
});
