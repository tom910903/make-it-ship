// M8-B team runtime: real tmux (private socket) with a fake worker command; never launches claude/codex/gemini.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, git, ROOT } from '../helpers.mjs';
import { workerArgv } from '../../scripts/lib/commands-team.mjs';

const HAS_TMUX = spawnSync('sh', ['-c', 'command -v tmux']).status === 0;
const SOCKET = `mis-test-${process.pid}`;
const FAKE = join(ROOT, 'tests', 'fixtures', 'fake-team-worker.mjs');
const env = { MIS_TMUX_SOCKET: SOCKET, MIS_TEAM_WORKER_CMD: `"${process.execPath}" "${FAKE}"`, TMUX: '' };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const tmux = (...a) => spawnSync('tmux', ['-L', SOCKET, ...a], { encoding: 'utf8' });
after(() => { if (HAS_TMUX) tmux('kill-server'); rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, SOCKET), { force: true }); });

const teamDir = (dir, id) => join(dir, '.git', 'make-it-ship', 'team', id);
const tasksJson = (subjects) => JSON.stringify(subjects.map((s) => ({ subject: s, description: `do ${s}` })));

test('claude workers run claude with this plugin, acceptEdits, print mode, remote writes and installs disallowed', () => {
  const argv = workerArgv('claude', 'PROMPT');
  assert.equal(argv[0], 'claude');
  assert.equal(argv[argv.indexOf('--plugin-dir') + 1], ROOT);
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.match(argv[argv.indexOf('--allowedTools') + 1], /Bash/, 'tests and commits run unattended; the guard still applies');
  for (const c of ['git push', 'gh pr', 'npm install', 'pip install']) assert.ok(argv[argv.indexOf('--disallowedTools') + 1].includes(`Bash(${c}:*)`), c);
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
  assert.deepEqual(argv.slice(-2), ['-p', 'PROMPT']);
  assert.equal(workerArgv('codex', 'P')[0], 'codex');
  assert.equal(workerArgv('gemini', 'P')[0], 'gemini');
  assert.throws(() => workerArgv('gpt', 'P'), /unknown worker/);
});

test('start without tmux reports BLOCKED and writes no team state', () => {
  const dir = makeRepo();
  const bin = mkdtempSync(join(tmpdir(), 'mis-notmux-'));
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  const r = mis(dir, ['team', 'start', '2', 'do things'], { env: { ...env, PATH: bin } });
  assert.equal(r.code, 1);
  assert.match(r.err, /BLOCKED: tmux is not installed/);
  assert.ok(!existsSync(join(dir, '.git', 'make-it-ship', 'team')));
});

test('argument validation', () => {
  const dir = makeRepo();
  assert.match(mis(dir, ['team', 'start', '0', 'x'], { env }).err, /usage/);
  assert.match(mis(dir, ['team', 'start', '2', 'x', '--worker', 'gpt'], { env }).err, /unknown worker/);
  assert.match(mis(dir, ['team', 'status'], { env }).err, /no team/);
});

