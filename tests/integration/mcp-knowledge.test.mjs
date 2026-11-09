import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, git, mis } from '../helpers.mjs';
import { mcpSession } from '../helpers-mcp.mjs';
import { tools } from '../../scripts/mcp/tools/knowledge.mjs';
import { wikiSessionContext, wikiPreCompact, wikiSessionEnd, WIKI_DIR } from '../../scripts/lib/wiki.mjs';
import { appendTrace } from '../../scripts/lib/trace.mjs';
import { stateRoot } from '../../scripts/lib/state.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
// Every session gets a private home and projects dir: nothing touches the real ~/.claude or ~/.make-it-ship.
async function session(dir, env = {}) {
  return mcpSession(dir, { MIS_STATE_HOME: tmp('mis-home-'), MIS_CLAUDE_PROJECTS_DIR: tmp('mis-proj-'), ...env });
}

test('knowledge module exports exactly the 17 tools', () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'deepinit_manifest', 'memory_search', 'merge_readiness_cancel', 'merge_readiness_record_answer', 'merge_readiness_report',
    'merge_readiness_set_content', 'merge_readiness_start', 'session_search', 'trace_summary', 'trace_timeline',
    'wiki_add', 'wiki_delete', 'wiki_ingest', 'wiki_lint', 'wiki_list', 'wiki_query', 'wiki_read',
  ]);
});

