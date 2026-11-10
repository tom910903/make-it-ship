// Global memory store, cross-project search, claude-mem import (user decisions 2026-11-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, git, mis } from '../helpers.mjs';
import { normalizeRemote, projectKey, projectDir, memoryRoot, readMeta } from '../../scripts/lib/memstore.mjs';
import { obsFile, readObservations } from '../../scripts/lib/observe.mjs';
import { importClaudeMem } from '../../scripts/lib/claude-mem-import.mjs';
import { readMemories, readSummaries } from '../../scripts/lib/summarize.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const withHome = (fn) => { const old = process.env.MIS_STATE_HOME; process.env.MIS_STATE_HOME = tmp('mis-home-'); try { return fn(process.env.MIS_STATE_HOME); } finally { process.env.MIS_STATE_HOME = old; } };

test('normalizeRemote: one repository in every URL form, never its credentials', () => {
  for (const u of ['git@github.com:Tom/Make-It-Ship.git', 'https://u:ghp_secret123@github.com/Tom/Make-It-Ship.git', 'ssh://git@github.com:22/Tom/Make-It-Ship', 'https://github.com/Tom/Make-It-Ship/', 'https://tok@github.com/Tom/Make-It-Ship.git?x=1'])
    assert.equal(normalizeRemote(u), 'github.com/tom/make-it-ship', u);
});

test('projectKey: clones of one remote share a key and folder; no remote → main worktree path; credentials never stored', () => withHome(() => {
  const a = makeRepo(), b = makeRepo(), c = makeRepo();
  git(a, 'remote', 'add', 'origin', 'https://me:ghp_tok123456@github.com/Org/App.git');
  git(b, 'remote', 'add', 'origin', 'git@github.com:org/app.git');
  assert.deepEqual(projectKey(a), { key: 'github.com/org/app', name: 'app' });
  assert.equal(projectDir(a), projectDir(b));
  assert.notEqual(projectDir(a), projectDir(c));
  assert.equal(projectKey(join(a)).name, 'app');
  mkdirSync(join(c, 'sub'));
  assert.equal(projectDir(join(c, 'sub')), projectDir(c), 'a subfolder is the same project');
  const all = readdirSync(join(memoryRoot(), 'projects')).map((d) => readFileSync(join(memoryRoot(), 'projects', d, 'meta.json'), 'utf8')).join('');
  assert.doesNotMatch(all, /ghp_tok|me:/);
  const plain = tmp('mis-plain-');
  assert.equal(projectKey(plain).name, plain.split('/').pop());
}));

test('projectDir: the 0.6.0 per-repository files move into the global folder once', () => withHome(() => {
  const dir = makeRepo();
  const old = join(dir, '.git', 'make-it-ship');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'observations.jsonl'), JSON.stringify({ id: 'x', at: '2026-11-10T00:00:00Z', type: 'change', title: 'Edited a' }) + '\n');
  writeFileSync(join(old, 'memories.jsonl'), JSON.stringify({ id: 1, at: '2026-11-10T00:00:00Z', type: 'feature', title: 'Old memory' }) + '\n');
  assert.equal(readObservations(dir)[0].title, 'Edited a');
  assert.equal(readMemories(dir)[0].title, 'Old memory');
  assert.ok(!existsSync(join(old, 'observations.jsonl')));
  assert.ok(obsFile(dir).startsWith(memoryRoot()));
}));

