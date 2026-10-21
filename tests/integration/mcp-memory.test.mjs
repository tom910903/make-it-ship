import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, git, mis } from '../helpers.mjs';
import { mcpSession } from '../helpers-mcp.mjs';
import { memorySessionContext, extractRemember, preCompactContext, notepadRead, writeMemoryFile } from '../../scripts/lib/memory.mjs';
import { stateRoot } from '../../scripts/lib/state.mjs';
import { writeLoop } from '../../scripts/lib/loop.mjs';

const NAMES = ['notepad_read', 'notepad_write_priority', 'notepad_write_working', 'notepad_write_manual', 'notepad_prune', 'notepad_stats',
  'project_memory_read', 'project_memory_write', 'project_memory_add_note', 'project_memory_add_directive',
  'state_read', 'state_write', 'state_clear', 'state_list_active', 'state_get_status',
  'shared_memory_read', 'shared_memory_write', 'shared_memory_list', 'shared_memory_delete', 'shared_memory_cleanup'];
const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

test('memory module registers all 20 tools with required inputs', async () => {
  const s = await mcpSession(makeRepo(), { MIS_STATE_HOME: home() });
  try {
    const tools = await s.list();
    for (const n of NAMES) assert.ok(tools.some((t) => t.name === n), n);
    assert.deepEqual(tools.find((t) => t.name === 'shared_memory_write').inputSchema.required.sort(), ['key', 'namespace', 'value']);
  } finally { s.close(); }
});

test('notepad: priority replaces, working/manual append with timestamps, prune and stats', async () => {
  const dir = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    assert.match((await s.call('notepad_read')).text, /does not exist/);
    await s.call('notepad_write_priority', { content: 'first' });
    const pr = await s.call('notepad_write_priority', { content: 'x'.repeat(600) });
    assert.match(pr.text, /exceeds 500/);
    await s.call('notepad_write_priority', { content: 'API base is /v2' });
    await s.call('notepad_write_working', { content: 'tried A, failed' });
    await s.call('notepad_write_manual', { content: 'never prune me' });
    const all = (await s.call('notepad_read')).text;
    assert.match(all, /## Priority Context\n\nAPI base is \/v2/);
    assert.doesNotMatch(all, /first/);
    assert.match(all, /### \d{4}-\d{2}-\d{2} \d{2}:\d{2}\ntried A, failed/);
    assert.match(all, /never prune me/);
    assert.match((await s.call('notepad_read', { section: 'working' })).text, /tried A/);
    assert.doesNotMatch((await s.call('notepad_read', { section: 'priority' })).text, /tried A/);
    // age one working entry past the threshold
    const np = notepadRead(dir);
    writeMemoryFile(dir, 'notepad.json', { ...np, working: [{ at: daysAgo(10), text: 'old' }, ...np.working] });
    const st = (await s.call('notepad_stats')).json;
    assert.equal(st.workingMemoryEntries, 2);
    assert.ok(st.oldestEntry < np.working[0].at);
    assert.deepEqual((await s.call('notepad_prune')).json, { pruned: 1, remaining: 1, daysOld: 7 });
    assert.match((await s.call('notepad_read', { section: 'manual' })).text, /never prune me/);
    assert.equal((await s.call('notepad_write_working', { content: '' })).isError, true);
  } finally { s.close(); }
});

test('notepad is per repo: shared across worktrees', async () => {
  const dir = makeRepo(), wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'mis-wt-'))), 'w');
  git(dir, 'worktree', 'add', '-q', wt);
  const h = home();
  const a = await mcpSession(dir, { MIS_STATE_HOME: h });
  try { await a.call('notepad_write_priority', { content: 'shared fact' }); } finally { a.close(); }
  const b = await mcpSession(wt, { MIS_STATE_HOME: h });
  try { assert.match((await b.call('notepad_read', { section: 'priority' })).text, /shared fact/); } finally { b.close(); }
});

