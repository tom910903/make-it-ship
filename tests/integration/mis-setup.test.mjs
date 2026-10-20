// M9-A: mis setup (global settings, instruction migration, team bootstrap), mcp-setup, config, version.
// Every test runs against a temp HOME / CLAUDE_CONFIG_DIR / MIS_STATE_HOME; the real ~/.claude is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRepo, mis, ROOT, fakeHome } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const STATUSLINE = join(ROOT, 'scripts', 'statusline.mjs');

// Same layout as a real OMC-managed ~/.claude/CLAUDE.md: two marker blocks (one with an escaped `<\!--`), then the user's own text.
const OWN = '---\n\n# CLAUDE.md\nBehavioral guidelines.\n\n## CodeGraph\nUse codegraph_search.\n';
const CLAUDE_MD = `<!-- OMC:START -->\n<!-- OMC:VERSION:4.15.6 -->\n\n# oh-my-claudecode - Intelligent Multi-Agent Orchestration\nUse /oh-my-claudecode:autopilot.\n## Setup\nSay "setup omc" or run \`/oh-my-claudecode:omc-setup\`.\n\n<!-- OMC:END -->\n\n\n<\\!-- OMC:START -->\n# oh-my-claudecode - Intelligent Multi-Agent Orchestration\nstate_read, notepad_write\n<\\!-- OMC:END -->\n\n${OWN}`;

test('A1 setup: dry run prints the diff and writes nothing', () => {
  const h = fakeHome();
  writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ model: 'opus', enabledPlugins: { 'x@y': true } }, null, 2));
  writeFileSync(join(h.claude, 'CLAUDE.md'), CLAUDE_MD);
  mkdirSync(join(h.claude, 'rules'));
  writeFileSync(join(h.claude, 'rules', 'a.md'), '# Rules\nUse /oh-my-claudecode:ralph for loops.\nUse shrimp plan_task.\n');
  const before = [sha(join(h.claude, 'settings.json')), sha(join(h.claude, 'CLAUDE.md')), sha(join(h.claude, 'rules', 'a.md'))];
  const r = ok(mis(h.home, ['setup'], { env: h.env }));
  assert.equal(r.dryRun, true);
  const files = r.changes.map((c) => c.file);
  assert.deepEqual(files.sort(), [join(h.claude, 'CLAUDE.md'), join(h.claude, 'settings.json')].sort());
  const settings = r.changes.find((c) => c.file.endsWith('settings.json'));
  assert.match(settings.diff, /\+\s+"statusLine"/);
  assert.ok(settings.diff.includes(STATUSLINE), 'points at this plugin\'s status line');
  const md = r.changes.find((c) => c.file.endsWith('CLAUDE.md'));
  assert.match(md.diff, /^-# oh-my-claudecode/m);
  assert.match(md.diff, /^\+<!-- MIS:START -->/m);
  assert.deepEqual(r.review.map((x) => [x.file, x.line]), [[join(h.claude, 'rules', 'a.md'), 2]], 'only references to the removed plugins; shrimp is the user\'s call');
  assert.match(r.next, /mis setup --write/);
  assert.deepEqual([sha(join(h.claude, 'settings.json')), sha(join(h.claude, 'CLAUDE.md')), sha(join(h.claude, 'rules', 'a.md'))], before, 'nothing written');
  assert.equal(existsSync(h.state), false, 'no state written either');
});

