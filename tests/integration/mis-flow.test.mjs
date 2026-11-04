// M9-B machinery end to end through the CLI, in throwaway repos (state lives in each repo's .git; no real home).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, mis, git, GUARD } from '../helpers.mjs';
import { FAKE } from '../fixtures/fake-secrets.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const PASS = { argv: [process.execPath, '-e', 'process.exit(0)'] };
const FAILC = { argv: [process.execPath, '-e', 'process.exit(1)'] };
const commit = (dir, msg, env = {}) => { git(dir, 'add', '-A'); spawnSync('git', ['commit', '-qm', msg], { cwd: dir, env: { ...process.env, ...env } }); };
const cleanOutsideReports = (dir) => git(dir, 'status', '--porcelain', '--', '.', ':(exclude)docs/make-it-ship');

const PLAN_MD = `# Plan: greet

## Goal
Add greet().

## Tasks
### T1: greet helper
Files: src/greet.js
- greet("a") returns "hi a"
### T2: CLI flag
Depends on: T1
- --greet prints the greeting

## Acceptance criteria
- both behaviors covered by tests

## Verification
- \`npm test\`
`;

test('B1 plan document: check exits 1 on missing sections; start --plan moves its tasks into the run plan', () => {
  const dir = makeRepo();
  write(dir, { 'docs/make-it-ship/plans/greet.md': PLAN_MD, 'docs/make-it-ship/plans/bad.md': '# x\n## Goal\ng\n' });
  const good = ok(mis(dir, ['plan', 'check', 'docs/make-it-ship/plans/greet.md']));
  assert.equal(good.ok, true);
  assert.equal(good.tasks, 2);
  const bad = mis(dir, ['plan', 'check', 'docs/make-it-ship/plans/bad.md']);
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.json.missing, ['tasks', 'acceptance', 'verification']);
  const started = ok(mis(dir, ['start', '--plan', 'docs/make-it-ship/plans/greet.md']));
  assert.deepEqual(started.tasks, ['T1: greet helper', 'T2: CLI flag']);
  const st = ok(mis(dir, ['status', '--json'])).state;
  assert.equal(st.plan.tasks.length, 2);
  assert.deepEqual(st.plan.tasks.map((t) => t.title), ['greet helper', 'CLI flag']);
  assert.equal(st.input.kind, 'file');
  assert.equal(cleanOutsideReports(dir), '', 'planning leaves code untouched');
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-')));
  assert.ok(ok(mis(dir, ['test-prompt', 'build', 'it'], { env: { MIS_STATE_HOME: home } })).matches.includes('clarify'), 'ralplan gate via mis test-prompt');
  assert.ok(!ok(mis(dir, ['test-prompt', 'just', 'do', 'it'], { env: { MIS_STATE_HOME: home } })).matches.includes('clarify'));
});

