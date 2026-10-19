import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, evidenceStatus } from '../../scripts/lib/verdict.mjs';

const T = 'tree1', C = 'cfg1';
const ctx = { treeHash: T, configHash: C, required: ['unit', 'lint'], dependencyChanged: false };
const ev = (check, status, over = {}) => ({ check, status, exitCode: status === 'PASS' ? 0 : 1, treeHash: T, configHash: C, ...over });
const rev = (kind, blocking = 0, over = {}) => ({ kind, blocking, major: 0, treeHash: T, ...over });

// A fully verified standard run; each case mutates one thing.
const base = () => ({
  state: 'VERIFYING', mode: 'standard', riskFlags: [], interview: [], notes: [],
  plan: { tasks: [{ id: 'T1', status: 'DONE' }] },
  evidence: [ev('unit', 'PASS'), ev('lint', 'PASS')],
  reviews: [rev('spec'), rev('quality')],
});

const cases = [
  ['all good → VERIFIED', (s) => s, 'VERIFIED'],
  ['run BLOCKED wins over everything', (s) => { s.state = 'BLOCKED'; s.evidence[0] = ev('unit', 'FAIL'); }, 'BLOCKED'],
  ['required BLOCKED, no FAIL → BLOCKED', (s) => { s.evidence[0] = ev('unit', 'BLOCKED'); }, 'BLOCKED'],
  ['required BLOCKED + FAIL → FAILED', (s) => { s.evidence = [ev('unit', 'BLOCKED'), ev('lint', 'FAIL')]; }, 'FAILED'],
  ['required FAIL → FAILED', (s) => { s.evidence[1] = ev('lint', 'FAIL'); }, 'FAILED'],
  ['blocking review issue → FAILED', (s) => { s.reviews[1] = rev('quality', 2); }, 'FAILED'],
  ['blocking issue on stale review ignored, but review missing → PARTIAL', (s) => { s.reviews[1] = rev('quality', 2, { treeHash: 'old' }); }, 'PARTIAL'],
  ['FAIL beats PARTIAL conditions', (s) => { s.evidence[1] = ev('lint', 'FAIL'); s.plan.tasks[0].status = 'IN_PROGRESS'; }, 'FAILED'],
  ['stale FAIL is STALE not FAIL → PARTIAL', (s) => { s.evidence[1] = ev('lint', 'FAIL', { treeHash: 'old' }); }, 'PARTIAL'],
  ['unfinished task → PARTIAL', (s) => { s.plan.tasks.push({ id: 'T2', status: 'TODO' }); }, 'PARTIAL'],
  ['no plan → PARTIAL', (s) => { s.plan = null; }, 'PARTIAL'],
  ['required check never run → PARTIAL', (s) => { s.evidence.pop(); }, 'PARTIAL'],
  ['tree changed since check → PARTIAL', (s) => { s.evidence[0] = ev('unit', 'PASS', { treeHash: 'old' }); }, 'PARTIAL'],
  ['config changed since check → PARTIAL', (s) => { s.evidence[0] = ev('unit', 'PASS', { configHash: 'old' }); }, 'PARTIAL'],
  ['latest evidence wins (FAIL then PASS)', (s) => { s.evidence.unshift(ev('unit', 'FAIL')); }, 'VERIFIED'],
  ['latest evidence wins (PASS then FAIL)', (s) => { s.evidence.push(ev('unit', 'FAIL')); }, 'FAILED'],
  ['standard without spec review → PARTIAL', (s) => { s.reviews = [rev('quality')]; }, 'PARTIAL'],
  ['review on old tree → PARTIAL', (s) => { s.reviews[0] = rev('spec', 0, { treeHash: 'old' }); }, 'PARTIAL'],
  ['quick needs quality only', (s) => { s.mode = 'quick'; s.reviews = [rev('quality')]; }, 'VERIFIED'],
  ['quick without quality → PARTIAL', (s) => { s.mode = 'quick'; s.reviews = [rev('spec')]; }, 'PARTIAL'],
  ['risk flag without security review → PARTIAL', (s) => { s.riskFlags = ['auth']; }, 'PARTIAL'],
  ['risk flag with security review → VERIFIED', (s) => { s.riskFlags = ['auth']; s.reviews.push(rev('security')); }, 'VERIFIED'],
  ['unresolved HIGH ambiguity → PARTIAL', (s) => { s.interview = [{ id: 'Q1', impact: 'HIGH', answer: null }]; }, 'PARTIAL'],
  ['resolved HIGH / open LOW ok', (s) => { s.interview = [{ id: 'Q1', impact: 'HIGH', answer: 'yes' }, { id: 'Q2', impact: 'LOW', answer: null }]; }, 'VERIFIED'],
  ['dependency change without reason → PARTIAL', (s, c) => { c.dependencyChanged = true; }, 'PARTIAL'],
  ['dependency change with reason → VERIFIED', (s, c) => { c.dependencyChanged = true; s.notes = [{ kind: 'dep', text: 'need x' }]; }, 'VERIFIED'],
  ['no required checks at all → PARTIAL', (s, c) => { c.required = []; }, 'PARTIAL'],
  ['mode not set → PARTIAL', (s) => { s.mode = null; }, 'PARTIAL'],
  ['non-required failing check does not matter', (s) => { s.evidence.push(ev('e2e', 'FAIL')); }, 'VERIFIED'],
];

for (const [name, mutate, expected] of cases) {
  test(`verdict: ${name}`, () => {
    const s = base(); const c = { ...ctx };
    mutate(s, c);
    const r = verdict(s, c);
    assert.equal(r.verdict, expected, JSON.stringify(r.reasons));
    if (expected !== 'VERIFIED') assert.ok(r.reasons.length > 0, 'non-VERIFIED explains why');
  });
}

test('evidence status', () => {
  assert.equal(evidenceStatus(ev('u', 'PASS'), ctx), 'PASS');
  assert.equal(evidenceStatus(ev('u', 'FAIL', { configHash: 'x' }), ctx), 'STALE');
  assert.equal(evidenceStatus(ev('u', 'BLOCKED', { treeHash: 'x' }), ctx), 'BLOCKED');
});

test('verdict reports per-check status incl. MISSING', () => {
  const s = base(); s.evidence.pop();
  assert.deepEqual(verdict(s, ctx).checks, { unit: 'PASS', lint: 'MISSING' });
});

test('plan-level reviews (plan-critic, product) never count toward the code verdict', () => {
  const s = base();
  s.reviews.push({ kind: 'product', blocking: 1, major: 0, treeHash: T, planHash: 'old-plan' });
  s.reviews.push({ kind: 'plan-critic', blocking: 2, major: 0, treeHash: T });
  assert.equal(verdict(s, ctx).verdict, 'VERIFIED');
});