test('A1 setup --write: applies with backups, keeps other keys and the user\'s own text, and is idempotent', () => {
  const h = fakeHome();
  writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'bash ~/my-line.sh' } }, null, 2));
  writeFileSync(join(h.claude, 'CLAUDE.md'), CLAUDE_MD);
  const w = ok(mis(h.home, ['setup', '--write'], { env: h.env }));
  assert.equal(w.dryRun, false);
  assert.ok(w.backups.length >= 2 && w.backups.every((b) => existsSync(b)));
  const s = JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8'));
  assert.equal(s.model, 'opus');
  assert.equal(s.statusLine.command, `node "${STATUSLINE}"`);
  assert.equal(JSON.parse(readFileSync(join(h.state, 'config.json'), 'utf8')).statusLine.chain, 'bash ~/my-line.sh', 'the previous status line is kept as a chain');
  const md = readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(md.replace(/<!-- MIS:START -->[\s\S]*<!-- MIS:END -->/, ''), /OMC:START|OMC:END|oh-my-claudecode/);
  assert.equal(md.match(/<!-- MIS:START -->/g).length, 1);
  assert.ok(md.endsWith(OWN), 'user text after the OMC blocks is byte-identical');
  const hashes = [sha(join(h.claude, 'settings.json')), sha(join(h.claude, 'CLAUDE.md'))];
  const again = ok(mis(h.home, ['setup', '--write'], { env: h.env }));
  assert.deepEqual(again.changes, []);
  assert.deepEqual([sha(join(h.claude, 'settings.json')), sha(join(h.claude, 'CLAUDE.md'))], hashes, 'second run changes nothing');
  assert.equal(readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8').match(/MIS:START/g).length, 1);
});

test('A1 setup: missing files are created; an unreadable settings.json is refused, not overwritten', () => {
  const h = fakeHome();
  ok(mis(h.home, ['setup', '--write'], { env: h.env }));
  assert.match(readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8'), /^<!-- MIS:START -->/);
  assert.ok(JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8')).statusLine);
  writeFileSync(join(h.claude, 'settings.json'), '{ broken');
  const r = mis(h.home, ['setup', '--write'], { env: h.env });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /settings\.json.*not valid JSON/);
  assert.equal(readFileSync(join(h.claude, 'settings.json'), 'utf8'), '{ broken');
});

test('A1 SessionStart: one status-line hint per day when no statusLine is set', () => {
  const h = fakeHome();
  const dir = makeRepo();
  const run = () => {
    const e = { ...process.env, ...h.env }; delete e.CLAUDE_CODE_SESSION_ID; delete e.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks.mjs'), 'SessionStart'], { input: JSON.stringify({ source: 'startup', cwd: dir }), encoding: 'utf8', env: e });
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  };
  assert.match(run(), /status line is not set.*mis setup/i);
  assert.doesNotMatch(run(), /status line is not set/i, 'same day: not again');
  writeFileSync(join(h.state, 'notices.json'), JSON.stringify({ statusLine: '2000-01-01' }));
  writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'x' } }));
  assert.doesNotMatch(run(), /status line is not set/i, 'set: no hint');
});

test('A1 setup team: drafts .make-it-ship.json and .gitignore; init reports the first task type', () => {
  const dir = makeRepo({ 'package.json': { name: 'x', bin: { x: 'cli.js' }, scripts: { test: 'node --test' } } });
  const h = fakeHome();
  const p = ok(mis(dir, ['setup', 'team'], { env: h.env }));
  assert.equal(p.dryRun, true);
  assert.deepEqual(p.files.map((f) => f.path).sort(), ['.gitignore', '.make-it-ship.json']);
  assert.equal(existsSync(join(dir, '.make-it-ship.json')), false);
  ok(mis(dir, ['setup', 'team', '--write'], { env: h.env }));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.make-it-ship.json'), 'utf8')).checks.unit.argv, ['npm', 'test']);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.worktrees\/$/m);
  assert.deepEqual(ok(mis(dir, ['setup', 'team', '--write'], { env: h.env })).files, [], 'nothing left to add');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8').match(/\.worktrees/g).length, 1);

  assert.equal(ok(mis(dir, ['init'], { env: h.env })).projectType, 'cli');
  const web = makeRepo({ 'package.json': { dependencies: { react: '1' }, scripts: { test: 'vitest' } } });
  assert.equal(ok(mis(web, ['init'], { env: h.env })).projectType, 'web');
  const lib = makeRepo({ 'package.json': { name: 'lib', scripts: { test: 'node --test' } } });
  const l = ok(mis(lib, ['init'], { env: h.env }));
  assert.equal(l.projectType, 'library');
  assert.match(l.firstTask, /test/i);
});