test('B3 plan-tune: question log, preferences, profile; interview skips a skip-preference item unless HIGH', () => {
  const dir = makeRepo();
  ok(mis(dir, ['question', 'log', '-'], { input: JSON.stringify({ qid: 'test-runner', question: 'Runner?', impact: 'LOW', recommended: 'node --test', chosen: 'node --test' }) }));
  assert.notEqual(mis(dir, ['question', 'log', '{"qid":"x"}']).code, 0);
  ok(mis(dir, ['question', 'pref', 'set', 'test-runner', 'skip']));
  ok(mis(dir, ['question', 'pref', 'set', 'auth-provider', 'skip']));
  assert.deepEqual(ok(mis(dir, ['question', 'pref', 'list'])).prefs, { 'test-runner': 'skip', 'auth-provider': 'skip' });
  const prof = ok(mis(dir, ['profile']));
  assert.equal(prof.answered, 1);
  assert.equal(prof.followedRecommendation, 100);
  ok(mis(dir, ['start', '--input', 'x']));
  const low = ok(mis(dir, ['interview', 'add', JSON.stringify({ qid: 'test-runner', question: 'Runner?', impact: 'LOW', default: 'node --test' })]));
  assert.equal(low.skippedByPreference, true);
  assert.match(low.answer, /node --test \(skipped/);
  const high = ok(mis(dir, ['interview', 'add', JSON.stringify({ qid: 'auth-provider', question: 'Which IdP?', impact: 'HIGH' })]));
  assert.equal(high.answer, null, 'HIGH is always asked');
});

test('B5 secrets: redact scan finds keys planted in the tree and in history; debt ledger stands alone', () => {
  const dir = makeRepo({ 'src/a.js': `// shortcut: in-memory only, move to sqlite past 10k rows\nconst k = "${FAKE.aws}";\n` });
  write(dir, { 'src/a.js': '// shortcut: in-memory only, move to sqlite past 10k rows\nconst k = process.env.K;\n' });
  commit(dir, 'remove key');
  assert.equal(ok(mis(dir, ['redact', 'scan'])).clean, true);
  const h = mis(dir, ['redact', 'scan', '--history']);
  assert.equal(h.code, 1);
  assert.deepEqual(h.json.findings.map((f) => [f.where, f.file, f.line, f.kind]), [['history', 'src/a.js', 2, 'aws-access-key']]);
  assert.ok(!h.out.includes(FAKE.aws), 'values never printed');
  write(dir, { 'cfg.js': `token: "${FAKE.gh}"\n` });
  assert.equal(mis(dir, ['redact', 'scan']).json.findings[0].file, 'cfg.js');
  assert.match(ok(mis(dir, ['debt'])), /src\/a\.js:1.*in-memory only/);
  assert.equal(ok(mis(dir, ['debt', '--json'])).total, 1);
});

test('M9 redact: personal data and legal markers (opt-in for scan), file --apply replaces values without printing them', () => {
  const V = { email: 'kim.minsu@corp-mail.io', phone: '010-2345-6789', rrn: '900101-1234567', card: '4111 1111 1111 1111', ssn: '123-45-6789' };
  const text = `Contact ${V.email} or ${V.phone}\nRRN ${V.rrn}\nCard ${V.card} (not a card: 4111 1111 1111 1112)\nSSN ${V.ssn}\nCONFIDENTIAL - 대외비\nbuild 2026-10-20, v1.2.3.4, ts 1717000000, test@example.com\n`;
  const dir = makeRepo({ 'notes.md': text });
  assert.equal(ok(mis(dir, ['redact', 'scan'])).clean, true, 'secrets only by default (the push gate never blocks on an email)');
  const scan = mis(dir, ['redact', 'scan', '--pii', '--legal']);
  assert.equal(scan.code, 1);
  assert.deepEqual(scan.json.findings.map((x) => `${x.line}:${x.kind}`), ['1:email', '1:phone', '2:kr-rrn', '3:credit-card', '4:us-ssn', '5:confidential-marker', '5:confidential-marker-ko']);
  const one = mis(dir, ['redact', 'file', 'notes.md']);
  assert.equal(one.code, 1); assert.equal(one.json.findings.length, 7);
  const applied = ok(mis(dir, ['redact', 'file', 'notes.md', '--apply']));
  assert.equal(applied.redacted, 5);
  assert.deepEqual(applied.remaining.map((x) => x.kind), ['confidential-marker', 'confidential-marker-ko'], 'legal markers stay');
  const after = readFileSync(join(dir, 'notes.md'), 'utf8');
  assert.match(after, /Contact \[REDACTED-EMAIL\] or \[REDACTED-PHONE\]\nRRN \[REDACTED-KR-RRN\]\nCard \[REDACTED-CREDIT-CARD\] \(not a card: 4111 1111 1111 1112\)\nSSN \[REDACTED-US-SSN\]/);
  assert.match(after, /build 2026-10-20, v1\.2\.3\.4, ts 1717000000, test@example\.com/, 'dates, versions, timestamps and example addresses are left alone');
  for (const r of [scan, one, applied && { out: JSON.stringify(applied), err: '' }]) for (const v of Object.values(V)) assert.ok(!r.out.includes(v) && !r.err.includes(v), `value printed: ${v}`);
  assert.match(mis(dir, ['redact', 'file']).err, /usage/);
});

test('B5 guard: a push whose unpushed commits contain a secret asks, naming file:line (no run needed)', () => {
  const dir = makeRepo();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-'))); // the guard traces to its state home
  const guard = (command) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir }), encoding: 'utf8', env: { ...process.env, MIS_STATE_HOME: home } });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  assert.equal(guard('git push origin main'), null, 'clean history: a plain push outside a run passes');
  write(dir, { 'k.txt': `${FAKE.gh}\n` });
  commit(dir, 'add');
  const r = guard('git push origin main');
  assert.equal(r.permissionDecision, 'ask');
  assert.match(r.permissionDecisionReason, /SECRET SCAN.*k\.txt:1 \(github-token/);
  assert.ok(!r.permissionDecisionReason.includes(FAKE.gh));
});