if (!HAS_TMUX) {
  test('team start is BLOCKED on this machine (no tmux)', () => {
    const r = mis(makeRepo(), ['team', 'start', '2', 'x'], { env });
    assert.match(r.err, /BLOCKED: tmux is not installed/);
  });
} else {
  test('real tmux: N worker panes share a task list, each task done once, logs/heartbeats, cleanup keeps branches', () => {
    const dir = makeRepo();
    const s = ok(mis(dir, ['team', 'start', '2', 'split work', '--tasks', '-'], { env, input: tasksJson(['a', 'b', 'c', 'd']) }));
    assert.equal(s.workers.length, 2);
    assert.match(s.attach, new RegExp(`tmux -L ${SOCKET} attach -t ${s.session}`));
    const panes = tmux('list-panes', '-s', '-t', s.session, '-F', '#{pane_id}');
    // Workers may already have finished and closed their panes; when the session is alive it has <= 2 panes.
    if (panes.status === 0) assert.ok(panes.stdout.trim().split('\n').length <= 2);
    const w = ok(mis(dir, ['team', 'wait', '--timeout', '60'], { env }));
    assert.equal(w.complete, true);
    assert.deepEqual(w.counts, { pending: 0, in_progress: 0, done: 4, failed: 0 }, JSON.stringify(w.workers));
    assert.deepEqual(readdirSync(join(teamDir(dir, s.id), 'claims')).sort(), ['1', '2', '3', '4']);
    for (const t of w.tasks) assert.ok(s.workers.some((x) => x.name === t.owner), JSON.stringify(t));
    for (const x of s.workers) {
      const wd = join(teamDir(dir, s.id), 'workers', x.name);
      assert.match(readFileSync(join(wd, 'log'), 'utf8'), new RegExp(`fake worker ${x.name}`));
      assert.ok(existsSync(join(wd, 'heartbeat.json')));
      assert.equal(JSON.parse(readFileSync(join(wd, 'exit.json'), 'utf8')).state, 'exited');
    }
    const files = s.workers.flatMap((x) => git(dir, 'ls-tree', '--name-only', x.branch).split('\n')).filter((f) => f.startsWith('out-'));
    assert.deepEqual(files.sort(), ['out-1.txt', 'out-2.txt', 'out-3.txt', 'out-4.txt'], 'every task committed exactly once');
    const sd = ok(mis(dir, ['team', 'shutdown'], { env }));
    assert.equal(tmux('has-session', '-t', s.session).status === 0, false);
    for (const x of s.workers) assert.ok(!existsSync(x.worktree), 'clean worktree removed');
    assert.deepEqual(sd.branches.sort(), s.workers.map((x) => x.branch).sort(), 'branches kept for merging');
    assert.equal(git(dir, 'status', '--porcelain'), '');
  });

  test('real tmux: a failing task is reported, the team still completes', () => {
    const dir = makeRepo();
    ok(mis(dir, ['team', 'start', '1', '- ok task\n- FAIL task'], { env }));
    const w = ok(mis(dir, ['team', 'wait', '--timeout', '60'], { env }));
    assert.equal(w.complete, true);
    assert.deepEqual(w.counts, { pending: 0, in_progress: 0, done: 1, failed: 1 });
    assert.equal(w.tasks.find((t) => t.status === 'failed').exitCode, 1);
    ok(mis(dir, ['team', 'shutdown'], { env }));
  });

  test('real tmux: wait times out non-zero; shutdown kills running workers and keeps dirty worktrees', () => {
    const dir = makeRepo();
    const s = ok(mis(dir, ['team', 'start', '1', 'SLEEP forever'], { env }));
    const st = ok(mis(dir, ['team', 'status'], { env }));
    assert.equal(st.complete, false);
    const r = mis(dir, ['team', 'wait', '--timeout', '1'], { env });
    assert.equal(r.code, 1);
    assert.match(r.err, /timeout/);
    spawnSync('sh', ['-c', `echo x > "${s.workers[0].worktree}/scratch.txt"`]);
    const sd = ok(mis(dir, ['team', 'shutdown'], { env }));
    assert.equal(tmux('has-session', '-t', s.session).status === 0, false);
    assert.equal(sd.kept[0].path, s.workers[0].worktree, 'uncommitted work is never deleted');
    assert.ok(existsSync(join(s.workers[0].worktree, 'scratch.txt')));
    assert.ok(ok(mis(dir, ['team', 'status'], { env })).ended, 'status shows the team ended');
  });
}

test('atomic claim: 8 concurrent claimers on 5 tasks never double-claim and miss nothing', async () => {
  const dir = makeRepo();
  const td = join(dir, 'td');
  const mod = join(ROOT, 'scripts', 'lib', 'commands-team.mjs');
  spawnSync(process.execPath, ['--input-type=module', '-e', `import { writeTasks } from ${JSON.stringify(mod)}; writeTasks(${JSON.stringify(td)}, ${tasksJson(['1', '2', '3', '4', '5'])});`]);
  const claimer = (n) => new Promise((res) => {
    const code = `import { claimNext } from ${JSON.stringify(mod)}; const got = []; let t; while ((t = claimNext(${JSON.stringify(td)}, 'w${n}'))) got.push(t.id); console.log(JSON.stringify(got));`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', code]);
    let out = ''; p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => res(JSON.parse(out)));
  });
  const all = (await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(claimer))).flat();
  assert.deepEqual(all.sort(), ['1', '2', '3', '4', '5']);
});
