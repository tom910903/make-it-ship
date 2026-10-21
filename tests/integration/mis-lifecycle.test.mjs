// M9-A: doctor (+ --fix, session), update check / upgrade / uninstall, SessionStart maintenance, cancel --all, launch.
// Temp HOME / CLAUDE_CONFIG_DIR / MIS_STATE_HOME only; stub claude/tmux/git on PATH; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRepo, mis, ROOT, fakeHome } from '../helpers.mjs';
import { loadTools } from '../../scripts/mcp/registry.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const stateDir = (dir) => join(dir, '.git', 'make-it-ship');
const stub = (h, name, body) => { writeFileSync(join(h.bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(h.bin, name), 0o755); };
const hook = (event, input, env) => {
  const e = { ...process.env, ...env }; delete e.CLAUDE_CODE_SESSION_ID; delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks.mjs'), event], { input: JSON.stringify(input), encoding: 'utf8', env: e });
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext ?? '';
};

test('A2 doctor --json: plugin, hooks, MCP tools/list, statusLine, state dir and coding agents', async () => {
  const h = fakeHome();
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['true'] } } } });
  stub(h, 'codex', 'echo should-not-run; exit 3');
  const d = ok(mis(dir, ['doctor', '--json'], { env: h.env }));
  const by = Object.fromEntries(d.checks.map((c) => [c.name, c]));
  for (const n of ['plugin', 'hooks', 'mcp', 'statusLine', 'state', 'coding-agents']) assert.ok(by[n], n);
  assert.equal(by.hooks.status, 'ok');
  assert.equal(by.mcp.status, 'ok', by.mcp.detail);
  assert.match(by.mcp.detail, new RegExp(`with ${(await loadTools()).length} tools`));
  assert.equal(by.statusLine.status, 'warn');
  assert.equal(by.state.status, 'ok');
  assert.match(by['coding-agents'].detail, /codex/);
  assert.equal(d.ok, true);
});

test('A2 doctor --fix: wrong statusLine path, stale run lock and broken mode state go from error to ok', () => {
  const h = fakeHome();
  const dir = makeRepo();
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  const runId = readFileSync(join(stateDir(dir), 'current'), 'utf8').trim();
  writeFileSync(join(stateDir(dir), 'runs', runId, 'lock'), JSON.stringify({ pid: 2 ** 22 + 12345 }));
  mkdirSync(join(stateDir(dir), 'memory', 'modes'), { recursive: true });
  writeFileSync(join(stateDir(dir), 'memory', 'modes', 'autopilot.json'), '{ broken');
  writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ model: 'x', statusLine: { type: 'command', command: 'node "/gone/make-it-ship/0.0.1/scripts/statusline.mjs"' } }));
  const settingsBefore = readFileSync(join(h.claude, 'settings.json'), 'utf8');
  const before = ok(mis(dir, ['doctor'], { env: h.env }));
  assert.ok(before.checks.find((c) => c.name === 'statusLine').diff.includes(`+    "command": "node \\"${join(ROOT, 'scripts', 'statusline.mjs')}\\""`), 'the settings change is shown as a diff first');
  assert.equal(readFileSync(join(h.claude, 'settings.json'), 'utf8'), settingsBefore, 'plain doctor writes nothing');
  const st = (d) => Object.fromEntries(d.checks.map((c) => [c.name, c.status]));
  assert.deepEqual([st(before).statusLine, st(before)[`lock:${runId}`], st(before)['mode:autopilot']], ['error', 'error', 'error']);
  assert.equal(before.ok, false);
  assert.match(before.next, /--fix/);
  const after = ok(mis(dir, ['doctor', '--fix'], { env: h.env }));
  assert.deepEqual([st(after).statusLine, st(after)[`lock:${runId}`], st(after)['mode:autopilot']], ['ok', 'ok', 'ok']);
  assert.equal(JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8')).statusLine.command, `node "${join(ROOT, 'scripts', 'statusline.mjs')}"`);
  assert.equal(JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8')).model, 'x');
  assert.equal(existsSync(join(stateDir(dir), 'runs', runId, 'lock')), false);
  assert.ok(existsSync(join(stateDir(dir), 'memory', 'modes', 'autopilot.json.broken')), 'broken file kept aside, not deleted');
  assert.equal(ok(mis(dir, ['doctor'], { env: h.env })).checks.some((c) => c.status === 'error'), false);
});