test('B5 health: weighted score from the checks, appended to the history with a trend', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { test: PASS, lint: FAILC } } });
  const a = ok(mis(dir, ['health']));
  assert.equal(a.score, 60); // test 30 PASS, lint 20 FAIL
  assert.deepEqual(a.checks.lint.status, 'FAIL');
  write(dir, { '.make-it-ship.json': { version: 1, checks: { test: PASS, lint: PASS } } });
  const b = ok(mis(dir, ['health']));
  assert.equal(b.score, 100);
  assert.equal(b.delta, 40);
  assert.deepEqual(b.trend, [60, 100]);
  assert.equal(readFileSync(join(dir, 'docs/make-it-ship/health.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('B6 release: version-bump updates VERSION/package.json/CHANGELOG deterministically; next-version; PR title v<ver>; diff-scope; repo-mode', () => {
  const dir = makeRepo({ VERSION: '1.2.3\n', 'package.json': '{\n  "name": "x",\n  "version": "1.2.3"\n}\n', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n- added export\n',
    '.make-it-ship.json': { version: 1, checks: { test: PASS } } });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'Add greet', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  const plain = ok(mis(dir, ['ship']));
  assert.match(readFileSync(join(dir, plain.path), 'utf8'), /\*\*제목\*\*: Add greet\n/, 'no bump in this run: the title has no version');
  assert.deepEqual(ok(mis(dir, ['next-version', 'minor'])), { from: '1.2.3', to: '1.3.0', level: 'minor' });
  const r = ok(mis(dir, ['version-bump', 'minor', '--date', '2026-10-20']));
  assert.deepEqual(r.files, ['VERSION', 'package.json', 'CHANGELOG.md']);
  assert.equal(readFileSync(join(dir, 'VERSION'), 'utf8'), '1.3.0\n');
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{\n  "name": "x",\n  "version": "1.3.0"\n}\n');
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), '# Changelog\n\n## [Unreleased]\n\n## [1.3.0] - 2026-10-20\n- added export\n');
  assert.notEqual(mis(dir, ['version-bump', 'huge']).code, 0);
  const ship = ok(mis(dir, ['ship']));
  assert.match(readFileSync(join(dir, ship.path), 'utf8'), /\*\*제목\*\*: v1\.3\.0 Add greet/);
  commit(dir, 'release');
  write(dir, { 'src/a.js': 'x', 'test/a.test.js': 'x', 'README.md': 'y', 'tsconfig.json': '{}' });
  const scope = ok(mis(dir, ['diff-scope', '--base', 'HEAD']));
  assert.deepEqual([scope.code, scope.test, scope.docs, scope.config], [['src/a.js'], ['test/a.test.js'], ['README.md'], ['tsconfig.json']]);
  assert.equal(ok(mis(dir, ['repo-mode'])).mode, 'solo');
  for (const who of ['a', 'b', 'c']) { write(dir, { [`${who}.txt`]: who }); commit(dir, who, { GIT_AUTHOR_EMAIL: `${who}@x.com`, GIT_AUTHOR_NAME: who }); }
  const mode = ok(mis(dir, ['repo-mode']));
  assert.equal(mode.mode, 'collaborative');
  assert.equal(mode.authors, 4);
});

test('B7 context save/restore warns on branch mismatch; goals ledger with /goal handoff; sessions of every project', () => {
  const dir = makeRepo();
  ok(mis(dir, ['context', 'save', 'parser-work', '--note', 'next: handle quoted commas']));
  assert.deepEqual(ok(mis(dir, ['context', 'restore', 'parser-work'])).warnings, []);
  git(dir, 'switch', '-qc', 'other');
  const r = ok(mis(dir, ['context', 'restore', 'parser-work']));
  assert.equal(r.note, 'next: handle quoted commas');
  assert.match(r.warnings[0], /branch mismatch: saved on main, now on other/);
  assert.equal(ok(mis(dir, ['context', 'list'])).contexts[0].name, 'parser-work');
  assert.notEqual(mis(dir, ['context', 'restore', 'nope']).code, 0);

  const g1 = ok(mis(dir, ['goal', 'add', 'CSV', 'export', '--criteria', 'quotes commas; header first']));
  assert.match(g1.handoff, /^\/goal G1: CSV export\. Done when: quotes commas; header first\./);
  ok(mis(dir, ['goal', 'add', 'JSON export']));
  assert.notEqual(mis(dir, ['goal', 'done', 'G1']).code, 0, 'evidence required');
  const d = ok(mis(dir, ['goal', 'done', 'G1', '--evidence', 'VERIFIED run 1']));
  assert.equal(d.remaining, 1);
  assert.match(d.handoff, /^\/goal G2: JSON export/);
  assert.deepEqual(ok(mis(dir, ['goal', 'list'])).goals.map((g) => g.status), ['done', 'open']);

  const cfgDir = realpathSync(mkdtempSync(join(tmpdir(), 'mis-claude-cfg-')));
  for (const [p, cwd] of [['-work-a', '/work/a'], ['-work-b', '/work/b']]) {
    mkdirSync(join(cfgDir, 'projects', p), { recursive: true });
    writeFileSync(join(cfgDir, 'projects', p, 's1.jsonl'), JSON.stringify({ type: 'user', cwd }) + '\n');
  }
  const s = ok(mis(dir, ['context', 'sessions'], { env: { CLAUDE_CONFIG_DIR: cfgDir } }));
  assert.deepEqual(s.projects.map((p) => p.project).sort(), ['/work/a', '/work/b']);
});

