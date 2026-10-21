// M9-B pure helpers: secret scan, release, plan documents, plan-tune, diagrams, JSONL merge, decisions, keyword gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, scanPatch, describeFindings } from '../../scripts/lib/redact.mjs';
import { nextVersion, changelogRelease, classifyPath, diffScope, prTitle } from '../../scripts/lib/release.mjs';
import { parsePlanDoc } from '../../scripts/lib/plandoc.mjs';
import { validatePlan } from '../../scripts/lib/plan.mjs';
import { filterQuestions, deriveProfile, validateQuestionLog } from '../../scripts/lib/questions.mjs';
import { parseMermaid, toExcalidraw, toSvg } from '../../scripts/lib/diagram.mjs';
import { mergeJsonl, activeDecisions } from '../../scripts/lib/commands-flow.mjs';
import { detectKeywords } from '../../scripts/lib/keywords.mjs';
import { classify } from '../../scripts/lib/policy.mjs';
import { FAKE } from '../fixtures/fake-secrets.mjs';


test('secret scan: finds kinds with file:line and never echoes the value', () => {
  const f = scanText(`ok\ntoken = "${FAKE.gh}"\nkey ${FAKE.aws}\n`, 'src/a.js');
  assert.deepEqual(f.map((x) => [x.line, x.kind]), [[2, 'github-token'], [2, 'secret-assignment'], [3, 'aws-access-key']]);
  assert.ok(!JSON.stringify(f).includes(FAKE.gh));
  assert.doesNotMatch(describeFindings(f), new RegExp(FAKE.aws));
  assert.deepEqual(scanText('const password = process.env.PW; // no literal', 'x'), []);
});

test('secret scan of a patch: only added lines, commit and new-file line numbers', () => {
  const patch = ['commit 0123456789abcdef', '', 'diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +10,3 @@', ' context', `-old ${FAKE.aws}`, '+fine', `+k ${FAKE.aws}`].join('\n');
  assert.deepEqual(scanPatch(patch), [{ commit: '0123456789ab', file: 'x', line: 12, kind: 'aws-access-key' }]);
});

test('release: semver bumps, keep-a-changelog release, PR title prefix, diff scope', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion(null, 'minor'), '0.1.0');
  assert.throws(() => nextVersion('1.2', 'patch'), /MAJOR.MINOR.PATCH/);
  assert.equal(changelogRelease('# Changelog\n\n## [Unreleased]\n- a\n', '1.3.0', '2026-10-20'), '# Changelog\n\n## [Unreleased]\n\n## [1.3.0] - 2026-10-20\n- a\n');
  assert.match(changelogRelease('# Changelog\n\n## [1.0.0]\n', '1.0.1', '2026-10-20'), /^# Changelog\n\n## \[1\.0\.1\] - 2026-10-20\n/);
  assert.equal(prTitle('Add export', '1.3.0'), 'v1.3.0 Add export');
  assert.equal(prTitle('v1.2.0 Add export', '1.3.0'), 'v1.3.0 Add export');
  assert.equal(prTitle('Add export', null), 'Add export');
  assert.deepEqual(diffScope(['src/a.ts', 'test/a.test.ts', 'src/b.spec.js', 'README.md', 'docs/x.png', 'package.json', '.github/workflows/ci.yml', 'tsconfig.json', 'app/main.py', 'tests/test_x.py']), {
    code: ['src/a.ts', 'app/main.py'], test: ['test/a.test.ts', 'src/b.spec.js', 'tests/test_x.py'], docs: ['README.md', 'docs/x.png'], config: ['package.json', '.github/workflows/ci.yml', 'tsconfig.json'] });
  assert.equal(classifyPath('Makefile'), 'config');
});

const PLAN_MD = `# Plan: CSV export

## Goal
Users can export the table as CSV.

## Constraints
- no new dependencies

## Tasks
### T1: CSV serializer
Files: src/csv.js, test/csv.test.js
- [ ] quotes fields containing commas
- [ ] header row first
### T2: Export button
Depends on: T1
- clicking Export downloads table.csv

## Acceptance criteria
- exported file opens in a spreadsheet with the same rows

## Verification
- \`npm test\`
`;

