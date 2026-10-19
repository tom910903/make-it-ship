import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';
import { stateRoot } from '../../scripts/lib/state.mjs';

const node = (code) => ['node', '-e', code];
const CFG = {
  version: 1,
  checks: {
    pass: { argv: node('console.log("all good")') },
    fail: { argv: node('console.error("boom"); process.exit(3)') },
    leak: { argv: node('console.log("key=" + process.env.MY_SECRET_TOKEN)') },
    slow: { argv: node('setTimeout(()=>{}, 10000)'), timeoutSec: 1 },
    missingbin: { argv: ['definitely-not-a-real-binary-xyz'] },
    readfile: { argv: node('process.exit(require("fs").readFileSync("flag.txt","utf8").trim()==="ok"?0:1)') },
  },
};
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const state = (dir) => ok(mis(dir, ['status', '--json'])).state;

function setup() {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'flag.txt': 'ok\n' });
  ok(mis(dir, ['start', '--input', 'x']));
  return dir;
}

test('check PASS / FAIL record exit code, argv, hashes, log', () => {
  const dir = setup();
  const p = ok(mis(dir, ['check', 'pass']));
  assert.equal(p.status, 'PASS');
  assert.equal(p.exitCode, 0);
  const f = ok(mis(dir, ['check', 'fail']));
  assert.equal(f.status, 'FAIL');
  assert.equal(f.exitCode, 3);
  assert.match(f.tail, /boom/);
  const ev = state(dir).evidence;
  assert.deepEqual(ev.map((e) => e.id), ['E1', 'E2']);
  assert.deepEqual(ev[1].argv, CFG.checks.fail.argv);
  assert.match(ev[0].treeHash, /^[0-9a-f]{40}$/);
  assert.match(ev[0].configHash, /^[0-9a-f]{64}$/);
  const runDir = join(stateRoot(dir), 'runs', state(dir).runId);
  assert.match(readFileSync(join(runDir, ev[0].log), 'utf8'), /all good/);
});

test('cannot run: undefined check, missing binary, timeout → BLOCKED evidence', () => {
  const dir = setup();
  for (const [name, re] of [['nope', /not defined/], ['missingbin', /not found/], ['slow', /timed out/]]) {
    const r = ok(mis(dir, ['check', name]));
    assert.equal(r.status, 'BLOCKED', name);
    assert.match(r.reason, re);
  }
});

test('secrets are masked in stored logs', () => {
  const dir = setup();
  const r = mis(dir, ['check', 'leak'], { env: { MY_SECRET_TOKEN: 'sekrit-value-12345' } });
  ok(r);
  assert.ok(!r.out.includes('sekrit-value-12345'));
  const s = state(dir);
  const log = readFileSync(join(stateRoot(dir), 'runs', s.runId, s.evidence[0].log), 'utf8');
  assert.ok(!log.includes('sekrit-value-12345'));
  assert.match(log, /\*\*\*/);
});

test('STALE: file edit, new file, and config change invalidate evidence', () => {
  const dir = setup();
  ok(mis(dir, ['check', 'readfile']));
  const st = () => ok(mis(dir, ['verdict'])).checks;
  // verdict uses required = all checks by default; look only at readfile
  assert.equal(st().readfile, 'PASS');
  write(dir, { 'flag.txt': 'ok\n\n' });
  assert.equal(st().readfile, 'STALE', 'tracked edit');
  ok(mis(dir, ['check', 'readfile']));
  assert.equal(st().readfile, 'PASS');
  write(dir, { 'new.txt': 'x' });
  assert.equal(st().readfile, 'STALE', 'new untracked file');
  ok(mis(dir, ['check', 'readfile']));
  write(dir, { '.make-it-ship.json': { ...CFG, limits: { maxAttemptsPerTask: 3 } } });
  assert.equal(st().readfile, 'STALE', 'config change');
});

test('task lifecycle: start → done / fail', () => {
  const dir = setup();
  write(dir, { 'p.json': { goal: 'g', tasks: [{ id: 'T1', title: 'a', acceptance: ['x'] }, { id: 'T2', title: 'b', acceptance: ['y'] }] } });
  ok(mis(dir, ['plan', 'set', 'p.json']));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  ok(mis(dir, ['task', 'T1', 'start']));
  assert.equal(ok(mis(dir, ['task', 'T1', 'done'])).status, 'DONE');
  assert.notEqual(mis(dir, ['task', 'T1', 'done']).code, 0, 'DONE task cannot be done again');
  ok(mis(dir, ['task', 'T2', 'start']));
  assert.equal(ok(mis(dir, ['task', 'T2', 'fail'])).status, 'FAILED');
  assert.equal(state(dir).plan.tasks[0].attempts, 1);
});

test('verdict: dependency manifest change needs a reason; missing config is never VERIFIED', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { pass: { argv: node('0') } } }, 'package.json': '{"name":"a"}' });
  ok(mis(dir, ['start', '--input', 'x']));
  write(dir, { 'package.json': '{"name":"a","dependencies":{"left-pad":"1"}}' });
  const v = ok(mis(dir, ['verdict']));
  assert.deepEqual(v.changedManifests, ['package.json']);
  assert.ok(v.reasons.some((r) => /dependency/.test(r)));

  const bare = makeRepo();
  ok(mis(bare, ['start', '--input', 'x']));
  const b = ok(mis(bare, ['verdict']));
  assert.notEqual(b.verdict, 'VERIFIED');
  assert.ok(b.reasons.some((r) => /no \.make-it-ship\.json/.test(r)));
});

test('mis note dep records a reason that satisfies the dependency rule (M-4)', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { pass: { argv: node('0') } } }, 'package.json': '{"name":"a"}' });
  ok(mis(dir, ['start', '--input', 'x']));
  write(dir, { 'package.json': '{"name":"a","dependencies":{"zod":"3"}}' });
  assert.notEqual(mis(dir, ['note', 'dep']).code, 0, 'text required');
  const n = ok(mis(dir, ['note', 'dep', 'zod', 'validates', 'the', 'config', 'schema']));
  assert.equal(n.kind, 'dep');
  assert.equal(n.text, 'zod validates the config schema');
  const v = ok(mis(dir, ['verdict']));
  assert.ok(!v.reasons.some((r) => /dependency/.test(r)), v.reasons.join());
});

test('config changed during the run (by any tool) keeps the verdict PARTIAL until the user approves it (pilot 4 finding)', () => {
  const C1 = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } };
  const dir = makeRepo({ '.make-it-ship.json': C1 });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  write(dir, { '.make-it-ship.json': { ...C1, checks: { ...C1.checks, 'qa-x': { argv: ['node', '-e', '0'] } } } });
  ok(mis(dir, ['check', 'unit'])); ok(mis(dir, ['check', 'qa-x']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  let v = ok(mis(dir, ['verdict']));
  assert.equal(v.verdict, 'PARTIAL');
  assert.ok(v.reasons.some((r) => /changed during the run.*mis approve config/.test(r)), v.reasons.join());
  ok(mis(dir, ['approve', 'config']));
  v = ok(mis(dir, ['verdict']));
  assert.equal(v.verdict, 'VERIFIED', v.reasons.join());
});
