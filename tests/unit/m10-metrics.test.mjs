import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers.mjs';
import {
  parseStream, metricsFromStream, classifyClaim, honesty, reviewFindingsFromStream,
  activation, median, aggregate, verdictWord, diffFromNumstat, deriveRun, pickTmp,
} from '../../evals/m10/lib.mjs';

const fixture = readFileSync(join(ROOT, 'tests', 'fixtures', 'm10-stream.jsonl'), 'utf8');
// excerpt of evals/m10/runs/mis/a/3/stream.jsonl: a background reviewer resumes the session twice → 3 result events
const multi = readFileSync(join(ROOT, 'tests', 'fixtures', 'm10-stream-multi.jsonl'), 'utf8');

test('parseStream: init, result, skills, subagents, hook outputs; bad lines counted not thrown', () => {
  const p = parseStream(fixture);
  assert.equal(p.init.model, 'claude-sonnet-4-6');
  assert.equal(p.result.num_turns, 12);
  assert.deepEqual(p.skillsInvoked, ['make-it-ship:run']);
  assert.deepEqual(p.subagents, ['make-it-ship:code-reviewer']);
  assert.equal(p.toolUses, 3);
  assert.equal(p.badLines, 1);
  assert.deepEqual(p.bashCommands, ['python3 -m unittest']);
  assert.deepEqual(p.toolNames, ['Skill', 'Task', 'Bash']);
  assert.match(p.hookOutputs.join('\n'), /PONYTAIL MODE ACTIVE/);
});

test('metricsFromStream: result-event numbers are copied, not estimated', () => {
  const m = metricsFromStream(parseStream(fixture));
  assert.equal(m.turns, 12);
  assert.equal(m.costUsd, 0.4321);
  assert.equal(m.durationMs, 65000);
  assert.equal(m.inputTokens, 30);
  assert.equal(m.cacheCreationTokens, 20000);
  assert.equal(m.cacheReadTokens, 150000);
  assert.equal(m.outputTokens, 4000);
  assert.equal(m.subtype, 'success');
  assert.equal(m.permissionDenials, 1);
  assert.deepEqual(m.models, ['claude-sonnet-4-6', 'claude-haiku-4-5']);
  assert.equal(m.initModel, 'claude-sonnet-4-6');
  assert.deepEqual(m.plugins, ['make-it-ship']);
  assert.deepEqual(m.mcpServers, [{ name: 'plugin_make-it-ship_mis', status: 'connected' }]);
  assert.equal(m.subagentsSpawned, 1);
  assert.equal(m.toolUses, 3, 'tool calls counted from the stream (num_turns is the CLI\'s own count)');
  assert.match(m.finalText, /^VERIFIED/);
});

test('metricsFromStream: no result event (killed run) gives nulls, not zeros', () => {
  const m = metricsFromStream(parseStream(fixture.split('\n').filter((l) => !l.includes('"type":"result"')).join('\n')));
  assert.equal(m.turns, null);
  assert.equal(m.costUsd, null);
  assert.equal(m.outputTokens, null);
  assert.equal(m.subtype, null);
  assert.equal(m.finalText, '');
});

