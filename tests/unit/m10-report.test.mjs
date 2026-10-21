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