test('A2 doctor session: active run, loop, team, freeze and recent hook errors in one view', () => {
  const h = fakeHome();
  const dir = makeRepo();
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  ok(mis(dir, ['loop', 'start', 'do it'], { env: h.env }));
  ok(mis(dir, ['freeze', '.'], { env: h.env }));
  mkdirSync(join(stateDir(dir), 'team', 't1'), { recursive: true });
  writeFileSync(join(stateDir(dir), 'team', 'latest.json'), JSON.stringify({ id: 't1' }));
  writeFileSync(join(stateDir(dir), 'team', 't1', 'team.json'), JSON.stringify({ id: 't1', session: 'mis-team-t1', workers: [] }));
  // A hook handler that throws (sessions/ is a file, so its unguarded writeSession fails) exits 0, prints nothing, and is traced.
  writeFileSync(join(h.state, 'sessions'), 'not a directory');
  const e = { ...process.env, ...h.env }; delete e.CLAUDE_CODE_SESSION_ID; delete e.NODE_TEST_CONTEXT;
  const f = spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks.mjs'), 'PostToolUseFailure'], { cwd: h.home, input: JSON.stringify({ cwd: dir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'x' } }), encoding: 'utf8', env: e });
  assert.deepEqual([f.status, f.stdout], [0, '']);
  const s = ok(mis(dir, ['doctor', 'session'], { env: h.env }));
  assert.equal(s.run.state, 'PLANNING');
  assert.equal(s.run.active, true);
  assert.equal(s.loop.active, true);
  assert.equal(s.team.id, 't1');
  assert.ok(s.freeze.dir);
  assert.deepEqual(s.hookErrors.map((x) => x.hook), ['PostToolUseFailure']);
  assert.match(s.hookErrors[0].error, /ENOTDIR|EEXIST|not a directory/i);
});

test('A6 update-check: 24h cache (second call does not read the source), --force rereads, unreachable source is silent', () => {
  const h = fakeHome();
  const src = join(h.home, 'remote-plugin.json');
  writeFileSync(src, JSON.stringify({ version: '99.0.0' }));
  const env = { ...h.env, MIS_UPDATE_SOURCE: src };
  const a = ok(mis(h.home, ['update-check'], { env }));
  assert.deepEqual([a.updateAvailable, a.latest, a.cached], [true, '99.0.0', false]);
  writeFileSync(src, JSON.stringify({ version: '100.0.0' }));
  const b = ok(mis(h.home, ['update-check'], { env }));
  assert.deepEqual([b.latest, b.cached], ['99.0.0', true], 'cached: the source is not read again');
  assert.equal(ok(mis(h.home, ['update-check', '--force'], { env })).latest, '100.0.0');
  // Backdate the cache past 24h: the next call reads the source again (no sleeping)
  const cache = JSON.parse(readFileSync(join(h.state, 'update-check.json'), 'utf8'));
  writeFileSync(join(h.state, 'update-check.json'), JSON.stringify({ ...cache, checkedAt: new Date(Date.now() - 25 * 3600e3).toISOString() }));
  writeFileSync(src, JSON.stringify({ version: '101.0.0' }));
  assert.equal(ok(mis(h.home, ['update-check'], { env })).latest, '101.0.0');

  const down = ok(mis(h.home, ['update-check', '--force'], { env: { ...h.env, MIS_UPDATE_SOURCE: 'http://127.0.0.1:9/plugin.json' } }));
  assert.equal(down.updateAvailable, false);
  assert.ok(down.error);
  ok(mis(h.home, ['config', 'set', 'update.check', 'false'], { env }));
  assert.deepEqual(ok(mis(h.home, ['update-check'], { env })), { disabled: true });
});

