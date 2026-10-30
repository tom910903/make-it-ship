import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '--test', 'test.mjs'] } } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const REVIEW = 'VERDICT: ACCEPT\nBLOCKING: 0\nMAJOR: 0\n';

function quickRun() {
  const dir = makeRepo({
    '.make-it-ship.json': CFG,
    'lib.mjs': 'export const add = (a, b) => a + b;\n',
    'test.mjs': "import {test} from 'node:test'; import assert from 'node:assert'; import {add} from './lib.mjs'; test('add', () => assert.equal(add(1,2),3));\n",
  });
  write(dir, { '../plan-q.json': { goal: 'Add mul()', tasks: [{ id: 'T1', title: 'mul', acceptance: ['mul(2,3)===6'] }], howToRun: ['node --test test.mjs'] } });
  ok(mis(dir, ['start', '--input', 'add mul']));
  ok(mis(dir, ['plan', 'set', '../plan-q.json']));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'one function']));
  ok(mis(dir, ['task', 'T1', 'start']));
  write(dir, { 'lib.mjs': 'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n' });
  return dir;
}

test('quick run end-to-end: no review → PARTIAL; with review → VERIFIED; report has the 8 sections', () => {
  const dir = quickRun();
  ok(mis(dir, ['interview', 'add', JSON.stringify({ question: 'Overflow behavior?', impact: 'MED' })]));
  ok(mis(dir, ['interview', 'resolve', 'Q1', 'use JS number semantics']));
  ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  let v = ok(mis(dir, ['verdict']));
  assert.equal(v.verdict, 'PARTIAL');
  assert.ok(v.reasons.includes('quality review missing for current code'));
  write(dir, { '../rev.md': REVIEW });
  ok(mis(dir, ['review', 'add', 'quality', '../rev.md']));
  v = ok(mis(dir, ['verdict']));
  assert.equal(v.verdict, 'VERIFIED', v.reasons.join());
  const r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'VERIFIED');
  assert.equal(r.state, 'REPORTED');
  const md = readFileSync(join(dir, r.path), 'utf8');
  for (const h of ['## 1. 목표와 달성 여부', '## 2. 작업 상태', '## 3. 변경한 기능과 주요 파일', '## 4. 수행한 검증과 실제 결과',
    '## 6. 검증하지 못한 영역과 이유', '## 7. 코드 변경 이후 무효가 된 검증', '## 8. 사용자 결정·배포 전 주의사항', '## 9. 실행·확인 방법', '## 정직성 표기']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.match(md, /lib\.mjs/);
  assert.match(md, /node --test test\.mjs/);
  assert.match(md, /VERIFIED/);
  assert.match(md, /토큰 예산/);
  assert.match(md, /가정: Q1 \(MED\) Overflow behavior\? → use JS number semantics/, 'resolved assumptions are listed for the user');
  // report path is excluded from the tree hash, so reporting does not make evidence stale
  assert.equal(ok(mis(dir, ['verdict'])).verdict, 'VERIFIED');
});

test('non-VERIFIED report never claims ready to ship; failing check → FAILED', () => {
  const dir = quickRun();
  write(dir, { 'test.mjs': "import {test} from 'node:test'; import assert from 'node:assert'; test('x', () => assert.equal(1,2));\n" });
  ok(mis(dir, ['check', 'unit']));
  const r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'FAILED');
  const md = readFileSync(join(dir, r.path), 'utf8');
  assert.match(md, /배포 준비 완료 아님/);
  assert.doesNotMatch(md.replace(/배포 준비 완료 아님/g, ''), /배포 준비 완료/);
});

test('human status, block and cancel', () => {
  const dir = quickRun();
  const out = ok(mis(dir, ['status']));
  assert.match(out, /EXECUTING · mode quick/);
  assert.match(out, /\[IN_PROGRESS\] T1 mul/);
  const b = ok(mis(dir, ['block', 'needs', 'hardware']));
  assert.equal(b.state, 'BLOCKED');
  assert.equal(ok(mis(dir, ['verdict'])).verdict, 'BLOCKED');
  assert.notEqual(mis(dir, ['cancel']).code, 0, 'terminal BLOCKED cannot transition');
  const r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'BLOCKED');
  assert.ok(existsSync(join(dir, r.path)));
  assert.match(readFileSync(join(dir, r.path), 'utf8'), /needs hardware/);
});

test('plan and review can be piped on stdin (no temp files in the repo)', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  const r = ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 1\nMAJOR: 2\n' }));
  assert.equal(r.blocking, 1);
  assert.equal(r.major, 2);
  assert.notEqual(mis(dir, ['review', 'add', 'quality', '-'], { input: 'looks good' }).code, 0);
});

test('report labels plan reviews by plan, not by code (M3 R2-3)', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['review', 'add', 'product', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g2', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['review', 'add', 'plan-critic', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  const md = readFileSync(join(dir, ok(mis(dir, ['report'])).path), 'utf8');
  assert.match(md, /product: blocking 0, major 0 — 이전 계획 기준\(무효\)/);
  assert.match(md, /plan-critic: blocking 0, major 0 — 현재 계획 기준/);
});

test('report section 6 keeps non-check-specific reasons such as "no required checks defined" (M4 D2)', () => {
  const dir = makeRepo();
  ok(mis(dir, ['start', '--input', 'x']));
  const md = readFileSync(join(dir, ok(mis(dir, ['report'])).path), 'utf8');
  const s6 = md.split('## 6. ')[1].split('## 7. ')[0];
  assert.match(s6, /no required checks defined/);
});

test('quick mode: a detected user-facing surface without real-use QA is listed as not verified, verdict unchanged (M4 D3)', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'index.html': '<html></html>', 'lib.mjs': 'export const x = 1;\n',
    'test.mjs': "import {test} from 'node:test'; test('x', () => {});\n" });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  const r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'VERIFIED', 'quick does not require qa (Spec §14.1)');
  const s6 = readFileSync(join(dir, r.path), 'utf8').split('## 6. ')[1].split('## 7. ')[0];
  assert.match(s6, /web.*실사용 QA.*qa-web/);
});

test('code review after the report reopens the run to VERIFYING; report again (PROPOSALS b)', () => {
  const dir = quickRun();
  ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  let r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'PARTIAL');
  assert.equal(r.state, 'REPORTED');
  write(dir, { '../rev.md': REVIEW });
  assert.notEqual(mis(dir, ['review', 'add', 'plan-critic', '../rev.md']).code, 0, 'plan reviews never reopen a reported run');
  const rec = ok(mis(dir, ['review', 'add', 'quality', '../rev.md']));
  assert.equal(rec.reopened, 'REPORTED -> VERIFYING');
  assert.match(rec.next, /mis report/);
  assert.equal(ok(mis(dir, ['status', '--json'])).state.state, 'VERIFYING');
  r = ok(mis(dir, ['report']));
  assert.equal(r.verdict, 'VERIFIED', r.reasons.join());
  assert.equal(r.state, 'REPORTED');
  const events = readFileSync(join(dir, '.git/make-it-ship/runs', r.path.split('/')[2], 'events.jsonl'), 'utf8');
  assert.match(events, /"type":"review","kind":"quality".*"reopened":"REPORTED -> VERIFYING"/);
});

test('BLOCKED and CANCELLED runs are not reopened by a review', () => {
  const dir = quickRun();
  ok(mis(dir, ['block', 'needs', 'a', 'decision']));
  write(dir, { '../rev.md': REVIEW });
  const res = mis(dir, ['review', 'add', 'quality', '../rev.md']);
  assert.notEqual(res.code, 0);
  assert.match(res.err, /run is BLOCKED/);
});