test('A3 mcp-setup: list shows known servers and where each is registered; add prints the command and runs it only with --write', () => {
  const h = fakeHome();
  const dir = makeRepo({ '.mcp.json': { mcpServers: { github: { command: 'npx' } } } });
  writeFileSync(join(h.claude, '.claude.json'), JSON.stringify({ mcpServers: { context7: { command: 'npx' } } }));
  const l = ok(mis(dir, ['mcp-setup', 'list'], { env: h.env }));
  const by = Object.fromEntries(l.servers.map((s) => [s.name, s]));
  assert.deepEqual(by.context7.registered, ['user']);
  assert.deepEqual(by.github.registered, ['project']);
  assert.deepEqual(by.filesystem.registered, []);

  const log = join(h.home, 'claude-argv');
  writeFileSync(join(h.bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`);
  chmodSync(join(h.bin, 'claude'), 0o755);
  const dry = ok(mis(dir, ['mcp-setup', 'add', 'context7'], { env: h.env }));
  assert.deepEqual(dry.argv.slice(0, 4), ['claude', 'mcp', 'add', '--scope']);
  assert.equal(dry.ran, false);
  assert.equal(existsSync(log), false);
  const run = ok(mis(dir, ['mcp-setup', 'add', 'context7', '--write'], { env: h.env }));
  assert.equal(run.ran, true);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), dry.argv.slice(1));
  const needsKey = mis(dir, ['mcp-setup', 'add', 'github', '--write'], { env: { ...h.env, GITHUB_PERSONAL_ACCESS_TOKEN: '' } });
  assert.notEqual(needsKey.code, 0);
  assert.match(needsKey.err, /GITHUB_PERSONAL_ACCESS_TOKEN/);
  assert.notEqual(mis(dir, ['mcp-setup', 'add', 'nope'], { env: h.env }).code, 0);
});

test('A5 config get|set validates keys and values; version shows plugin, node and commit', () => {
  const h = fakeHome();
  assert.equal(ok(mis(h.home, ['config', 'get', 'style.default'], { env: h.env })).value, 'full');
  ok(mis(h.home, ['config', 'set', 'style.default', 'lite'], { env: h.env }));
  ok(mis(h.home, ['config', 'set', 'keywords.disabled', '["ralph"]'], { env: h.env }));
  ok(mis(h.home, ['config', 'set', 'update.check', 'false'], { env: h.env }));
  ok(mis(h.home, ['config', 'set', 'maintenance.retainDays', '0'], { env: h.env }));
  const c = JSON.parse(readFileSync(join(h.state, 'config.json'), 'utf8'));
  assert.deepEqual([c.style.default, c.keywords.disabled, c.update.check, c.maintenance.retainDays], ['lite', ['ralph'], false, 0]);
  for (const bad of [['nope', '1'], ['style.default', 'loud'], ['keywords.disabled', 'ralph'], ['subagentMatcher', '('], ['maintenance.retainDays', '-1']]) {
    const r = mis(h.home, ['config', 'set', ...bad], { env: h.env });
    assert.equal(r.code, 1, bad.join(' '));
  }
  assert.equal(mis(h.home, ['config', 'get', 'nope'], { env: h.env }).code, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(h.state, 'config.json'), 'utf8')), c, 'invalid sets wrote nothing');
  const all = ok(mis(h.home, ['config', 'get'], { env: h.env }));
  assert.equal(all.config.style.default, 'lite');

  const v = ok(mis(h.home, ['version'], { env: h.env }));
  assert.equal(v.version, JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.equal(v.node, process.versions.node);
  assert.match(v.commit, /^[0-9a-f]{40}$/);
});