test('project memory: auto-detect on read, merge write, notes and deduped directives', async () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test', build: 'tsc' } }), 'tsconfig.json': '{}' });
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    const m = (await s.call('project_memory_read')).json;
    assert.ok(m.techStack.languages.includes('TypeScript'));
    assert.equal(m.build.testCommand, 'npm test');
    assert.equal(m.build.buildCommand, 'npm run build');
    await s.call('project_memory_write', { memory: { conventions: { style: 'tabs' } }, merge: true });
    assert.equal((await s.call('project_memory_read')).json.build.testCommand, 'npm test');
    await s.call('project_memory_add_note', { category: 'deploy', content: 'deploy via make ship' });
    await s.call('project_memory_add_directive', { directive: 'Never edit generated files', priority: 'high' });
    await s.call('project_memory_add_directive', { directive: 'never edit generated files' });
    const d = (await s.call('project_memory_read', { section: 'directives' })).json;
    assert.equal(d.length, 1);
    assert.equal(d[0].priority, 'high');
    assert.equal((await s.call('project_memory_read', { section: 'notes' })).json[0].category, 'deploy');
    assert.deepEqual((await s.call('project_memory_read', { section: 'conventions' })).json, { style: 'tabs' });
    await s.call('project_memory_write', { memory: { custom: 1 } });
    const r = (await s.call('project_memory_read')).json;
    assert.equal(r.custom, 1);
    assert.equal(r.build, undefined); // replace, not merge
  } finally { s.close(); }
});

test('mode state: write/read/clear custom modes; built-ins are live and read-only', async () => {
  const dir = makeRepo(), h = home();
  const s = await mcpSession(dir, { MIS_STATE_HOME: h, CLAUDE_CODE_SESSION_ID: 'S' });
  try {
    assert.match((await s.call('state_read', { mode: 'ralplan' })).text, /No state/);
    await s.call('state_write', { mode: 'ralplan', active: true, iteration: 2, current_phase: 'critic', state: { extra: 'y', active: false } });
    const r = (await s.call('state_read', { mode: 'ralplan' })).json;
    assert.equal(r.active, true); // explicit params win over `state`
    assert.equal(r.extra, 'y');
    assert.equal(r._meta.mode, 'ralplan');
    assert.ok((await s.call('state_list_active')).json.some((m) => m.mode === 'ralplan'));

    for (const mode of ['run', 'loop', 'style', 'freeze']) {
      assert.equal((await s.call('state_write', { mode, active: true })).isError, true, mode);
      assert.equal((await s.call('state_clear', { mode })).isError, true, mode);
    }
    for (const mode of ['../runs/x', '../current', '.hidden', 'a/b', 'x..y']) {
      assert.equal((await s.call('state_write', { mode, active: true })).isError, true, mode);
      assert.equal((await s.call('state_read', { mode })).isError, true, mode);
    }
    const root = stateRoot(dir);
    assert.equal(existsSync(join(root, 'runs')), false);
    assert.equal(existsSync(join(root, 'current')), false);

    // built-ins: run, loop, freeze, style
    assert.equal(mis(dir, ['start', '--input', 'demo task'], { env: { MIS_STATE_HOME: h } }).code, 0);
    writeLoop(dir, { active: true, task: 't', iteration: 1, max: 5 });
    write(h, { 'freeze.json': { dir: join(dir, 'src') }, 'sessions/S.json': { style: 'ultra' } });
    const active = (await s.call('state_list_active')).json;
    const by = Object.fromEntries(active.map((m) => [m.mode, m]));
    assert.equal(by.run.state, 'PLANNING');
    assert.match(by.run.id, /^\d{8}-\d{4}-/);
    assert.equal(by.loop.iteration, 1);
    assert.equal(by.freeze.dir, join(dir, 'src'));
    assert.equal(by.style.level, 'ultra');
    assert.equal((await s.call('state_read', { mode: 'run' })).json.state, 'PLANNING');
    const st = (await s.call('state_get_status')).json;
    assert.ok(st.some((m) => m.mode === 'run' && m.builtin && m.active));
    assert.ok(st.some((m) => m.mode === 'ralplan' && !m.builtin));
    assert.equal((await s.call('state_get_status', { mode: 'loop' })).json.active, true);

    assert.equal((await s.call('state_clear', { mode: 'ralplan' })).json.cleared, true);
    assert.ok(!(await s.call('state_list_active')).json.some((m) => m.mode === 'ralplan'));
  } finally { s.close(); }
});

