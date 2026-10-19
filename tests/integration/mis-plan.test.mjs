import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', 'process.exit(0)'] } } };
const PLAN = {
  goal: 'Add a greet() function', constraints: ['no new deps'],
  tasks: [{ id: 'T1', title: 'greet', acceptance: ['greet("a") returns "hi a"'] }],
};
const CRITIC_OK = 'VERDICT: ACCEPT\nBLOCKING: 0\nMAJOR: 0\n\nLooks fine.\n';
const CRITIC_BAD = 'VERDICT: REVISE\nBLOCKING: 1\nMAJOR: 0\n\nMissing tests.\n';

function setup(plan = PLAN) {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'req.md': '# Requirements\nAdd greet\n' });
  write(dir, { 'plan.json': plan, 'critic-ok.md': CRITIC_OK, 'critic-bad.md': CRITIC_BAD });
  return dir;
}
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const no = (r, re) => { assert.notEqual(r.code, 0, `expected failure, got: ${r.out}`); assert.match(r.err, re); };
const state = (dir) => ok(mis(dir, ['status', '--json'])).state;

test('start: text and file inputs', () => {
  const dir = setup();
  const a = ok(mis(dir, ['start', '--input', 'add a greet function']));
  assert.match(a.runId, /^\d{8}-\d{4}-[0-9a-f]{4}$/);
  assert.equal(state(dir).input.kind, 'text');
  no(mis(dir, ['start', '--input', 'again']), /active run/);
  ok(mis(dir, ['cancel']));
  ok(mis(dir, ['start', '--input', 'req.md']));
  const s = state(dir);
  assert.equal(s.input.kind, 'file');
  assert.equal(s.input.ref, 'req.md');
  assert.match(s.input.sha256, /^[0-9a-f]{64}$/);
  assert.match(s.baseCommit, /^[0-9a-f]{40}$/);
  assert.equal(s.state, 'PLANNING');
});

test('commands without a run fail clearly', () => {
  no(mis(setup(), ['plan', 'set', 'plan.json']), /no active run/);
});

test('plan set: schema errors are reported, valid plan stored', () => {
  const dir = setup();
  ok(mis(dir, ['start', '--input', 'x']));
  const bad = [
    [{ ...PLAN, goal: '' }, /goal/],
    [{ ...PLAN, extra: 1 }, /unknown key: extra/],
    [{ ...PLAN, tasks: [{ id: 'T1', title: 't', acceptance: [] }] }, /acceptance/],
    [{ ...PLAN, tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }, { id: 'T1', title: 'u', acceptance: ['b'] }] }, /duplicate task id T1/],
    [{ ...PLAN, riskFlags: ['weather'] }, /riskFlags/],
  ];
  for (const [p, re] of bad) {
    write(dir, { 'p.json': p });
    no(mis(dir, ['plan', 'set', 'p.json']), re);
  }
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  const s = state(dir);
  assert.equal(s.plan.tasks[0].status, 'TODO');
  assert.match(s.planHash, /^[0-9a-f]{64}$/);
});

test('mode set: reason required, risk flags forbid quick and auto-raise', () => {
  const dir = setup();
  ok(mis(dir, ['start', '--input', 'x']));
  no(mis(dir, ['mode', 'set', 'quick']), /--reason/);
  no(mis(dir, ['mode', 'set', 'turbo', '--reason', 'r']), /quick\|standard\|full/);
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'one-line change']));
  write(dir, { 'risky.json': { ...PLAN, riskFlags: ['auth'] } });
  ok(mis(dir, ['plan', 'set', 'risky.json']));
  let s = state(dir);
  assert.equal(s.mode, 'standard', 'risk raises quick to standard');
  assert.ok(s.modeReasons.some((r) => /auth/.test(r)));
  no(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']), /risk flags/);
  ok(mis(dir, ['mode', 'set', 'full', '--reason', 'bigger']));
  s = state(dir);
  assert.equal(s.mode, 'full');
  assert.equal(s.state, 'AWAITING_APPROVAL');
});

