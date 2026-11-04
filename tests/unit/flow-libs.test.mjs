// M9-B pure helpers: secret scan, release, plan documents, plan-tune, diagrams, JSONL merge, decisions, keyword gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, scanPatch, describeFindings } from '../../scripts/lib/redact.mjs';
import { nextVersion, changelogRelease, classifyPath, diffScope, prTitle } from '../../scripts/lib/release.mjs';
import { parsePlanDoc } from '../../scripts/lib/plandoc.mjs';
import { validatePlan } from '../../scripts/lib/plan.mjs';
import { filterQuestions, deriveProfile, validateQuestionLog } from '../../scripts/lib/questions.mjs';
import { parseMermaid, toExcalidraw, toSvg, renderDiagram } from '../../scripts/lib/diagram.mjs';
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

test('diagram: renderDiagram covers flowchart subgraphs, sequence, class, ER and state; unsupported syntax throws', () => {
  const safe = (svg) => {
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(svg, /(fill|stroke)="#/, 'colors go through <style> classes');
    assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
    assert.equal(svg.match(/https?:\/\/[^"]*/g).filter((u) => u !== 'http://www.w3.org/2000/svg').length, 0);
  };
  const f = renderDiagram('%% c\nflowchart TD\n  subgraph api [API layer]\n    A[<script>x</script>] --> B\n  end\n  C --> A\n  classDef hot fill:#f00\n  class A hot');
  assert.equal(f.kind, 'flowchart');
  assert.deepEqual(f.groups.map((s) => [s.id, s.title, s.nodes]), [['api', 'API layer', ['A', 'B']]]);
  assert.ok(f.excalidraw.elements.some((e) => e.type === 'frame' && e.name === 'API layer'));
  safe(f.svg);
  assert.match(f.svg, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(f.svg, /API layer/);
  for (const bad of ['subgraph a\nsubgraph b\nX\nend\nend', 'subgraph a\nX\nend\na --> X', 'subgraph a\nX', 'end', 'subgraph a\nX\nend\nsubgraph b\nX\nend'])
    assert.throws(() => renderDiagram(`flowchart TD\n${bad}`), /cannot parse/, bad);

  const s = renderDiagram(`sequenceDiagram
  autonumber
  participant A as Alice
  actor B as <b>Bob</b>
  loop every minute
    A->>B: ping
    B-->>A: pong
  end
  alt ok
    A-xB: fail
  else retry
    A--xB: again
  end
  opt maybe
    B->A: solid
  end
  B-->A: dotted
  Note right of B: thinks
  Note over A,B: shared`);
  assert.equal(s.kind, 'sequence');
  assert.equal(s.excalidraw, null);
  assert.deepEqual(s.nodes.map((p) => [p.id, p.label, p.actor]), [['A', 'Alice', false], ['B', '<b>Bob</b>', true]]);
  assert.deepEqual(s.edges.map((m) => [m.from, m.to, m.arrow, m.text]), [['A', 'B', '->>', 'ping'], ['B', 'A', '-->>', 'pong'], ['A', 'B', '-x', 'fail'],
    ['A', 'B', '--x', 'again'], ['B', 'A', '->', 'solid'], ['B', 'A', '-->', 'dotted']]);
  safe(s.svg);
  for (const t of ['1. ping', 'loop [every minute]', 'alt [ok]', '[retry]', 'opt [maybe]', 'thinks', 'shared', '&lt;b&gt;Bob']) assert.ok(s.svg.includes(t), t);
  for (const bad of ['A-)B: x', 'A->>+B: x', 'activate A', 'par x', 'else', 'end', 'loop x', 'A->>B', 'rect rgb(0,0,0)'])
    assert.throws(() => renderDiagram(`sequenceDiagram\n${bad}`), /cannot parse/, bad);

  const c = renderDiagram(`classDiagram
  class Animal {
    +String name
    +eat() void
  }
  Animal : +int age
  Animal <|-- Duck
  Duck "1" *-- "many" Egg : lays
  Pond o-- Duck
  Duck --> Food
  Duck ..> Water
  Duck ..|> Swimmer
  Duck -- Bird`);
  assert.equal(c.kind, 'class');
  const animal = c.nodes.find((n) => n.id === 'Animal');
  assert.deepEqual(animal.sections, [['+String name', '+int age'], ['+eat() void']]);
  assert.deepEqual(c.edges.map((e) => [e.from, e.to, e.rel]), [['Animal', 'Duck', '<|--'], ['Duck', 'Egg', '*--'], ['Pond', 'Duck', 'o--'],
    ['Duck', 'Food', '-->'], ['Duck', 'Water', '..>'], ['Duck', 'Swimmer', '..|>'], ['Duck', 'Bird', '--']]);
  assert.deepEqual([c.edges[1].fromLabel, c.edges[1].toLabel, c.edges[1].label], ['1', 'many', 'lays']);
  safe(c.svg);
  for (const bad of ['class Box~T~', '<<interface>> Shape', 'A <--> B', 'class A {\n<<service>>\n}', 'class A {\nx'])
    assert.throws(() => renderDiagram(`classDiagram\n${bad}`), /cannot parse/, bad);

  const e = renderDiagram(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : "contains"
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name PK
    string email UK "unique"
  }`);
  assert.equal(e.kind, 'er');
  assert.deepEqual(e.edges.map((r) => [r.from, r.to, r.fromLabel, r.toLabel, r.label, r.dashed]), [['CUSTOMER', 'ORDER', '1', '0..*', 'places', false],
    ['ORDER', 'LINE-ITEM', '1', '1..*', 'contains', false], ['CUSTOMER', 'DELIVERY-ADDRESS', '1..*', '1..*', 'uses', true]]);
  assert.deepEqual(e.nodes.find((n) => n.id === 'CUSTOMER').sections, [['string name PK', 'string email UK "unique"']]);
  safe(e.svg);
  for (const bad of ['A only one to zero or more B : x', 'A ||--o{ B', 'p[Person] {\n}'])
    assert.throws(() => renderDiagram(`erDiagram\n${bad}`), /cannot parse/, bad);

  const st = renderDiagram('stateDiagram-v2\n  state "Waiting for input" as Idle\n  [*] --> Idle\n  Idle --> Busy : start\n  Busy : working hard\n  Busy --> [*]');
  assert.equal(st.kind, 'state');
  assert.deepEqual(st.edges.map((x) => [x.from, x.to, x.label]), [['[*]start', 'Idle', null], ['Idle', 'Busy', 'start'], ['Busy', '[*]end', null]]);
  assert.deepEqual(st.nodes.map((n) => [n.id, n.label, n.shape ?? 'box']), [['Idle', 'Waiting for input', 'box'], ['[*]start', '', 'start'], ['Busy', 'working hard', 'box'], ['[*]end', '', 'end']]);
  safe(st.svg);
  for (const bad of ['state Big {\nA --> B\n}', 'note right of A : x', 'state f <<fork>>', '--'])
    assert.throws(() => renderDiagram(`stateDiagram-v2\n${bad}`), /cannot parse/, bad);

  const links = renderDiagram('flowchart LR\n  A --- B\n  B -.-> C\n  C ==> D');
  assert.deepEqual(links.edges.map((x) => [x.end, x.dashed, x.thick]), [[null, undefined, undefined], [undefined, true, undefined], [undefined, undefined, true]]);
  assert.match(links.svg, /class="edge dashed" marker-end/);
  assert.match(links.svg, /class="edge thick" marker-end/);
  assert.equal(links.excalidraw.elements.find((x) => x.id === 'edge-0').endArrowhead, null);
  for (const empty of ['flowchart TD', 'classDiagram', 'erDiagram', 'stateDiagram-v2', 'sequenceDiagram\nloop x\nend'])
    assert.throws(() => renderDiagram(empty), /cannot parse: .*empty diagram/, empty);
  for (const head of ['pie title x', 'xychart-beta', 'gantt', 'stateDiagram', '---\ntitle: x\n---\nflowchart TD'])
    assert.throws(() => renderDiagram(`${head}\nA`), /unsupported diagram type/, head);
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