test('wiki: add, read, list, query, ingest (merge + file), delete, lint; git-ignored', async () => {
  const dir = makeRepo({ 'README.md': '# demo\n', 'docs/auth.md': '# Auth notes\nTokens rotate every hour. See [[Session Store]].\n' });
  const s = await session(dir);
  try {
    const a = await s.call('wiki_add', { title: 'Auth Architecture', content: 'JWT tokens, refresh flow. Links [[Session Store]].', tags: ['auth'], category: 'architecture' });
    assert.equal(a.isError, false, a.text);
    assert.equal(git(dir, 'status', '--porcelain'), '', 'wiki pages must not show up as changes');
    assert.equal((await s.call('wiki_add', { title: 'Auth Architecture', content: 'dup' })).isError, true);

    const r = await s.call('wiki_read', { page: 'auth-architecture' });
    assert.match(r.text, /JWT tokens/);
    assert.match(r.text, /Links:.*session-store/);
    assert.equal((await s.call('wiki_read', { page: '../secret' })).isError, true);

    await s.call('wiki_add', { title: 'Session Store', content: 'Redis backed. Back to [[Auth Architecture]].', tags: ['storage'] });
    const l = await s.call('wiki_list');
    assert.match(l.text, /Auth Architecture/);
    assert.match(l.text, /Session Store/);

    const q = await s.call('wiki_query', { query: 'refresh tokens' });
    assert.equal(q.json[0].page, 'auth-architecture');
    assert.ok(q.json[0].score > 0);
    assert.match(q.json[0].snippet, /refresh|tokens/i);
    assert.deepEqual((await s.call('wiki_query', { query: 'nothing-matches-this' })).json, []);

    const m = await s.call('wiki_ingest', { title: 'Auth Architecture', content: 'Added PKCE.', tags: ['security'] });
    assert.deepEqual(m.json.updated, ['auth-architecture']);
    const merged = (await s.call('wiki_read', { page: 'auth-architecture' })).text;
    assert.match(merged, /JWT tokens[\s\S]*## Update[\s\S]*Added PKCE/);
    assert.match(merged, /Tags:.*auth.*security/);

    const f = await s.call('wiki_ingest', { path: 'docs/auth.md', tags: ['ops'] });
    assert.deepEqual(f.json.created, ['auth-notes']);
    assert.match((await s.call('wiki_read', { page: 'auth-notes' })).text, /Tokens rotate/);
    assert.equal((await s.call('wiki_ingest', { path: '../../etc/passwd' })).isError, true);
    symlinkSync('/etc/hosts', join(dir, 'docs/escape.md'));
    assert.equal((await s.call('wiki_ingest', { path: 'docs/escape.md' })).isError, true, 'symlink out of the repo');
    assert.equal((await s.call('wiki_add', { title: 'Index', content: 'x' })).isError, true, 'reserved page name');
    assert.match(readFileSync(join(dir, WIKI_DIR, 'index.md'), 'utf8'), /# Wiki Index/);

    write(dir, { [`${WIKI_DIR}/broken.md`]: 'no frontmatter here' });
    await s.call('wiki_add', { title: 'Lonely', content: 'Points to [[Nowhere]].' });
    const lint = (await s.call('wiki_lint')).json;
    const has = (type, page) => lint.issues.some((i) => i.type === type && i.page === page);
    assert.ok(has('broken-ref', 'lonely'), JSON.stringify(lint));
    assert.ok(has('orphan', 'lonely'));
    assert.ok(!has('orphan', 'auth-architecture'));
    assert.ok(has('format', 'broken'));

    assert.equal((await s.call('wiki_delete', { page: 'lonely' })).isError, false);
    assert.equal((await s.call('wiki_read', { page: 'lonely' })).isError, true);
    assert.equal((await s.call('wiki_delete', { page: 'lonely' })).isError, true);
    assert.match(readFileSync(join(dir, WIKI_DIR, 'log.md'), 'utf8'), /delete[\s\S]*lonely/);
  } finally { s.close(); }
});

test('wiki hook libraries: empty without a wiki, index/summary with one, idempotent session-end capture', async () => {
  const dir = makeRepo();
  assert.equal(wikiSessionContext(dir), '');
  assert.equal(wikiPreCompact(dir), '');
  wikiSessionEnd(dir, { sessionId: 'abc' });
  assert.equal(existsSync(join(dir, WIKI_DIR)), false, 'session end must not create a wiki');

  const s = await session(dir);
  try { await s.call('wiki_add', { title: 'Build Steps', content: 'npm test runs everything.', category: 'environment' }); } finally { s.close(); }
  assert.match(wikiSessionContext(dir), /1 pages?[\s\S]*Build Steps/);
  assert.match(wikiPreCompact(dir), /1 pages?[\s\S]*environment/);
  wikiSessionEnd(dir, { sessionId: 'abc', reason: 'exit' });
  wikiSessionEnd(dir, { sessionId: 'abc', reason: 'exit' });
  wikiSessionEnd(dir, { session_id: 'def', reason: 'clear', hook_event_name: 'SessionEnd' });
  const logs = readFileSync(join(dir, WIKI_DIR, 'index.md'), 'utf8').match(/Session Log/g) ?? [];
  assert.equal(logs.length, 2);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('session_search: current project transcripts, filters, CLAUDE_CONFIG_DIR fallback', async () => {
  const dir = makeRepo();
  const cfg = tmp('mis-claude-');
  const proj = join(cfg, 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(proj, { recursive: true });
  const line = (sessionId, timestamp, content, cwd = dir) => JSON.stringify({ type: 'user', sessionId, timestamp, cwd, message: { role: 'user', content } });
  writeFileSync(join(proj, 's1.jsonl'), [
    line('s1', '2026-01-01T00:00:00Z', 'we fixed the flaky payment webhook retry'),
    '{not json',
    line('s1', '2026-01-02T00:00:00Z', [{ type: 'text', text: 'Payment webhook again' }]),
  ].join('\n'));
  writeFileSync(join(proj, 's2.jsonl'), line('s2', '2026-03-01T00:00:00Z', 'unrelated chatter') + '\n');
  const other = join(cfg, 'projects', '-elsewhere');
  mkdirSync(other);
  writeFileSync(join(other, 'x.jsonl'), line('x', '2026-03-02T00:00:00Z', 'payment webhook elsewhere', '/elsewhere') + '\n');

  const s = await mcpSession(dir, { MIS_STATE_HOME: tmp('mis-home-'), CLAUDE_CONFIG_DIR: cfg, MIS_CLAUDE_PROJECTS_DIR: '' });
  try {
    const r = (await s.call('session_search', { query: 'payment webhook' })).json;
    assert.equal(r.totalMatches, 2);
    assert.equal(r.results[0].sessionId, 's1');
    assert.equal(r.results[0].timestamp, '2026-01-02T00:00:00Z');
    assert.match(r.results[1].excerpt, /flaky payment webhook/);
    assert.equal((await s.call('session_search', { query: 'payment webhook', since: '2026-01-02' })).json.totalMatches, 1);
    assert.equal((await s.call('session_search', { query: 'payment webhook', project: 'all' })).json.totalMatches, 3);
    assert.equal((await s.call('session_search', { query: 'Payment', caseSensitive: true })).json.totalMatches, 1);
    assert.equal((await s.call('session_search', { query: 'payment', sessionId: 's2' })).json.totalMatches, 0);
    assert.equal((await s.call('session_search', { query: '' })).isError, true);
  } finally { s.close(); }
});

test('memory_search: observations of this project, type filter, empty query refused (2026-11-10)', async () => {
  const dir = makeRepo();
  mkdirSync(stateRoot(dir), { recursive: true });
  writeFileSync(join(stateRoot(dir), 'observations.jsonl'), [
    { id: 'a', at: '2026-11-01T00:00:00Z', type: 'change', title: 'Edited src/webhook.mjs', files: ['src/webhook.mjs'] },
    { id: 'b', at: '2026-11-02T00:00:00Z', type: 'test', title: 'Run webhook tests', cmd: 'npm test' },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n');
  const s = await session(dir);
  try {
    assert.deepEqual((await s.call('memory_search', { query: 'webhook' })).json.map((r) => r.id).sort(), ['a', 'b']);
    assert.deepEqual((await s.call('memory_search', { query: 'webhook', type: 'test' })).json.map((r) => r.id), ['b']);
    assert.equal((await s.call('memory_search', { query: ' ' })).isError, true);
  } finally { s.close(); }
});

test('trace: appendTrace writes to home; timeline/summary merge run events with hook traces', async () => {
  const home = tmp('mis-home-');
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { ok: { argv: ['node', '-e', '0'] } } } });
  const s0 = await session(dir, { MIS_STATE_HOME: home });
  try { assert.match((await s0.call('trace_timeline')).text, /no run/i); } finally { s0.close(); }

  assert.equal(mis(dir, ['start', '--input', 'x']).code, 0);
  assert.equal(mis(dir, ['check', 'ok']).code, 0);
  const prev = process.env.MIS_STATE_HOME;
  process.env.MIS_STATE_HOME = home;
  try {
    appendTrace({ cwd: dir, hook: 'PreToolUse', tool: 'Bash', decision: 'allow' });
    appendTrace({ cwd: '/somewhere/else', hook: 'Stop' });
  } finally { if (prev === undefined) delete process.env.MIS_STATE_HOME; else process.env.MIS_STATE_HOME = prev; }
  assert.ok(existsSync(join(home, 'trace.jsonl')));

  const s = await session(dir, { MIS_STATE_HOME: home });
  try {
    const tl = (await s.call('trace_timeline')).text;
    assert.match(tl, /start/);
    assert.match(tl, /check ok PASS/);
    assert.match(tl, /PreToolUse/);
    assert.doesNotMatch(tl, /Stop/);
    assert.match((await s.call('trace_timeline', { filter: 'hooks' })).text, /PreToolUse/);
    assert.doesNotMatch((await s.call('trace_timeline', { filter: 'hooks' })).text, /check ok/);
    const sum = (await s.call('trace_summary')).text;
    assert.match(sum, /State: EXECUTING|State: PLANNING/);
    assert.match(sum, /Checks: 1 PASS, 0 FAIL/);
    assert.match(sum, /PreToolUse: 1/);
  } finally { s.close(); }
});

test('deepinit_manifest: scan, check, save, diff', async () => {
  const dir = makeRepo({ 'README.md': '# x\n', 'package.json': '{}', 'src/a.ts': '', 'src/b.ts': '', 'src/lib/c.py': '', 'node_modules/z/index.js': '' });
  const s = await session(dir);
  try {
    const scan = (await s.call('deepinit_manifest', { action: 'scan' })).json;
    const src = scan.directories.find((d) => d.path === 'src');
    assert.equal(src.fileCount, 2);
    assert.deepEqual(src.languages, { TypeScript: 2 });
    assert.ok(scan.directories.find((d) => d.path === '.').keyFiles.includes('package.json'));
    assert.ok(!scan.directories.some((d) => d.path.startsWith('node_modules')));
    assert.equal((await s.call('deepinit_manifest', { action: 'check' })).json.exists, false);
    assert.equal((await s.call('deepinit_manifest', { action: 'diff' })).json.summary.added, 3);
    await s.call('deepinit_manifest', { action: 'save' });
    assert.equal((await s.call('deepinit_manifest', { action: 'check' })).json.valid, true);
    write(dir, { 'src/d.ts': '', 'docs/x.md': '' });
    const d = (await s.call('deepinit_manifest', { action: 'diff' })).json;
    const st = Object.fromEntries(d.entries.map((e) => [e.path, e.status]));
    assert.equal(st.src, 'modified');
    assert.equal(st.docs, 'added');
    assert.equal(st['.'], 'modified');
    assert.equal(st['src/lib'], 'unchanged');
    assert.equal((await s.call('deepinit_manifest', { action: 'check', mode: 'full' })).isError, true);
  } finally { s.close(); }
});

const content = (dims) => ({
  why: 'Users lose sessions.', whatChanged: 'Refresh tokens.', tradeoffs: 'No sliding window.', risksConsidered: 'Token theft.', teamUnderstanding: 'Auth owns it.',
  questions: dims.map((d, i) => ({ id: `q${i + 1}`, dimension: d, stem: `Why ${d}?`, options: [{ id: 'a', text: 'right' }, { id: 'b', text: 'wrong' }], correctOptionId: 'a' })),
});

test('merge_readiness: blocked without changes, full quiz to pass, pending restart refused, paused, cancel', async () => {
  const dir = makeRepo();
  const s = await session(dir);
  try {
    const b = await s.call('merge_readiness_start', { summary: 'nothing' });
    assert.equal(b.isError, true);
    assert.match(b.text, /blocked/i);

    write(dir, { 'src/auth.js': 'export const x = 1;\n' });
    const st = await s.call('merge_readiness_start', { summary: 'refresh tokens --quick' });
    assert.equal(st.isError, false, st.text);
    assert.match(st.text, /profile: quick/);
    assert.equal((await s.call('merge_readiness_start', { summary: 'again' })).isError, true, 'pending attempt must not be overwritten');
    assert.equal((await s.call('merge_readiness_record_answer', { questionId: 'q1', optionId: 'a' })).isError, true, 'no content yet');

    const bad = await s.call('merge_readiness_set_content', content(['why']));
    assert.equal(bad.isError, true);
    assert.match(bad.text, /change|risk/);
    assert.equal((await s.call('merge_readiness_set_content', content(['why', 'change', 'risk']))).isError, false);
    let rep = (await s.call('merge_readiness_report')).text;
    assert.doesNotMatch(rep, /_\(correct/);
    assert.match(rep, /src\/auth\.js/);
    assert.match(rep, /Passing means the human can explain the change\. It does not approve merge, replace tests, replace review, or accept risk\./);
    assert.equal((await s.call('merge_readiness_record_answer', { questionId: 'q2', optionId: 'a' })).isError, true, 'not the pending question');
    for (const q of ['q1', 'q2']) assert.equal((await s.call('merge_readiness_record_answer', { questionId: q, optionId: 'a' })).isError, false);
    const last = await s.call('merge_readiness_record_answer', { questionId: 'q3', optionId: 'a' });
    assert.match(last.text, /pass/);
    rep = (await s.call('merge_readiness_report')).text;
    assert.match(rep, /Result: pass/);
    assert.match(rep, /_\(correct, selected\)_/);

    await s.call('merge_readiness_start', { summary: 'second try --quick' });
    await s.call('merge_readiness_set_content', content(['why', 'change', 'risk']));
    for (const q of ['q1', 'q2', 'q3']) await s.call('merge_readiness_record_answer', { questionId: q, optionId: 'b' });
    rep = (await s.call('merge_readiness_report')).text;
    assert.match(rep, /Result: paused/);
    assert.match(rep, /Prior Attempts[\s\S]*Attempt 1: pass/);
    assert.equal((await s.call('merge_readiness_set_content', content(['why', 'change', 'risk']))).isError, true, 'paused needs a fresh start');

    await s.call('merge_readiness_start', { summary: 'third' });
    assert.match((await s.call('merge_readiness_cancel')).text, /cancelled/);
    assert.equal((await s.call('merge_readiness_cancel')).isError, true);
    assert.match((await s.call('merge_readiness_report')).text, /Result: cancelled/);
  } finally { s.close(); }
});

test('merge_readiness: draws on the Make It Ship run verdict', async () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { ok: { argv: ['node', '-e', 'process.exit(1)'] } } } });
  assert.equal(mis(dir, ['start', '--input', 'x']).code, 0);
  write(dir, { 'a.js': '1' });
  mis(dir, ['check', 'ok']);
  const runId = readFileSync(join(stateRoot(dir), 'current'), 'utf8').trim();
  const events = readFileSync(join(stateRoot(dir), 'runs', runId, 'events.jsonl'), 'utf8');
  const s = await session(dir);
  try {
    const st = await s.call('merge_readiness_start', { summary: 'with run --from-artifacts' });
    assert.equal(st.isError, false, st.text);
    const rep = (await s.call('merge_readiness_report')).text;
    assert.match(rep, new RegExp(`Make It Ship run ${runId}: FAILED`));
    assert.match(rep, /required check ok failed/);
  } finally { s.close(); }
  assert.equal(readFileSync(join(stateRoot(dir), 'runs', runId, 'events.jsonl'), 'utf8'), events, 'verdict is read-only');
});
