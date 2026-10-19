import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';
import { stateRoot } from '../../scripts/lib/state.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } }, limits: { maxAttemptsPerTask: 2, maxRuntimeMinutes: 30 } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const no = (r, re) => { assert.notEqual(r.code, 0, r.out); assert.match(r.err, re); };
const RC = 'REPRODUCTION: node --test fails at parse.test.mjs:12\nHYPOTHESIS: comma treated as decimal because ...\nEVIDENCE: logging shows "1.234.50" reaches float()\n';

function running() {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  ok(mis(dir, ['task', 'T1', 'start']));
  return dir;
}
const editState = (dir, fn) => {
  const root = stateRoot(dir);
  const id = readFileSync(join(root, 'current'), 'utf8').trim();
  const f = join(root, 'runs', id, 'state.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  fn(s);
  writeFileSync(f, JSON.stringify(s));
};

test('failed task: start refused, retry needs a root-cause note written after the failure', () => {
  const dir = running();
  ok(mis(dir, ['task', 'T1', 'fail']));
  no(mis(dir, ['task', 'T1', 'start']), /retry/);
  no(mis(dir, ['task', 'T1', 'retry']), /rootcause/);
  no(mis(dir, ['note', 'rootcause', 'T1', '-'], { input: 'I think it is the regex' }), /REPRODUCTION/);
  no(mis(dir, ['note', 'rootcause', 'T9', '-'], { input: RC }), /no task T9/);
  ok(mis(dir, ['note', 'rootcause', 'T1', '-'], { input: RC }));
  const r = ok(mis(dir, ['task', 'T1', 'retry']));
  assert.equal(r.status, 'IN_PROGRESS');
  assert.equal(r.attempts, 2);
  // a second failure needs a new note: the old one predates it
  ok(mis(dir, ['task', 'T1', 'fail']));
  const b = ok(mis(dir, ['task', 'T1', 'retry']));
  assert.equal(b.state, 'BLOCKED', 'limit reached before the rootcause check matters');
});

test('retry limit: exceeding maxAttemptsPerTask blocks the run; approve continue grants one more attempt', () => {
  const dir = running();
  ok(mis(dir, ['task', 'T1', 'fail']));
  ok(mis(dir, ['note', 'rootcause', 'T1', '-'], { input: RC }));
  ok(mis(dir, ['task', 'T1', 'retry']));
  ok(mis(dir, ['task', 'T1', 'fail']));
  ok(mis(dir, ['note', 'rootcause', 'T1', '-'], { input: RC }));
  const r = ok(mis(dir, ['task', 'T1', 'retry']));
  assert.equal(r.state, 'BLOCKED');
  assert.match(r.reason, /retry limit/);
  assert.equal(ok(mis(dir, ['verdict'])).verdict, 'BLOCKED');
  const c = ok(mis(dir, ['approve', 'continue']));
  assert.equal(c.state, 'EXECUTING');
  assert.equal(ok(mis(dir, ['task', 'T1', 'retry'])).attempts, 3);
});

test('runtime limit: after the deadline, work commands block the run instead of running', () => {
  const dir = running();
  editState(dir, (s) => { s.deadlineAt = new Date(Date.now() - 1000).toISOString(); });
  const r = ok(mis(dir, ['check', 'unit']));
  assert.equal(r.state, 'BLOCKED');
  assert.match(r.reason, /runtime limit/);
  const s = ok(mis(dir, ['status', '--json'])).state;
  assert.equal(s.evidence.length, 0, 'check did not run');
  no(mis(dir, ['task', 'T1', 'done']), /BLOCKED/);
  const c = ok(mis(dir, ['approve', 'continue']));
  assert.equal(c.state, 'EXECUTING');
  assert.ok(new Date(ok(mis(dir, ['status', '--json'])).state.deadlineAt) > new Date(), 'deadline extended');
  assert.equal(ok(mis(dir, ['check', 'unit'])).status, 'PASS');
});

test('approve continue only lifts limit blocks', () => {
  const dir = running();
  ok(mis(dir, ['block', 'needs', 'a', 'device']));
  no(mis(dir, ['approve', 'continue']), /limit/);
});