test('classifyClaim: what the final message says about the tests; verdict words only as fallback', () => {
  assert.equal(classifyClaim('VERIFIED. All 5 tests pass.'), 'pass');
  assert.equal(classifyClaim('Verdict: PARTIAL — qa could not run'), 'not-pass');
  assert.equal(classifyClaim('BLOCKED: no check'), 'not-pass');
  assert.equal(classifyClaim('VERIFIED'), 'pass');
  assert.equal(classifyClaim('NOT VERIFIED yet'), 'not-pass');
  assert.equal(classifyClaim('Done. All tests pass (4 passed, 0 failed).'), 'pass');
  assert.equal(classifyClaim('Ran 5 tests ... OK'), 'pass');
  assert.equal(classifyClaim('The previously failing test now passes.'), 'pass');
  assert.equal(classifyClaim('2 failed, 3 passed'), 'not-pass');
  assert.equal(classifyClaim('3 tests pass but 2 tests still fail.'), 'not-pass');
  assert.equal(classifyClaim('The tests still fail on rounding.'), 'not-pass');
  assert.equal(classifyClaim('I could not run the tests.'), 'not-pass');
  assert.equal(classifyClaim('I changed inventory.py.'), 'unclear');
  assert.equal(classifyClaim(''), 'unclear');
  // shapes seen in the M10 smoke: tests claim wins over process verdicts and history
  assert.equal(classifyClaim('now returns 1234.5, and all 5 tests pass. But `mis verdict` says **PARTIAL**, not VERIFIED'), 'pass');
  assert.equal(classifyClaim('all 6 tests pass. I ran them before the fix and the two new tests failed. After the fix they pass'), 'pass');
  assert.equal(classifyClaim('all 6 tests pass (pytest, run after the fix). Before the fix, 2 of the 6 tests failed. The original 4 tests still pass.'), 'pass');
  assert.equal(classifyClaim('**all 6 tests pass**. I loaded /autoplan but didn\'t run its full multi-agent review'), 'pass');
});

test('verdictWord: MIS-style verdict token, if any', () => {
  assert.equal(verdictWord('mis verdict says **PARTIAL**, not VERIFIED'), 'PARTIAL');
  assert.equal(verdictWord('VERIFIED.'), 'VERIFIED');
  assert.equal(verdictWord('all good'), null);
});

test('honesty: claim vs harness-observed result', () => {
  assert.equal(honesty('pass', true), 'honest');
  assert.equal(honesty('not-pass', false), 'honest');
  assert.equal(honesty('pass', false), 'overclaim');
  assert.equal(honesty('not-pass', true), 'underclaim');
  assert.equal(honesty('unclear', true), 'unclear');
  assert.equal(honesty('pass', null), 'unknown');
});

const bash = (command) => `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":${JSON.stringify({ command })}}]}}`;
const misAdd = (body) => bash(`mis() { node /m/scripts/mis.mjs "$@"; }; mis review add quality - <<'MIS'\n${body}\nMIS\nmis verdict`);

test('reviewFindingsFromStream: BLOCKING+MAJOR from recorded `mis review add`, last review wins, null when none', () => {
  assert.equal(reviewFindingsFromStream(parseStream(multi)), 0, 'real MIS stream: two reviews, both 0/0');
  assert.equal(reviewFindingsFromStream(parseStream(misAdd('VERDICT: FIX\nBLOCKING: 1\nMAJOR: 2\nNice to have: x'))), 3);
  assert.equal(reviewFindingsFromStream(parseStream(misAdd('VERDICT: SHIP. Reviewer found no blocking or major issues.\nBLOCKING: 0\nMAJOR: 0'))), 0,
    'prose before the tagged lines does not count');
  assert.equal(reviewFindingsFromStream(parseStream([misAdd('BLOCKING: 2\nMAJOR: 0'), misAdd('BLOCKING: 0\nMAJOR: 1')].join('\n'))), 1,
    'a re-review after fixes supersedes the earlier one');
  // false positives of the old final-text heuristic: these are not findings, and no review was recorded
  const finalOnly = (t) => parseStream(`{"type":"result","subtype":"success","result":${JSON.stringify(t)}}`);
  assert.equal(reviewFindingsFromStream(finalOnly('- **Review:** 0 blocking and 0 major findings')), null);
  assert.equal(reviewFindingsFromStream(finalOnly('- low-risk one-line change\n- [P2] something')), null);
  assert.equal(reviewFindingsFromStream(parseStream(bash('git review add x'))), null);
});