test('B4 design: comparison board with data-choice per variant, mermaid → excalidraw/svg/html, taste profile', () => {
  const dir = makeRepo();
  write(dir, { 'design/a.html': '<p>A</p>', 'design/b.html': '<p>B</p>', 'design/arch.mmd': 'flowchart TD\n  U[User] --> W[Web]\n  W --> D[DB]\n' });
  const b = ok(mis(dir, ['design-board', 'design']));
  const html = readFileSync(join(dir, 'design/board.html'), 'utf8');
  assert.match(html, /data-choice="a\.html"/);
  assert.match(html, /data-choice="b\.html"/);
  assert.deepEqual(b.variants, ['a.html', 'b.html']);
  const d = ok(mis(dir, ['diagram', 'design/arch.mmd']));
  assert.deepEqual(d.files, ['design/arch.mmd', 'design/arch.excalidraw', 'design/arch.svg', 'design/arch.html']);
  const ex = JSON.parse(readFileSync(join(dir, 'design/arch.excalidraw'), 'utf8'));
  assert.ok(Array.isArray(ex.elements) && ex.elements.length === 8);
  assert.match(d.png, /mis browse screenshot.*BLOCKED/);
  write(dir, { 'design/seq.mmd': 'sequenceDiagram\n  A->>B: <script>alert(1)</script>\n' });
  const s = ok(mis(dir, ['diagram', 'design/seq.mmd']));
  assert.equal(s.kind, 'sequence');
  assert.equal(s.excalidraw, null);
  assert.match(s.note, /flowchart only/);
  assert.deepEqual(s.files, ['design/seq.mmd', 'design/seq.svg', 'design/seq.html']);
  assert.ok(!existsSync(join(dir, 'design/seq.excalidraw')));
  const page = readFileSync(join(dir, 'design/seq.html'), 'utf8');
  assert.doesNotMatch(page, /<script/i);
  assert.match(page, /prefers-color-scheme: dark/);
  assert.deepEqual(ok(mis(dir, ['design-board', 'design'])).variants, ['a.html', 'b.html'], 'diagram HTML is not a design variant');
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'mis-out-')));
  writeFileSync(join(outside, 'x.mmd'), 'flowchart TD\n  A --> B\n');
  for (const args of [['design/arch.mmd', '--out', '../escape'], ['design/arch.mmd', '--out', join(outside, 'o')], [join(outside, 'x.mmd')]]) {
    const r = mis(dir, ['diagram', ...args]);
    assert.notEqual(r.code, 0, args.join(' '));
    assert.match(r.err + r.out, /outside the repository/);
  }
  assert.ok(!existsSync(join(dir, '../escape')) && !existsSync(join(outside, 'o')), 'refused --out is never created');
  write(dir, { 'design/bad.mmd': 'pie title x\n  "a" : 1\n' });
  assert.match(mis(dir, ['diagram', 'design/bad.mmd']).err, /unsupported diagram type/);
  ok(mis(dir, ['taste', 'approve', 'a.html', '--tags', 'serif,warm']));
  ok(mis(dir, ['taste', 'reject', 'b.html', '--tags', 'gradient,warm']));
  const t = ok(mis(dir, ['taste', 'show']));
  assert.deepEqual([t.prefer, t.avoid], [['serif'], ['gradient']]);
});