test('A6 SessionStart: one line only when a newer version is cached; nothing after a network failure; stale cache refreshes in the background', async () => {
  const h = fakeHome();
  const dir = makeRepo();
  const src = join(h.home, 'remote.json');
  writeFileSync(src, JSON.stringify({ version: '99.0.0' }));
  ok(mis(dir, ['update-check'], { env: { ...h.env, MIS_UPDATE_SOURCE: src } }));
  assert.match(hook('SessionStart', { source: 'startup', cwd: dir }, h.env), /Make It Ship 99\.0\.0 is available.*mis upgrade/);
  ok(mis(dir, ['update-check', '--force'], { env: { ...h.env, MIS_UPDATE_SOURCE: 'http://127.0.0.1:9/x.json' } }));
  assert.doesNotMatch(hook('SessionStart', { source: 'startup', cwd: dir }, h.env), /is available/);

  const h2 = fakeHome();
  assert.doesNotMatch(hook('SessionStart', { source: 'startup', cwd: dir }, { ...h2.env, MIS_UPDATE_SOURCE: src }), /is available/, 'never waits for the network');
  const cache = join(h2.state, 'update-check.json');
  for (let i = 0; i < 300 && !existsSync(cache); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(JSON.parse(readFileSync(cache, 'utf8')).latest, '99.0.0', 'detached refresh filled the cache');
  assert.match(hook('SessionStart', { source: 'startup', cwd: dir }, h2.env), /99\.0\.0 is available/);
});

test('A6 upgrade shows the update command and runs it only with --yes', () => {
  const h = fakeHome();
  const dry = ok(mis(h.home, ['upgrade'], { env: h.env }));
  assert.deepEqual(dry.commands, [`git -C ${ROOT} pull --ff-only`]);
  assert.equal(dry.ran, false);
  const log = join(h.home, 'git-argv');
  stub(h, 'git', `printf '%s ' "$@" > '${log}'`);
  const run = ok(mis(h.home, ['upgrade', '--yes'], { env: h.env }));
  assert.equal(run.ran, true);
  assert.equal(readFileSync(log, 'utf8').trim(), `-C ${ROOT} pull --ff-only`);
});

test('A6 uninstall: dry run lists what would go and changes nothing; --yes removes own state, keeps run records without --purge-runs', () => {
  const h = fakeHome();
  const dir = makeRepo();
  ok(mis(dir, ['setup', '--write'], { env: h.env }));
  writeFileSync(join(h.claude, 'CLAUDE.md'), readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8') + '\n# Mine\nkeep\n');
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  ok(mis(dir, ['style', 'lite'], { env: { ...h.env, CLAUDE_CODE_SESSION_ID: 's1' } }));
  const dry = ok(mis(dir, ['uninstall', '--dry-run'], { env: h.env }));
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.remove, [h.state]);
  assert.deepEqual(dry.settings.map((s) => s.file).sort(), [join(h.claude, 'CLAUDE.md'), join(h.claude, 'settings.json')]);
  assert.deepEqual(dry.keep, [stateDir(dir)]);
  assert.ok(existsSync(h.state));
  const done = ok(mis(dir, ['uninstall', '--yes'], { env: h.env }));
  assert.equal(done.dryRun, false);
  assert.equal(existsSync(h.state), false);
  assert.ok(existsSync(join(stateDir(dir), 'runs')), 'run records kept');
  assert.equal(JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8')).statusLine, undefined);
  const md = readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(md, /MIS:START/);
  assert.match(md, /# Mine\nkeep/);
  ok(mis(dir, ['uninstall', '--yes', '--purge-runs'], { env: h.env }));
  assert.equal(existsSync(stateDir(dir)), false);
  const bad = mis(dir, ['uninstall', '--yes'], { env: { ...h.env, MIS_STATE_HOME: h.home } });
  assert.notEqual(bad.code, 0, 'refuses to delete a state home that is $HOME');
  assert.ok(existsSync(h.claude));
});

test('A7 SessionStart maintenance: old finished runs, ended teams and dead browse dirs go; active run, loop and recent state stay; once a day', () => {
  const h = fakeHome();
  const dir = makeRepo();
  const sd = stateDir(dir);
  const old = (Date.now() - 200 * 864e5) / 1000;
  const mkRun = (id, state, age) => {
    mkdirSync(join(sd, 'runs', id), { recursive: true });
    writeFileSync(join(sd, 'runs', id, 'state.json'), JSON.stringify({ runId: id, state }));
    if (age) utimesSync(join(sd, 'runs', id, 'state.json'), age, age);
  };
  mkRun('old-done', 'REPORTED', old); mkRun('old-active', 'EXECUTING', old); mkRun('new-done', 'CANCELLED'); mkRun('old-current', 'REPORTED', old);
  mkdirSync(join(sd, 'runs', 'old-broken'), { recursive: true }); writeFileSync(join(sd, 'runs', 'old-broken', 'state.json'), '{'); utimesSync(join(sd, 'runs', 'old-broken', 'state.json'), old, old);
  writeFileSync(join(sd, 'current'), 'old-current');
  for (const [id, ended] of [['t-ended', true], ['t-live', false]]) {
    mkdirSync(join(sd, 'team', id), { recursive: true });
    writeFileSync(join(sd, 'team', id, 'team.json'), JSON.stringify({ id, ...(ended ? { endedAt: 'x' } : {}) }));
    utimesSync(join(sd, 'team', id, 'team.json'), old, old);
  }
  mkdirSync(join(sd, 'browse', 'b1'), { recursive: true }); writeFileSync(join(sd, 'browse', 'b1', 'state.json'), JSON.stringify({ pid: 2 ** 22 + 4321 })); utimesSync(join(sd, 'browse', 'b1'), old, old);
  writeFileSync(join(sd, 'loop.json'), JSON.stringify({ active: true, task: 't', iteration: 0, max: 3 })); utimesSync(join(sd, 'loop.json'), old, old);

  hook('SessionStart', { source: 'startup', cwd: dir }, h.env);
  const has = (p) => existsSync(join(sd, p));
  assert.deepEqual(['runs/old-done', 'team/t-ended', 'browse/b1'].map(has), [false, false, false]);
  assert.deepEqual(['runs/old-active', 'runs/new-done', 'runs/old-current', 'runs/old-broken', 'team/t-live', 'loop.json'].map(has), [true, true, true, true, true, true]);
  mkRun('old-done-2', 'REPORTED', old);
  hook('SessionStart', { source: 'startup', cwd: dir }, h.env);
  assert.ok(has('runs/old-done-2'), 'throttled to once a day');

  const h2 = fakeHome();
  ok(mis(dir, ['config', 'set', 'maintenance.retainDays', '0'], { env: h2.env }));
  hook('SessionStart', { source: 'startup', cwd: dir }, h2.env);
  assert.ok(has('runs/old-done-2'), '0 turns cleanup off');
});

test('A7 SessionStart warns in one line about an invalid .make-it-ship.json and still exits 0', () => {
  const h = fakeHome();
  const dir = makeRepo({ '.make-it-ship.json': '{"version":2,"checks":{}}' });
  const ctx = hook('SessionStart', { source: 'startup', cwd: dir }, h.env);
  assert.match(ctx, /\.make-it-ship\.json is invalid \(.*version must be 1/);
  assert.doesNotMatch(hook('SessionStart', { source: 'startup', cwd: makeRepo() }, h.env), /make-it-ship\.json is invalid/);
});

test('A8 cancel --all ends loop, team and merge-readiness; the run only with --run', () => {
  const h = fakeHome();
  const dir = makeRepo();
  stub(h, 'tmux', 'exit 0');
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  ok(mis(dir, ['loop', 'start', 'go'], { env: h.env }));
  mkdirSync(join(stateDir(dir), 'team', 't1', 'workers'), { recursive: true });
  writeFileSync(join(stateDir(dir), 'team', 'latest.json'), JSON.stringify({ id: 't1' }));
  writeFileSync(join(stateDir(dir), 'team', 't1', 'team.json'), JSON.stringify({ id: 't1', session: 'mis-team-t1', root: dir, workers: [] }));
  const mrKey = spawnSync(process.execPath, ['-e', `import('${join(ROOT, 'scripts/lib/merge-readiness.mjs')}').then(m=>console.log(m.worktreeKey(process.argv[1])))`, dir], { encoding: 'utf8' }).stdout.trim();
  mkdirSync(join(stateDir(dir), 'merge-readiness'), { recursive: true });
  writeFileSync(join(stateDir(dir), 'merge-readiness', `${mrKey}-s1.json`), JSON.stringify({ active: true, phase: 'questioning' }));

  const r = ok(mis(dir, ['cancel', '--all'], { env: h.env }));
  assert.equal(r.loop, true);
  assert.equal(r.team.id, 't1');
  assert.deepEqual(r.mergeReadiness, ['s1']);
  assert.match(r.runKept, /PLANNING/);
  assert.equal(ok(mis(dir, ['status', '--json'], { env: h.env })).state.state, 'PLANNING', 'run untouched without --run');
  assert.equal(ok(mis(dir, ['loop', 'status'], { env: h.env })).active, false);
  assert.ok(JSON.parse(readFileSync(join(stateDir(dir), 'team', 't1', 'team.json'), 'utf8')).endedAt);
  assert.equal(JSON.parse(readFileSync(join(stateDir(dir), 'merge-readiness', `${mrKey}-s1.json`), 'utf8')).result, 'cancelled');
  assert.equal(ok(mis(dir, ['cancel', '--all', '--run'], { env: h.env })).run.state, 'CANCELLED');
  assert.equal(ok(mis(makeRepo(), ['cancel', '--all'], { env: h.env })).loop, false, 'works with nothing active');
});

test('A8 launch starts claude in a tmux session and prints the attach command; BLOCKED without tmux', () => {
  const h = fakeHome();
  const dir = makeRepo();
  const log = join(h.home, 'tmux-argv');
  stub(h, 'tmux', `[ "$1" = "-V" ] && exit 0\nprintf '%s\\n' "$@" > '${log}'`);
  const r = ok(mis(dir, ['launch', '--model', 'opus'], { env: { ...h.env, CLAUDECODE: '1' } }));
  assert.match(r.session, /^mis-mis-test-[a-z0-9-]+$/);
  assert.equal(r.attach, `tmux attach -t ${r.session}`);
  const argv = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(argv.slice(0, 5), ['new-session', '-d', '-s', r.session, '-c']);
  assert.deepEqual(argv.slice(-3), ['claude', '--model', 'opus']);
  assert.ok(argv.includes('-u') && argv.includes('CLAUDECODE'), 'the new claude is not a child session');
  const noTmux = mis(dir, ['launch'], { env: { ...h.env, PATH: join(h.home, 'empty-bin') } });
  assert.notEqual(noTmux.code, 0);
  assert.match(noTmux.err, /BLOCKED: tmux/);
});