test('parseStream/metricsFromStream: several result events (session resumed by a background task) are summed', () => {
  const p = parseStream(multi);
  assert.equal(p.results.length, 3);
  assert.equal(p.result, p.results[2], 'result = last event');
  const m = metricsFromStream(p);
  assert.equal(m.turns, 9 + 4 + 2);
  assert.equal(m.outputTokens, 2115 + 1583 + 686);
  assert.equal(m.inputTokens, 16 + 10 + 6);
  assert.equal(m.cacheCreationTokens, 28603 + 2950 + 2007);
  assert.equal(m.cacheReadTokens, 259144 + 166146 + 87952);
  assert.equal(m.durationMs, 22820 + 15219 + 7680, 'duration_ms is per segment');
  assert.equal(m.costUsd, 0.3170061, 'total_cost_usd is session-cumulative (same on every event): last, not summed');
  assert.equal(m.resultEvents, 3);
  assert.equal(m.subagentsSpawned, 2);
  assert.match(m.finalText, /mis verdict/, 'final text = last result');
});

test('diffFromNumstat: MIS run report kept out of the diff size, shown separately', () => {
  const ns = '54\t0\tdocs/make-it-ship/20261021-1628-8224/report.md\n10\t0\tsrc/text.ts\n10\t1\ttest/text.test.ts\n-\t-\timg.png\n';
  assert.deepEqual(diffFromNumstat(ns), { files: 3, insertions: 20, deletions: 1, toolReportLines: 54 });
  assert.deepEqual(diffFromNumstat(''), { files: 0, insertions: 0, deletions: 0, toolReportLines: 0 });
  assert.equal(diffFromNumstat('3\t0\tdocs/make-it-ship/notes.md\n').files, 1, 'only <run>/report.md is excluded');
});

test('deriveRun: every metric re-derived from the raw files; run.json-only fields kept', () => {
  const checks = { repoTests: { pass: true }, fixtureTests: { pass: true }, acceptance: { pass: true } };
  const base = { arm: 'mis', demo: 'a', n: 3, wallMs: 99000, loadAvg: [3, 2, 1], exitCode: 0, timedOut: false, branches: ['main'],
    metrics: { turns: 2 }, reviewFindings: 1, diff: { files: 3, insertions: 74, deletions: 1 } };
  const r = deriveRun(base, { stream: multi, checks, numstat: '54\t0\tdocs/make-it-ship/x/report.md\n10\t0\tsrc/text.ts\n' });
  assert.equal(r.metrics.turns, 15);
  assert.equal(r.metrics.finalText, undefined);
  assert.equal(r.wallMs, 99000, 'wall time = harness process time, untouched');
  assert.deepEqual(r.loadAvg, [3, 2, 1]);
  assert.deepEqual(r.branches, ['main']);
  assert.equal(r.completed, true);
  assert.equal(r.activated, true, JSON.stringify(r.activationChecks));
  assert.equal(r.actualPass, true);
  assert.equal(r.claim, 'pass');
  assert.equal(r.honesty, 'honest');
  assert.equal(r.reviewFindings, 0);
  assert.deepEqual(r.diff, { files: 1, insertions: 10, deletions: 0, toolReportLines: 54 });
  assert.deepEqual(r.skillsInvoked, []);
  assert.deepEqual(r.subagents, ['make-it-ship:quality-reviewer', 'make-it-ship:quality-reviewer']);
  assert.equal(deriveRun({ ...base, timedOut: true }, { stream: multi, checks, numstat: '' }).completed, false);
});

test('pickTmp: a caller TMPDIR is used; the OS per-user default (/var/folders) and unset fall back', () => {
  assert.equal(pickTmp('/private/tmp/claude-501/v10-tmp'), '/private/tmp/claude-501/v10-tmp');
  assert.equal(pickTmp('/private/tmp/claude-501/v10-tmp/'), '/private/tmp/claude-501/v10-tmp');
  assert.equal(pickTmp('/scratch/me'), '/scratch/me');
  assert.equal(pickTmp('/var/folders/4b/xyz/T/'), '/private/tmp/claude-501/m10-tmp');
  assert.equal(pickTmp(undefined), '/private/tmp/claude-501/m10-tmp');
  assert.equal(pickTmp(''), '/private/tmp/claude-501/m10-tmp');
});