// A claude-mem database built with node:sqlite, the same tables and columns as claude-mem 10.6.2.
async function claudeMemDb() {
  const { DatabaseSync } = await import('node:sqlite');
  const f = join(tmp('mis-cm-'), 'claude-mem.db'), db = new DatabaseSync(f);
  db.exec(`CREATE TABLE observations (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, text TEXT, type TEXT, title TEXT, subtitle TEXT, facts TEXT, narrative TEXT, concepts TEXT, files_read TEXT, files_modified TEXT, prompt_number INTEGER, discovery_tokens INTEGER, created_at TEXT, created_at_epoch INTEGER, content_hash TEXT);
    CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT, files_read TEXT, files_edited TEXT, notes TEXT, prompt_number INTEGER, discovery_tokens INTEGER, created_at TEXT, created_at_epoch INTEGER);`);
  const o = db.prepare('INSERT INTO observations (id, memory_session_id, project, type, title, subtitle, facts, narrative, concepts, files_read, files_modified, discovery_tokens, created_at_epoch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  o.run(4939, 'm1', 'app', 'discovery', 'Pie syntax\n### fake header', 'sub', '["f1","token=abcdefghijklmnop1234"]', 'narr', '["parsing"]', '["a.mjs"]', '["b.mjs"]', 1200, Date.parse('2026-11-04T04:51:00Z'));
  o.run(4940, 'm1', 'app', 'bugfix', 'Meta refresh blocked', null, 'not json', null, null, null, null, 0, Date.parse('2026-11-04T04:52:00Z'));
  o.run(5000, 'm2', 'other', 'feature', 'Other project thing', null, '[]', null, '[]', '[]', '[]', 10, Date.parse('2026-11-05T00:00:00Z'));
  db.prepare('INSERT INTO session_summaries (id, memory_session_id, project, request, learned, created_at_epoch) VALUES (?,?,?,?,?,?)').run(1913, 'm1', 'app', 'Harden docs', 'CSP blocks scripts', Date.parse('2026-11-04T05:00:00Z'));
  db.close();
  return f;
}

test('importClaudeMem: this project by folder name, masked one-line text, prefixed ids, once; --all files the rest under their names', async () => {
  const f = await claudeMemDb();
  const home = tmp('mis-home-'), old = process.env.MIS_STATE_HOME;
  process.env.MIS_STATE_HOME = home;
  try {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'git@github.com:org/app.git');
    assert.deepEqual(await importClaudeMem(dir, { dbPath: f }), { project: 'app', observations: 2, summaries: 1 });
    const mem = readMemories(dir);
    assert.deepEqual(mem.map((m) => m.id), ['cm4939', 'cm4940']);
    assert.deepEqual([mem[0].at, mem[0].work, mem[0].files, mem[0].concepts], ['2026-11-04T04:51:00.000Z', 1200, ['a.mjs', 'b.mjs'], ['parsing']]);
    assert.doesNotMatch(JSON.stringify(mem), /\\n|abcdefghijklmnop1234/);
    assert.deepEqual(mem[1].facts, []);
    assert.deepEqual(readSummaries(dir).map((s) => [s.id, s.request, s.learned]), [['cmS1913', 'Harden docs', 'CSP blocks scripts']]);
    assert.equal(readMeta(projectDir(dir)).claudeMem.observations, 2);
    assert.deepEqual(await importClaudeMem(dir, { dbPath: f }), { project: 'app', observations: 0, summaries: 0 }, 'a second run adds nothing');
    const all = await importClaudeMem(dir, { dbPath: f, all: true });
    assert.deepEqual(all.projects.map((p) => [p.project, p.observations]).sort(), [['app', 0], ['other', 1]]);
    const s = mis(dir, ['memory', 'search', 'project', 'thing', '--all'], { env: { MIS_STATE_HOME: home } });
    assert.equal(s.code, 0, s.err);
    assert.deepEqual(s.json.map((r) => [r.id, r.project]), [['cm5000', 'other']]);
    assert.deepEqual(mis(dir, ['memory', 'search', 'thing'], { env: { MIS_STATE_HOME: home } }).json, [], 'without --all only this project');
    assert.match(mis(dir, ['memory', 'projects'], { env: { MIS_STATE_HOME: home } }).out, /app[\s\S]*other/);
    const missing = await importClaudeMem(makeRepo(), { dbPath: '/nonexistent.db' });
    assert.match(missing.error, /no claude-mem database/);
  } finally { process.env.MIS_STATE_HOME = old; }
});

test('SessionStart imports this project\'s claude-mem history once in the background; memory.importClaudeMem false skips it', async () => {
  const { spawnSync } = await import('node:child_process');
  const { ROOT } = await import('../helpers.mjs');
  const f = await claudeMemDb();
  const start = (dir, home) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks.mjs'), 'SessionStart'], { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: dir, source: 'startup' }), encoding: 'utf8', env: { ...process.env, MIS_STATE_HOME: home, MIS_CLAUDE_MEM_DB: f } });
  const dir = makeRepo();
  git(dir, 'remote', 'add', 'origin', 'git@github.com:org/app.git');
  const home = tmp('mis-home-');
  assert.equal(start(dir, home).status, 0);
  const mem = () => { const old = process.env.MIS_STATE_HOME; process.env.MIS_STATE_HOME = home; try { return readMemories(dir); } finally { process.env.MIS_STATE_HOME = old; } };
  for (let i = 0; i < 80 && mem().length < 2; i++) spawnSync('sleep', ['0.1']);
  assert.deepEqual(mem().map((m) => m.id), ['cm4939', 'cm4940']);
  assert.match(start(dir, home).stdout, /cm4940 .*Meta refresh blocked/, 'the next session shows them');
  const off = tmp('mis-home-');
  writeFileSync(join(off, 'config.json'), JSON.stringify({ memory: { importClaudeMem: false } }));
  start(dir, off);
  spawnSync('sleep', ['1']);
  const old = process.env.MIS_STATE_HOME; process.env.MIS_STATE_HOME = off;
  try { assert.deepEqual(readMemories(dir), []); } finally { process.env.MIS_STATE_HOME = old; }
});