test('B8 decisions, learn search/distill (proposals unless --yes), JSONL merge driver unions two branches', () => {
  const dir = makeRepo();
  const d1 = ok(mis(dir, ['decision', 'add', JSON.stringify({ decision: 'Use SQLite for local state', rationale: 'single user, no server' })])).recorded;
  assert.notEqual(mis(dir, ['decision', 'add', JSON.stringify({ decision: `key ${FAKE.aws}`, rationale: 'x' })]).code, 0, 'secrets refused');
  ok(mis(dir, ['decision', 'supersede', d1.id, JSON.stringify({ decision: 'Use Postgres', rationale: 'multi-user now' })]));
  assert.deepEqual(ok(mis(dir, ['decision', 'search', 'use'])).decisions.map((d) => d.decision), ['Use Postgres']);
  assert.equal(ok(mis(dir, ['decision', 'search', '--all'])).decisions.length, 2);

  const notes = '- pitfall: node --test needs a quoted glob for ts files\nrandom prose line\n- preference: user wants zero new dependencies\n';
  const prop = ok(mis(dir, ['learn', 'distill', '-'], { input: notes }));
  assert.equal(prop.applied, false);
  assert.equal(prop.proposals.length, 2);
  assert.equal(existsSync(join(dir, 'docs/make-it-ship/learnings.jsonl')), false, 'proposals change nothing');
  assert.equal(ok(mis(dir, ['learn', 'distill', '-', '--yes'], { input: notes })).applied, true);
  assert.deepEqual(ok(mis(dir, ['learn', 'search', 'glob'])).entries.map((e) => e.type), ['pitfall']);
  assert.equal(ok(mis(dir, ['learn', 'search', '--type', 'preference'])).entries.length, 1);

  commit(dir, 'ledgers');
  ok(mis(dir, ['jsonl-merge', 'install']));
  assert.equal(git(dir, 'status', '--porcelain'), '', 'install touches no tracked file');
  const f = 'docs/make-it-ship/decisions.jsonl';
  const base = readFileSync(join(dir, f), 'utf8');
  git(dir, 'switch', '-qc', 'side');
  writeFileSync(join(dir, f), base + '{"side":1}\n');
  commit(dir, 'side');
  git(dir, 'switch', '-q', 'main');
  writeFileSync(join(dir, f), base + '{"main":1}\n');
  commit(dir, 'main');
  const m = spawnSync('git', ['merge', '--no-edit', 'side'], { cwd: dir, encoding: 'utf8' });
  assert.equal(m.status, 0, m.stdout + m.stderr);
  assert.equal(readFileSync(join(dir, f), 'utf8'), base + '{"main":1}\n{"side":1}\n');
});

test('B8 retro --git: commits, hotspots and per-author metrics plus reviewer hit rate', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { test: PASS } } });
  write(dir, { 'src/a.js': '1' }); commit(dir, 'a1');
  write(dir, { 'src/a.js': '2' }); commit(dir, 'a2', { GIT_AUTHOR_NAME: 'Kim', GIT_AUTHOR_EMAIL: 'kim@x.com' });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'VERDICT: REVISE\nBLOCKING: 1\nMAJOR: 0\n' }));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'VERDICT: ACCEPT\nBLOCKING: 0\nMAJOR: 0\n' }));
  const r = ok(mis(dir, ['retro', '--git', '--since', '7d']));
  assert.equal(r.git.commits, 3);
  assert.deepEqual(r.git.hotspots[0], { file: 'src/a.js', changes: 2 });
  assert.deepEqual(r.git.authors.map((a) => [a.name, a.commits]), [['Test', 2], ['Kim', 1]]);
  assert.deepEqual(r.metrics.reviewers.quality, { reviews: 2, hits: 1, hitRate: 0.5 });
  const md = readFileSync(join(dir, r.path), 'utf8');
  assert.match(md, /핫스팟/);
  assert.match(md, /quality 1\/2/);
});

test('B9 session create runs the baseline check in the new worktree and prints it', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { test: PASS, lint: FAILC }, required: { quick: ['test', 'lint'] } } });
  const s = ok(mis(dir, ['session', 'create', 'feature', 'csv export']));
  assert.equal(s.baseline.status, 'FAIL');
  assert.deepEqual(s.baseline.checks.map((c) => [c.name, c.status]), [['test', 'PASS'], ['lint', 'FAIL']]);
  const n = ok(mis(dir, ['session', 'create', 'feature', 'other', '--no-baseline']));
  assert.equal(n.baseline, null);
});