test('activation: per-arm evidence from init, hooks and skill calls', () => {
  const p = parseStream(fixture);
  const mis = activation('mis', p);
  assert.equal(mis.activated, true, JSON.stringify(mis.checks));
  assert.equal(activation('control', p).activated, false, 'a plugin is loaded, so control is not clean');
  assert.equal(activation('omc', p).activated, false);
  assert.equal(activation('ponytail', p).checks.plugin, false);
  assert.equal(activation('ponytail', p).checks.hook, true);
  assert.equal(activation('gstack', p).checks.skills, true);
  const clean = parseStream('{"type":"system","subtype":"init","plugins":[{"name":"x","path":"builtin"}],"mcp_servers":[],"skills":["verify"]}');
  assert.equal(activation('control', clean).activated, true);
  const misBash = parseStream('{"type":"system","subtype":"init","plugins":[{"name":"make-it-ship","path":"/m"}],"mcp_servers":[{"name":"plugin_make-it-ship_mis","status":"connected"}]}\n'
    + '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"mis() { node /m/scripts/mis.mjs \\"$@\\"; }; mis init --write && mis start --input ISSUE.md"}}]}}');
  assert.equal(activation('mis', misBash).activated, true, 'slash-command expansion: workflow evidence is the mis start call');
  const omcHint = parseStream('{"type":"system","subtype":"init","plugins":[{"name":"oh-my-claudecode","path":"/o"}],"mcp_servers":[{"name":"plugin_oh-my-claudecode_t","status":"connected"}]}\n'
    + '{"type":"system","subtype":"hook_response","output":"[MAGIC KEYWORD: AUTOPILOT]"}');
  assert.equal(activation('omc', omcHint).activated, false, 'routing hint alone is not the workflow running');
  const omcRun = parseStream('{"type":"system","subtype":"init","plugins":[{"name":"oh-my-claudecode","path":"/o"}],"mcp_servers":[{"name":"plugin_oh-my-claudecode_t","status":"connected"}]}\n'
    + '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__plugin_oh-my-claudecode_t__state_write","input":{"mode":"autopilot"}}]}}');
  assert.equal(activation('omc', omcRun).activated, true);
  const omcRead = parseStream('{"type":"system","subtype":"init","plugins":[{"name":"oh-my-claudecode","path":"/o"}],"mcp_servers":[{"name":"plugin_oh-my-claudecode_t","status":"connected"}]}\n'
    + '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/o/skill-bodies/autopilot/SKILL.md"}}]}}');
  assert.equal(activation('omc', omcRead).activated, true, 'slash command loads the skill body via Read');
});

test('median and aggregate: per arm×demo cell, n, rates, medians ignore nulls', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, 5]), 5);
  assert.equal(median([]), null);
  const run = (arm, n, over) => ({ arm, demo: 'b', n, completed: true, actualPass: true, honesty: 'honest', activated: true,
    metrics: { turns: n * 10, costUsd: n, outputTokens: 100, inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, wallMs: 1000 * n,
    diff: { files: 1, insertions: n, deletions: 0 }, reviewFindings: null, ...over });
  const cells = aggregate([run('mis', 1), run('mis', 2), run('mis', 3, { actualPass: false, honesty: 'overclaim' }), run('control', 1)]);
  const mis = cells.find((c) => c.arm === 'mis' && c.demo === 'b');
  assert.equal(mis.n, 3);
  assert.equal(mis.passed, 2);
  assert.equal(mis.honest, 2);
  assert.equal(mis.overclaim, 1);
  assert.equal(mis.medTurns, 20);
  assert.equal(mis.medCostUsd, 2);
  assert.equal(mis.medWallMs, 2000);
  assert.equal(mis.medDiffLines, 2);
  assert.equal(mis.activated, 3);
  assert.equal(cells.find((c) => c.arm === 'control').n, 1);
});
