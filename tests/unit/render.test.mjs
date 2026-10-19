import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatus } from '../../scripts/lib/render.mjs';
import { parseReview } from '../../scripts/lib/commands.mjs';

const T = 't1', C = 'c1';
const state = {
  runId: '20261019-0953-ab12', state: 'AWAITING_APPROVAL', mode: 'standard', modeReasons: ['new feature'], riskFlags: ['auth'],
  plan: { goal: 'Add login', tasks: [{ id: 'T1', title: 'form', status: 'DONE', attempts: 1 }, { id: 'T2', title: 'session', status: 'IN_PROGRESS', attempts: 2 }] },
  evidence: [{ id: 'E1', check: 'unit', status: 'PASS', treeHash: 'old', configHash: C }, { id: 'E2', check: 'lint', status: 'PASS', treeHash: T, configHash: C }],
  reviews: [{ kind: 'spec', treeHash: T, blocking: 0, major: 1 }, { kind: 'quality', treeHash: 'old', blocking: 0, major: 0 }],
  interview: [{ id: 'Q1', impact: 'HIGH', question: 'Which IdP?', answer: null }, { id: 'Q2', impact: 'LOW', question: 'Color?', answer: 'blue' }],
  blockedReason: null,
};
const ctx = { treeHash: T, configHash: C, required: ['unit', 'lint', 'e2e'], dependencyChanged: false };

test('status snapshot', () => {
  const expected = `MIS run 20261019-0953-ab12 · AWAITING_APPROVAL · mode standard (new feature)
Goal: Add login
Risk flags: auth
Tasks (1/2 done):
  [DONE] T1 form
  [IN_PROGRESS] T2 session (attempt 2)
Required checks:
  unit  STALE  E1
  lint  PASS  E2
  e2e  MISSING
Reviews on current code:
  spec  0 blocking / 1 major
  quality  missing
  security  missing
Open questions:
  Q1 (HIGH) Which IdP?
Needs your decision:
  - approve the plan (mis approve plan)
  - answer Q1: Which IdP?
Verdict now: PARTIAL
  - task T2 is IN_PROGRESS
  - required check unit is stale (code or config changed)
  - required check e2e is not run
  - quality review missing for current code
  - security review missing for current code
  - HIGH ambiguity Q1 unresolved
`;
  assert.equal(renderStatus(state, ctx), expected);
});

test('review parser is strict', () => {
  assert.deepEqual(parseReview('VERDICT: ACCEPT\nBLOCKING: 0\nMAJOR: 2\n'), { blocking: 0, major: 2 });
  assert.throws(() => parseReview('All good, no issues.'), /BLOCKING/);
  assert.throws(() => parseReview('BLOCKING: 0\n'), /MAJOR/);
  assert.throws(() => parseReview('BLOCKING: 0\nMAJOR: 0\nBLOCKING: 1\n'), /exactly one "BLOCKING/);
  assert.throws(() => parseReview('BLOCKING: none\nMAJOR: 0\n'), /BLOCKING/);
  assert.throws(() => parseReview('**BLOCKING: 0**\nMAJOR: 0\n'), /BLOCKING/);
});