test('plan document: required sections, tasks with acceptance, mapped to a valid plan', () => {
  const { plan, missing } = parsePlanDoc(PLAN_MD);
  assert.deepEqual(missing, []);
  assert.deepEqual(validatePlan(plan), []);
  assert.equal(plan.goal, 'Users can export the table as CSV.');
  assert.deepEqual(plan.tasks.map((t) => [t.id, t.title, t.acceptance.length]), [['T1', 'CSV serializer', 2], ['T2', 'Export button', 1]]);
  assert.deepEqual(plan.tasks[0].files, ['src/csv.js', 'test/csv.test.js']);
  assert.deepEqual(plan.tasks[1].dependsOn, ['T1']);
  assert.deepEqual(plan.howToRun, ['npm test']);
  assert.deepEqual(plan.constraints, ['no new dependencies']);
  const bad = parsePlanDoc('# P\n## Goal\nx\n## Tasks\n### T1: a\nno bullets\n');
  assert.deepEqual(bad.missing, ['acceptance', 'verification', 'acceptance criteria of task T1']);
  assert.deepEqual(parsePlanDoc('nothing').missing, ['goal', 'tasks', 'acceptance', 'verification']);
});

test('plan-tune: skip preferences drop MED/LOW items only; HIGH is always asked', () => {
  const items = [{ qid: 'test-runner', impact: 'LOW' }, { qid: 'auth-provider', impact: 'HIGH' }, { qid: 'naming', impact: 'MED' }, { impact: 'LOW' }];
  const { ask, skip } = filterQuestions(items, { 'test-runner': 'skip', 'auth-provider': 'skip', naming: 'ask' });
  assert.deepEqual(skip.map((q) => q.qid), ['test-runner']);
  assert.deepEqual(ask.map((q) => q.qid), ['auth-provider', 'naming', undefined]);
  assert.match(validateQuestionLog({ qid: 'Bad Id', question: 'q', chosen: 'a' }).join(), /qid/);
});

test('plan-tune profile: fixture log → fixed output', () => {
  const log = [
    { qid: 'test-runner', question: 'Runner?', impact: 'LOW', recommended: 'node --test', chosen: 'node --test' },
    { qid: 'test-runner', question: 'Runner?', impact: 'LOW', recommended: 'node --test', chosen: 'node --test' },
    { qid: 'test-runner', question: 'Runner?', impact: 'LOW', recommended: 'node --test', chosen: 'node --test' },
    { qid: 'db', question: 'DB?', impact: 'HIGH', recommended: 'sqlite', chosen: 'postgres' },
  ];
  assert.deepEqual(deriveProfile(log, { naming: 'skip' }), {
    answered: 4, followedRecommendation: 75, style: 'trusts-recommendations', byImpact: { HIGH: 1, LOW: 3 },
    repeatedQuestions: ['test-runner'], skipPreferences: ['naming'],
    hints: ['Lead with the recommendation; keep options short.', '"test-runner" was asked 3 times; offer a skip preference (mis question pref set test-runner skip) if the answer never changes.'],
  });
  assert.equal(deriveProfile([]).style, 'unknown');
});

test('diagram: mermaid flowchart → excalidraw elements and svg', () => {
  const g = parseMermaid('flowchart LR\n  A[Client] -->|HTTP| B(API)\n  B --> C{DB}\n  C --- A');
  assert.deepEqual(g.nodes.map((n) => [n.id, n.label]), [['A', 'Client'], ['B', 'API'], ['C', 'DB']]);
  assert.deepEqual(g.edges.map((e) => [e.from, e.to, e.label]), [['A', 'B', 'HTTP'], ['B', 'C', null], ['C', 'A', null]]);
  const ex = toExcalidraw(g);
  assert.equal(ex.type, 'excalidraw');
  assert.ok(Array.isArray(ex.elements));
  assert.equal(ex.elements.filter((e) => e.type === 'rectangle').length, 3);
  assert.equal(ex.elements.filter((e) => e.type === 'arrow').length, 3);
  assert.equal(ex.elements.find((e) => e.type === 'text').text, 'Client');
  assert.match(toSvg(g), /^<svg[\s\S]*Client[\s\S]*<\/svg>$/);
  assert.throws(() => parseMermaid('sequenceDiagram\nA->>B: x'), /flowchart/);
  assert.throws(() => parseMermaid('graph TD\nA --> '), /cannot parse/);
});