test('approve plan: gated by HIGH ambiguity and plan critic bound to current plan', () => {
  const dir = setup();
  ok(mis(dir, ['start', '--input', 'x']));
  no(mis(dir, ['approve', 'plan']), /no plan/);
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  no(mis(dir, ['approve', 'plan']), /mode/);
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'feature']));
  ok(mis(dir, ['interview', 'add', JSON.stringify({ question: 'Which locale?', impact: 'HIGH' })]));
  ok(mis(dir, ['interview', 'add', JSON.stringify({ question: 'Color?', impact: 'LOW' })]));
  no(mis(dir, ['approve', 'plan']), /plan-critic/);
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-bad.md']));
  no(mis(dir, ['approve', 'plan']), /blocking/);
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  no(mis(dir, ['approve', 'plan']), /Q1/);
  no(mis(dir, ['interview', 'resolve', 'Q9', 'x']), /Q9/);
  ok(mis(dir, ['interview', 'resolve', 'Q1', 'en-US only']));
  // plan changes after critique → critique is stale
  write(dir, { 'plan2.json': { ...PLAN, goal: 'Add greet and wave' } });
  ok(mis(dir, ['plan', 'set', 'plan2.json']));
  no(mis(dir, ['approve', 'plan']), /plan-critic/);
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  const a = ok(mis(dir, ['approve', 'plan']));
  assert.equal(a.state, 'EXECUTING');
  const s = state(dir);
  assert.equal(s.approvals[0].action, 'plan');
  assert.match(s.approvals[0].treeHash, /^[0-9a-f]{40}$/);
  assert.equal(s.approvals[0].planHash, s.planHash);
  no(mis(dir, ['plan', 'set', 'plan.json']), /EXECUTING/);
});

test('unapproved execution is refused; quick low-risk skips approval', () => {
  const dir = setup();
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'feature']));
  no(mis(dir, ['task', 'T1', 'start']), /approv/);
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'tiny']));
  assert.equal(state(dir).state, 'PLANNING');
  ok(mis(dir, ['interview', 'add', JSON.stringify({ question: 'Q?', impact: 'HIGH' })]));
  no(mis(dir, ['task', 'T1', 'start']), /Q1/);
  ok(mis(dir, ['interview', 'resolve', 'Q1', 'a']));
  ok(mis(dir, ['task', 'T1', 'start']));
  assert.equal(state(dir).state, 'EXECUTING');
});

test('full mode: approval needs a product review of the current plan; UI plans also need a recorded design choice', () => {
  const dir = setup({ ...PLAN, ui: true });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  ok(mis(dir, ['mode', 'set', 'full', '--reason', 'new app']));
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  no(mis(dir, ['approve', 'plan']), /product review/);
  ok(mis(dir, ['review', 'add', 'product', 'critic-bad.md']));
  no(mis(dir, ['approve', 'plan']), /product review has 1 blocking/);
  ok(mis(dir, ['review', 'add', 'product', 'critic-ok.md']));
  no(mis(dir, ['approve', 'plan']), /design/);
  no(mis(dir, ['note', 'design', '-'], { input: '' }), /design note/);
  ok(mis(dir, ['note', 'design', '-'], { input: '# Chosen: variant B\nDESIGN.md tokens: ...\n' }));
  assert.equal(ok(mis(dir, ['approve', 'plan'])).state, 'EXECUTING');
});

test('standard mode does not require product review or design choice', () => {
  const dir = setup({ ...PLAN, ui: true });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'feature']));
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  assert.equal(ok(mis(dir, ['approve', 'plan'])).state, 'EXECUTING');
});

test('full mode: product review and design choice are bound to the current plan (a plan change needs both again)', () => {
  const dir = setup({ ...PLAN, ui: true });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', 'plan.json']));
  ok(mis(dir, ['mode', 'set', 'full', '--reason', 'new app']));
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  ok(mis(dir, ['review', 'add', 'product', 'critic-ok.md']));
  ok(mis(dir, ['note', 'design', '-'], { input: 'variant B' }));
  write(dir, { 'plan3.json': { ...PLAN, ui: true, goal: 'Add greet with a settings screen' } });
  ok(mis(dir, ['plan', 'set', 'plan3.json']));
  ok(mis(dir, ['review', 'add', 'plan-critic', 'critic-ok.md']));
  no(mis(dir, ['approve', 'plan']), /product review/);
  ok(mis(dir, ['review', 'add', 'product', 'critic-ok.md']));
  no(mis(dir, ['approve', 'plan']), /design/);
  ok(mis(dir, ['note', 'design', '-'], { input: 'variant B, adjusted for settings' }));
  assert.equal(ok(mis(dir, ['approve', 'plan'])).state, 'EXECUTING');
});
