import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT, passingReview } from '../helpers.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const stop = (cwd, extra = {}) => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.CLAUDE_CODE_SESSION_ID;
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
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: passingReview(dir) }));
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

test('Stop pauses a stalled loop: 3 re-entrant stops with no change in run state or verdict', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', 'x']));
  ok(mis(dir, ['start', '--input', 'x']));
  assert.equal(stop(dir).decision, 'block', 'first stop of the turn');
  assert.equal(stop(dir, { stop_hook_active: true }).decision, 'block');
  assert.equal(stop(dir, { stop_hook_active: true }).decision, 'block');
  const p = stop(dir, { stop_hook_active: true });
  assert.equal(p?.decision, undefined);
  assert.match(p.systemMessage, /no progress/i);
  assert.equal(ok(mis(dir, ['loop', 'status'])).active, true, 'paused, not ended');
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  assert.equal(stop(dir, { stop_hook_active: true }).decision, 'block', 'progress resets the stall count');
});

test('SessionStart announces an active loop', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', '--max', '9', 'port the parser']));
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, 'SessionStart'], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8', env });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /active Make It Ship loop.*port the parser.*0\/9.*mis loop cancel/s);
});

test('M6 D1: the loop belongs to the session that started it', () => {
  const dir = makeRepo();
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) }; delete env.NODE_TEST_CONTEXT;
  ok(mis(dir, ['loop', 'start', '--max', '5', 'port parser'], { env: { CLAUDE_CODE_SESSION_ID: 'A' } }));
  assert.equal(ok(mis(dir, ['loop', 'status'])).session, 'A');
  assert.equal(stop(dir, { session_id: 'B' }), null, 'another session is not held by the loop');
  assert.equal(stop(dir, { session_id: 'A' }).decision, 'block');
});

test('M6 D1: an unbound loop is claimed by the first session that stops; outside a repo too', () => {
  const nr1 = mkdtempSync(join(tmpdir(), 'mis-nr-')), nr2 = mkdtempSync(join(tmpdir(), 'mis-nr-'));
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { MIS_STATE_HOME: home };
  ok(mis(nr1, ['loop', 'start', 'x'], { env: { ...env, CLAUDE_CODE_SESSION_ID: 'A' } }));
  const s = (cwd, session_id) => {
    const e = { ...process.env, ...env }; delete e.NODE_TEST_CONTEXT; delete e.CLAUDE_CODE_SESSION_ID;
    const r = spawnSync(process.execPath, [HOOKS, 'Stop'], { input: JSON.stringify({ cwd, session_id }), encoding: 'utf8', env: e });
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  assert.equal(s(nr1, 'A').decision, 'block');
  assert.equal(s(nr2, 'B'), null);
});

test('M6 D5: a run reported before the loop started does not finish the loop', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: passingReview(dir) }));
  ok(mis(dir, ['report']));
  ok(mis(dir, ['loop', 'start', 'add feature X']));
  const r = stop(dir);
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /reported before this loop started|new run/i);
});

test('M6 D6: mis cancel also ends the loop', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', 'x']));
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['cancel']));
  const l = ok(mis(dir, ['loop', 'status']));
  assert.deepEqual([l.active, l.endReason], [false, 'cancelled']);
  assert.equal(stop(dir), null);
});

test('M6 R2-1: another session is not told to continue the loop and cannot cancel it', () => {
  const dir = makeRepo();
  ok(mis(dir, ['loop', 'start', 'A task'], { env: { CLAUDE_CODE_SESSION_ID: 'A' } }));
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) }; delete env.NODE_TEST_CONTEXT; delete env.CLAUDE_CODE_SESSION_ID;
  const ss = (sid) => JSON.parse(spawnSync(process.execPath, [HOOKS, 'SessionStart'], { input: JSON.stringify({ cwd: dir, session_id: sid }), encoding: 'utf8', env }).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ss('B'), /active Make It Ship loop/);
  assert.match(ss('A'), /active Make It Ship loop/);
  assert.equal(mis(dir, ['loop', 'cancel'], { env: { CLAUDE_CODE_SESSION_ID: 'B' } }).code, 1);
  assert.equal(ok(mis(dir, ['loop', 'status'])).active, true);
  assert.equal(ok(mis(dir, ['loop', 'cancel'], { env: { CLAUDE_CODE_SESSION_ID: 'A' } })).active, false);
});

test('M6 R2-3: re-reporting an old run is not evidence; a new run with checks after the loop started is required', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: passingReview(dir) }));
  ok(mis(dir, ['report']));
  ok(mis(dir, ['loop', 'start', 'export CSV']));
  ok(mis(dir, ['report']));
  assert.equal(stop(dir).decision, 'block', 'only a re-report');
  ok(mis(dir, ['start', '--input', 'export CSV']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: passingReview(dir) }));
  ok(mis(dir, ['report']));
  assert.match(stop(dir).systemMessage, /VERIFIED/, 'a new run with fresh checks ends it');
});

test('M6 R2-6: outside a repo a loop needs a session', () => {
  const nr = mkdtempSync(join(tmpdir(), 'mis-nr-'));
  assert.equal(mis(nr, ['loop', 'start', 'x'], { env: { MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) } }).code, 1);
});