test('JSONL union merge and decision supersede view', () => {
  assert.equal(mergeJsonl('{"a":1}\n{"b":2}\n', '{"a":1}\n{"c":3}\n'), '{"a":1}\n{"b":2}\n{"c":3}\n');
  const ev = [{ type: 'decide', id: 'D1', decision: 'x' }, { type: 'decide', id: 'D2', decision: 'y' }, { type: 'supersede', id: 'D1', by: 'D2' }];
  assert.deepEqual(activeDecisions(ev).map((d) => [d.id, d.active, d.supersededBy]), [['D1', false, 'D2'], ['D2', true, null]]);
});

test('router: vague execution requests get the interview gate; real requests and "just do it" do not', () => {
  const n = (p) => detectKeywords(p).map((m) => m.name);
  for (const p of ['build it', 'just build it now', 'implement this', 'make it.', '그냥 만들어줘', '알아서 구현해줘']) assert.deepEqual(n(p), ['clarify'], p);
  for (const p of ['just do it', 'ship it', 'build me an app for notes', 'make it faster by caching the parsed config', 'implement the CSV export in src/csv.js']) assert.ok(!n(p).includes('clarify'), p);
  assert.deepEqual(n('ralphthon a todo app'), ['ralphthon']);
  assert.ok(n('deepinit this repo').includes('deepinit'));
  assert.ok(n('autoplan the plan').includes('autoplan'));
  assert.ok(n('office hours: an idea for a CLI').includes('office-hours'));
  assert.ok(n('ponytail-audit').includes('audit'));
  assert.ok(n('audit the whole repo').includes('audit'));
  assert.deepEqual(n('check the health of the API'), []);
});

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: '/r' });
const ctx = { repoRoot: '/r', activeRun: false, currentBranch: 'feature' };
const finding = { findings: [{ file: 'src/a.js', line: 3, kind: 'github-token', commit: 'abc' }], commits: 2 };

test('guard pre-push secret scan: findings ask with file:line even without a run; the ask shows the scan; never deny', () => {
  assert.equal(classify(bash('git push'), { ...ctx, pushScan: { findings: [], commits: 2 } }).decision, 'allow');
  const r = classify(bash('git push origin feature'), { ...ctx, pushScan: finding });
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /SECRET SCAN: 1 possible secret.*src\/a\.js:3 \(github-token, abc\)/);
  const inRun = classify(bash('git push'), { ...ctx, activeRun: true, pushScan: { findings: [], commits: 4 } });
  assert.equal(inRun.decision, 'ask');
  assert.match(inRun.reason, /secret scan: clean, 4 unpushed commit/);
  assert.match(classify(bash('git push'), { ...ctx, activeRun: true, pushScan: { error: 'timeout' } }).reason, /secret scan unavailable: timeout/);
  assert.equal(classify(bash('git push --force origin main'), { ...ctx, pushScan: finding }).decision, 'deny');
});

test('guard: creating or deleting a tag asks; listing does not', () => {
  for (const c of ['git tag v1.2.0', 'git tag -a v1 -m rel', 'git tag -d v1']) assert.equal(classify(bash(c), ctx).decision, 'ask', c);
  for (const c of ['git tag', 'git tag -l', 'git tag --list "v*"', 'git tag --contains HEAD']) assert.equal(classify(bash(c), ctx).decision, 'allow', c);
});
