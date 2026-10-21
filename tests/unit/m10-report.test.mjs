import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../../evals/m10/report.mjs';
import { aggregate } from '../../evals/m10/lib.mjs';

const arms = ['control', 'mis', 'omc', 'superpowers', 'ponytail', 'gstack'];
const demos = ['a', 'b', 'd'];
const runs = arms.flatMap((arm) => demos.map((demo) => ({
  arm, demo, n: 1, completed: arm !== 'omc', actualPass: arm !== 'gstack', honesty: arm === 'gstack' ? 'overclaim' : 'honest',
  claim: 'pass', activated: true, activationChecks: { plugin: true },
  metrics: { turns: 5, costUsd: 0.12, inputTokens: 10, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, models: ['m'], subtype: 'success' },
  wallMs: 4000, loadAvg: [1, 1, 1], diff: { files: 1, insertions: 3, deletions: 1 }, reviewFindings: null,
  actual: { repoTests: true, fixtureTests: true, acceptance: arm !== 'gstack' },
  logDir: `evals/m10/runs/${arm}/${demo}/1`, finalExcerpt: '<script>alert(1)</script> done',
})));
const summary = {
  meta: { startedAt: '2026-10-21T00:00:00Z', model: 'sonnet', maxTurns: 80, claudeVersion: '2.1.292', arms, demos, n: 1,
    isolationProbe: { answer: 'NO', userSkillsVisible: [], nonBuiltinPlugins: [] }, envRemoved: ['CLAUDECODE'], diffExcludes: ['.omc'] },
  prompts: Object.fromEntries(arms.map((a) => [a, Object.fromEntries(demos.map((d) => [d, `${a} task ${d} & "quoted"`]))])),
  runs, cells: aggregate(runs),
};

test('renderHtml: every arm and demo, method/limitations/raw-log sections', () => {
  const html = renderHtml(summary);
  for (const a of arms) assert.ok(html.includes(`>${a}<`), `arm ${a}`);
  for (const d of demos) assert.ok(html.includes(`demo ${d}`), `demo ${d}`);
  for (const h of ['Method', 'Isolation probe', 'Limitations', 'Raw logs']) assert.ok(html.includes(h), h);
  assert.ok(html.includes('evals/m10/runs/mis/b/1'));
  assert.match(html, /the authoritative numbers/, 'says summary.json, not run.json, is authoritative (M10 r2 D7)');
  assert.match(html, /<svg/);
  assert.match(html, /prefers-color-scheme: dark/);
});

test('renderHtml: self-contained (no external URLs, scripts or links) and escapes run text', () => {
  const html = renderHtml(summary);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script|<link /i);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp; &quot;quoted&quot;'));
});

test('renderHtml: empty run list still renders', () => {
  const html = renderHtml({ ...summary, runs: [], cells: [] });
  assert.match(html, /<html/);
});

test('renderHtml: caveats computed from the data, activation definitions, conclusions (M10 r1 D2-D5)', () => {
  const rs = arms.flatMap((arm) => demos.flatMap((demo) => [1, 2, 3].map((n) => ({
    arm, demo, n, completed: true, actualPass: true, honesty: 'honest', claim: 'pass',
    activated: !(arm === 'omc' && !(demo === 'a' && n === 2)) && !(arm === 'superpowers' && demo === 'd'),
    metrics: { turns: arm === 'mis' ? 12 : 6, costUsd: arm === 'mis' ? 0.3 : 0.06, inputTokens: 10, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    wallMs: 10000, loadAvg: [demo === 'a' ? 2.61 : 14.74, 1, 1], diff: { files: 1, insertions: 3, deletions: 1, toolReportLines: arm === 'mis' ? 50 : 0 },
    reviewFindings: arm === 'mis' ? 0 : null, logDir: `evals/m10/runs/${arm}/${demo}/${n}`, finalExcerpt: 'ok',
  }))));
  const s = { ...summary, meta: { ...summary.meta, n: 3, operatorNotes: ['Microsoft Defender at ~100% CPU during the run'] }, runs: rs, cells: aggregate(rs) };
  const html = renderHtml(s);
  assert.match(html, /OMC workflow activated 1\/9/);
  assert.match(html, /superpowers workflow activated 6\/9 \(demo d 0\/3\)/);
  assert.match(html, /effectively control \+ /);
  assert.match(html, /54\/54 runs passed all three checks and 54\/54 claims were honest/);
  assert.match(html, /do not discriminate between arms/);
  assert.match(html, /load1 at run start ranged 2\.61–14\.74/);
  assert.match(html, /Microsoft Defender at ~100% CPU/);
  assert.match(html, /<h2>Conclusions<\/h2>/);
  assert.match(html, /<h2>Activation definition per arm<\/h2>/);
  for (const a of arms) assert.match(html, new RegExp(`<tr><td>${a}</td><td>[^<]+`), `definition row for ${a}`);
  assert.match(html, /fixture-test gate only discriminates on demo d/);
  assert.match(html, /docs\/make-it-ship\/&lt;run&gt;\/report\.md/);
  assert.match(html, /\+50 MIS report/);
  assert.match(html, /no recorded review/);
  assert.match(html, /summed over all result events/);
  assert.doesNotMatch(html, /own rules/, 'OMC was mostly never entered; do not claim it shortened itself');
  assert.doesNotMatch(html, /nothing is estimated/);
});
