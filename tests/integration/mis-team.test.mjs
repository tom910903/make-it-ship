// M8-B team runtime: real tmux (private socket) with a fake worker command; never launches claude/codex/gemini.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ISSUE-003 (review 2026-11-10): a stale heartbeat is not a finished worker. The team folder is written by hand (no tmux):
// a heartbeat pid that is alive is a slow worker (may recover), a dead one a crashed worker (will not come back).
function fakeTeam(workers, tasks) {
  const dir = makeRepo(), id = 'fake-team';
  const td = teamDir(dir, id);
  mkdirSync(join(td, 'tasks'), { recursive: true });
  writeFileSync(join(td, 'team.json'), JSON.stringify({ id, session: 'mis-team-none', workers: workers.map((w) => ({ name: w.name })), endedAt: null }));
  tasks.forEach((st, i) => writeFileSync(join(td, 'tasks', `${i + 1}.json`), JSON.stringify({ id: String(i + 1), subject: `t${i + 1}`, status: st, owner: 'w1' })));
  for (const w of workers) {
    mkdirSync(join(td, 'workers', w.name), { recursive: true });
    if (w.beat) writeFileSync(join(td, 'workers', w.name, 'heartbeat.json'), JSON.stringify({ at: new Date(Date.now() - w.beat * 1000).toISOString(), pid: w.pid, task: null }));
    if (w.exited) writeFileSync(join(td, 'workers', w.name, 'exit.json'), '{}');
  }
  if (workers.starting) writeFileSync(join(td, 'team.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(td, 'team.json'), 'utf8')), startedAt: new Date(Date.now() - workers.starting * 1000).toISOString() }));
  return { dir, td, status: () => ok(mis(dir, ['team', 'status', '--team', id], { env })) };
}
const deadPid = () => spawnSync('true').pid;

test('team status: every worker exited → complete; done only when every task is done, failed when one failed or never finished', () => {
  const all = fakeTeam([{ name: 'w1', beat: 1, pid: deadPid(), exited: true }, { name: 'w2', beat: 1, pid: deadPid(), exited: true }], ['done', 'done']).status();
  assert.deepEqual([all.complete, all.outcome], [true, 'done']);
  const failed = fakeTeam([{ name: 'w1', beat: 1, pid: deadPid(), exited: true }], ['done', 'failed']).status();
  assert.deepEqual([failed.complete, failed.outcome], [true, 'failed']);
  const cut = fakeTeam([{ name: 'w1', beat: 1, pid: deadPid(), exited: true }], ['done', 'in_progress']).status();
  assert.deepEqual([cut.complete, cut.outcome], [true, 'failed'], 'a task left in progress is not done');
});

test('team status: a running worker or a stale but alive one keeps the team running; its heartbeat can recover', () => {
  const live = spawn('sleep', ['30']);
  try {
    const part = fakeTeam([{ name: 'w1', beat: 1, pid: deadPid(), exited: true }, { name: 'w2', beat: 1, pid: live.pid }], ['done', 'in_progress']).status();
    assert.deepEqual([part.complete, part.outcome, part.workers[1].state], [false, 'running', 'running']);
    const slow = fakeTeam([{ name: 'w1', beat: 120, pid: live.pid }, { name: 'w2', beat: 120, pid: live.pid }], ['in_progress', 'in_progress']);
    let st = slow.status();
    assert.deepEqual([st.complete, st.outcome, st.workers.map((w) => w.state)], [false, 'running', ['stale', 'stale']], 'all stale is never complete');
    for (const w of ['w1', 'w2']) writeFileSync(join(slow.td, 'workers', w, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), pid: live.pid, task: '1' }));
    st = slow.status();
    assert.deepEqual([st.complete, st.workers.map((w) => w.state)], [false, ['running', 'running']], 'heartbeat recovered');
  } finally { live.kill(); }
});

test('team status: a worker with no heartbeat a minute after start is dead (it crashed before its first beat)', () => {
  const ws = [{ name: 'w1' }]; ws.starting = 120;
  const st = fakeTeam(ws, ['pending']).status();
  assert.deepEqual([st.complete, st.outcome, st.workers[0].state], [false, 'aborted', 'dead']);
  const fresh = [{ name: 'w1' }]; fresh.starting = 5;
  assert.equal(fakeTeam(fresh, ['pending']).status().workers[0].state, 'starting');
});

test('team status/wait: crashed workers (stale heartbeat, dead pid) with unfinished tasks → aborted; wait fails at once, not complete', () => {
  const t = fakeTeam([{ name: 'w1', beat: 120, pid: deadPid() }, { name: 'w2', beat: 120, pid: deadPid() }], ['in_progress', 'pending']);
  const st = t.status();
  assert.deepEqual([st.complete, st.outcome, st.workers.map((w) => w.state)], [false, 'aborted', ['dead', 'dead']]);
  const started = Date.now();
  const w = mis(t.dir, ['team', 'wait', '--team', 'fake-team', '--timeout', '30'], { env });
  assert.equal(w.code, 1);
  assert.match(w.err, /aborted/);
  assert.ok(Date.now() - started < 10_000, 'does not wait out the timeout');
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
    assert.equal(s.worker, 'custom', 'M8 D9: a worker command override is not reported as claude');
    assert.match(s.attach, new RegExp(`tmux -L ${SOCKET} attach -t ${s.session}`));
    const panes = tmux('list-panes', '-s', '-t', s.session, '-F', '#{pane_id}');
    // Workers may already have finished and closed their panes; when the session is alive it has <= 2 panes.
    if (panes.status === 0) assert.ok(panes.stdout.trim().split('\n').length <= 2);
    const w = ok(mis(dir, ['team', 'wait', '--timeout', '60'], { env }));
    assert.equal(w.complete, true);
    assert.deepEqual(w.counts, { pending: 0, in_progress: 0, done: 4, failed: 0, stopped: 0 }, JSON.stringify(w.workers));
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
    assert.deepEqual(w.counts, { pending: 0, in_progress: 0, done: 1, failed: 1, stopped: 0 });
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
    const after = ok(mis(dir, ['team', 'status'], { env }));
    assert.ok(after.ended, 'status shows the team ended');
    assert.equal(after.workers[0].state, 'stopped', 'M8 D7: a worker killed by shutdown is not "running"');
    assert.equal(after.counts.in_progress, 0); assert.equal(after.counts.stopped, 1);
    assert.equal(after.tasks[0].status, 'stopped');
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
