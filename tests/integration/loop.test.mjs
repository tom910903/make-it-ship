import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT } from '../helpers.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const stop = (cwd, extra = {}) => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, 'Stop'], { input: JSON.stringify({ hook_event_name: 'Stop', cwd, ...extra }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};
const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } };

test('mis loop: start / status / cancel', () => {
  const dir = makeRepo();
  assert.equal(ok(mis(dir, ['loop', 'status'])).active, false);
  const s = ok(mis(dir, ['loop', 'start', '--max', '5', 'fix', 'the', 'importer']));
  assert.deepEqual([s.active, s.iteration, s.max, s.task], [true, 0, 5, 'fix the importer']);
  assert.equal(mis(dir, ['loop', 'start', 'again']).code, 1, 'one loop at a time');
  assert.equal(ok(mis(dir, ['loop', 'cancel'])).active, false);
  assert.equal(mis(dir, ['loop', 'start', '--max', '0', 'x']).code, 1);
});

test('Stop with an active loop and no verified run blocks and counts iterations', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', '--max', '3', 'add csv export']));
  const r1 = stop(dir);
  assert.equal(r1.decision, 'block');
  assert.match(r1.reason, /LOOP 1\/3/);
  assert.match(r1.reason, /add csv export/);
  assert.match(r1.reason, /make-it-ship:run/, 'no run yet → start one');
  ok(mis(dir, ['start', '--input', 'x']));
  const r2 = stop(dir);
  assert.match(r2.reason, /LOOP 2\/3/);
  assert.match(r2.reason, /verdict (PARTIAL|FAILED)/);
  stop(dir);
  const last = stop(dir);
  assert.equal(last?.decision, undefined, 'limit reached → stop allowed');
  assert.match(last.systemMessage, /iteration limit/);
  assert.equal(ok(mis(dir, ['loop', 'status'])).active, false);
});

test('Stop ends the loop once the run is reported VERIFIED; a BLOCKED run lets the session stop for the user', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['loop', 'start', 'x']));
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  const bdir = makeRepo();
  ok(mis(bdir, ['loop', 'start', 'x'])); ok(mis(bdir, ['start', '--input', 'x'])); ok(mis(bdir, ['block', 'needs', 'credentials']));
  const b = stop(bdir);
  assert.equal(b?.decision, undefined);
  assert.match(b.systemMessage, /BLOCKED/);
  assert.equal(ok(mis(bdir, ['loop', 'status'])).active, true, 'loop survives a block');
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  assert.equal(stop(dir).decision, 'block', 'VERIFIED but no report yet → keep going');
  ok(mis(dir, ['report']));
  const done = stop(dir);
  assert.equal(done?.decision, undefined);
  assert.match(done.systemMessage, /VERIFIED/);
  assert.equal(ok(mis(dir, ['loop', 'status'])).active, false);
});

test('Stop without a loop: silent, except a context warning from transcript usage', () => {
  const dir = makeRepo();
  assert.equal(stop(dir), null);
  const t = join(mkdtempSync(join(tmpdir(), 'mis-t-')), 't.jsonl');
  writeFileSync(t, [JSON.stringify({ type: 'user' }), JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 160000, cache_creation_input_tokens: 2000 } } })].join('\n'));
  const w = stop(dir, { transcript_path: t });
  assert.match(w.systemMessage, /context .*8\d%/i);
  assert.equal(w.decision, undefined);
});

test('Stop lets the session stop while the run waits for the user (AWAITING_APPROVAL), keeping the loop', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', 'x']));
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'r']));
  assert.equal(ok(mis(dir, ['status', '--json'])).state.state, 'AWAITING_APPROVAL');
  const r = stop(dir);
  assert.equal(r?.decision, undefined);
  assert.match(r.systemMessage, /waiting for the user/i);
  assert.equal(ok(mis(dir, ['loop', 'status'])).iteration, 0);
});