test('shared memory: namespaced keys, TTL expiry, list, delete, cleanup', async () => {
  const dir = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    await s.call('shared_memory_write', { namespace: 'team-1', key: 'plan', value: { steps: [1, 2] } });
    await s.call('shared_memory_write', { namespace: 'team-1', key: 'tmp', value: 'soon gone', ttl: 60 });
    const e = (await s.call('shared_memory_read', { namespace: 'team-1', key: 'plan' })).json;
    assert.deepEqual(e.value, { steps: [1, 2] });
    assert.deepEqual((await s.call('shared_memory_list')).json, ['team-1']);
    assert.deepEqual((await s.call('shared_memory_list', { namespace: 'team-1' })).json.map((x) => x.key), ['plan', 'tmp']);
    // expire `tmp` by rewriting its file
    const f = join(stateRoot(dir), 'memory', 'shared', 'team-1', 'tmp.json');
    writeMemoryFile(dir, 'shared/team-1/tmp.json', { key: 'tmp', namespace: 'team-1', value: 1, expiresAt: daysAgo(1) });
    assert.ok(existsSync(f));
    assert.deepEqual((await s.call('shared_memory_cleanup')).json, { removed: 1, namespaces: ['team-1'] });
    assert.match((await s.call('shared_memory_read', { namespace: 'team-1', key: 'tmp' })).text, /not found/);
    assert.equal((await s.call('shared_memory_delete', { namespace: 'team-1', key: 'plan' })).json.deleted, true);
    assert.equal((await s.call('shared_memory_delete', { namespace: 'team-1', key: 'plan' })).json.deleted, false);
    assert.equal((await s.call('shared_memory_write', { namespace: '..', key: 'k', value: 1 })).isError, true);
    assert.equal((await s.call('shared_memory_write', { namespace: 'n', key: '../x', value: 1 })).isError, true);
    assert.equal((await s.call('shared_memory_write', { namespace: 'n', key: 'k', value: 1, ttl: 0 })).isError, true);
  } finally { s.close(); }
});

test('hook helpers: remember tags, session context, precompact context', () => {
  const dir = makeRepo(), h = home();
  process.env.MIS_STATE_HOME = h;
  try {
    assert.equal(memorySessionContext(dir), '');
    assert.equal(preCompactContext(dir), '');
    const n = extractRemember('a <remember>uses pnpm</remember> b <remember priority>prod DB is read-only</remember> <REMEMBER>  </REMEMBER>', dir);
    assert.equal(n, 2);
    const np = notepadRead(dir);
    assert.equal(np.priority.text, 'prod DB is read-only');
    assert.deepEqual(np.working.map((w) => w.text), ['uses pnpm']);
    assert.equal(extractRemember('nothing here', dir), 0);

    writeMemoryFile(dir, 'project.json', { userDirectives: [{ directive: 'Always run lint', priority: 'high' }], techStack: { languages: ['Go'] }, build: { testCommand: 'go test ./...' } });
    const sc = memorySessionContext(dir);
    assert.match(sc, /prod DB is read-only/);
    assert.match(sc, /Always run lint/);
    assert.match(sc, /go test \.\/\.\.\./);
    assert.doesNotMatch(sc, /uses pnpm/); // working memory is not injected

    assert.equal(mis(dir, ['start', '--input', 'demo'], { env: { MIS_STATE_HOME: h } }).code, 0);
    writeLoop(dir, { active: true, task: 'ship it', iteration: 3, max: 9 });
    const pc = preCompactContext(dir);
    assert.match(pc, /prod DB is read-only/);
    assert.match(pc, /Always run lint/);
    assert.match(pc, /run \d{8}-\d{4}-\w+ .*PLANNING/);
    assert.match(pc, /loop.*ship it.*3\/9/);
  } finally { delete process.env.MIS_STATE_HOME; }
});

test('hook helpers fail open outside a git repo', () => {
  const plain = mkdtempSync(join(tmpdir(), 'mis-plain-'));
  process.env.MIS_STATE_HOME = home();
  try {
    assert.equal(memorySessionContext(plain), '');
    assert.equal(preCompactContext(plain), '');
    assert.equal(extractRemember('<remember>x</remember>', plain), 1);
    assert.equal(readdirSync(plain).length, 0); // stored under the per-user home, not in the folder
  } finally { delete process.env.MIS_STATE_HOME; }
});
