import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', 'process.exit(require("fs").existsSync("bad") ? 1 : 0)'] } } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const RC = 'REPRODUCTION: x\nHYPOTHESIS: y\nEVIDENCE: z\n';

test('retro aggregates runs from events: verdicts, fail→pass cycles, retries, blocks, reviews', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  // run 1: fail → rootcause → retry → pass → verified report
  ok(mis(dir, ['start', '--input', 'one']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g1', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  ok(mis(dir, ['task', 'T1', 'start']));
  write(dir, { bad: '1' });
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['task', 'T1', 'fail']));
  ok(mis(dir, ['note', 'rootcause', 'T1', '-'], { input: RC }));
  ok(mis(dir, ['task', 'T1', 'retry']));
  rmSync(join(dir, 'bad'));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 1\nMAJOR: 2\n' }));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  ok(mis(dir, ['report']));
  // run 2: blocked
  ok(mis(dir, ['start', '--input', 'two']));
  ok(mis(dir, ['block', 'needs', 'a', 'device']));

  const r = ok(mis(dir, ['retro']));
  assert.equal(r.metrics.runs, 2);
  assert.deepEqual(r.metrics.finalVerdicts, { VERIFIED: 1, none: 1 });
  assert.deepEqual(r.metrics.finalStates, { REPORTED: 1, BLOCKED: 1 });
  assert.equal(r.metrics.checks.total, 2);
  assert.equal(r.metrics.checks.failed, 1);
  assert.equal(r.metrics.checks.failToPass, 1);
  assert.equal(r.metrics.retries, 1);
  assert.equal(r.metrics.rootCauses, 1);
  assert.deepEqual(r.metrics.blockedReasons, ['needs a device']);
  assert.deepEqual(r.metrics.reviewBlocking, { quality: 1 });
  const md = readFileSync(join(dir, r.path), 'utf8');
  assert.match(md, /# Make It Ship 회고/);
  assert.match(md, /\| 실행 수 \| 2 \|/);
  assert.match(md, /## 잘한 점/);
});

test('retro works with no runs', () => {
  const r = ok(mis(makeRepo(), ['retro']));
  assert.equal(r.metrics.runs, 0);
});

test('retro median uses the mean of the two middle runs for an even count (M5 L-5b)', async () => {
  const { retroMetrics } = await import('../../scripts/lib/retro.mjs');
  const run = (min) => ({ state: { state: 'REPORTED', startedAt: '2026-10-19T00:00:00Z' }, events: [{ type: 'start', at: '2026-10-19T00:00:00Z' }, { type: 'report', at: new Date(Date.parse('2026-10-19T00:00:00Z') + min * 60000).toISOString(), verdict: 'VERIFIED' }] });
  assert.equal(retroMetrics([run(2), run(10)]).medianMinutes, 6);
  assert.equal(retroMetrics([run(2), run(10), run(4)]).medianMinutes, 4);
});
