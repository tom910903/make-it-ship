// mis commands of M8-B: team runtime (tmux workers on a shared task list), project sessions, visual companion.
// Absorbs OMC team/omc-teams CLI runtime and project-session-manager, Superpowers' brainstorming visual companion
// (own implementations; see THIRD_PARTY_NOTICES.md). State lives in <git-common-dir>/make-it-ship/{team,companion*}.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './tree-hash.mjs';
import { stateRoot, newRunId, pidAlive } from './state.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const MIS = join(PLUGIN_ROOT, 'scripts', 'mis.mjs');
const SERVER = join(PLUGIN_ROOT, 'scripts', 'lib', 'companion-server.mjs');
const WORKERS = ['claude', 'codex', 'gemini'];
const HEARTBEAT_MS = 5000, STALE_MS = 30_000;
// The lead's Claude Code session vars leak into tmux panes; a worker must be its own session, not a nested child.
export const SESSION_VARS = /^(CLAUDECODE|CLAUDE_CODE_(SESSION_ID|ENTRYPOINT|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+|EXECPATH)|CLAUDE_PID|CMUX_CLAUDE_PID)$/;

const fail = (msg) => { throw new Error(msg); };
const gitOut = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitTry = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
function writeJson(p, v) { const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 2)); renameSync(tmp, p); }
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function flag(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  if (args[i].includes('=')) return args.splice(i, 1)[0].split('=').slice(1).join('=');
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

// ---------------------------------------------------------------- tmux

const tmuxArgs = (a) => (process.env.MIS_TMUX_SOCKET ? ['-L', process.env.MIS_TMUX_SOCKET, ...a] : a);
export const tmux = (...a) => spawnSync('tmux', tmuxArgs(a), { encoding: 'utf8' });
export function requireTmux(alt = 'run the team with Claude Code subagents (Agent tool) instead') {
  if (tmux('-V').error) fail(`BLOCKED: tmux is not installed (command -v tmux failed). Install tmux, or ${alt}.`);
}
export const attachHint = (s) => `tmux ${process.env.MIS_TMUX_SOCKET ? `-L ${process.env.MIS_TMUX_SOCKET} ` : ''}attach -t ${s}`;

/** Keep `.worktrees/` out of `git status` (local exclude, never a tracked .gitignore change). */
export function excludeWorktrees(root) {
  const exclude = join(resolve(root, gitOut(root, 'rev-parse', '--git-common-dir')), 'info', 'exclude');
  mkdirSync(join(exclude, '..'), { recursive: true });
  const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!cur.split('\n').includes('.worktrees/')) writeFileSync(exclude, `${cur ? cur.replace(/\n?$/, '\n') : ''}.worktrees/\n`);
}

// ---------------------------------------------------------------- team: shared task list

// Remote writes and installs stay with the lead: explicit deny rules (documented to win over allow rules), because
// what a hook "ask" does in print mode with no one to answer is not documented.
const WORKER_DENY = ['git push', 'gh pr', 'gh release', 'npm install', 'npm i', 'npm add', 'pnpm add', 'pnpm install', 'yarn add', 'pip install', 'pip3 install', 'brew install', 'cargo add']
  .map((c) => `Bash(${c}:*)`).join(',');

/**
 * argv for a real worker. Claude: this plugin (guard + hooks), file tools and Bash pre-allowed so tests and commits run
 * unattended, remote writes/installs denied, print mode (no --dangerously-skip-permissions).
 */
export function workerArgv(kind, prompt) {
  if (kind === 'claude') return ['claude', '--plugin-dir', PLUGIN_ROOT, '--allowedTools', 'Bash,Read,Edit,Write,Grep,Glob', '--disallowedTools', WORKER_DENY, '--permission-mode', 'acceptEdits', '-p', prompt];
  if (kind === 'codex') return ['codex', 'exec', '--full-auto', prompt];
  if (kind === 'gemini') return ['gemini', '--yolo', '-p', prompt];
  return fail(`unknown worker "${kind}" (claude|codex|gemini)`);
}

export function writeTasks(dir, tasks) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'claims'), { recursive: true });
  tasks.forEach((t, i) => writeJson(join(dir, 'tasks', `${i + 1}.json`), { id: String(i + 1), subject: t.subject, description: t.description ?? t.subject, status: 'pending', owner: null }));
}

const listTasks = (dir) => readdirSync(join(dir, 'tasks')).filter((f) => /^\d+\.json$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b)).map((f) => readJson(join(dir, 'tasks', f)));

/** Atomic claim: the claim file is created with O_EXCL, so exactly one worker wins each task. */
export function claimNext(dir, worker) {
  for (const t of listTasks(dir)) {
    if (t.status !== 'pending') continue;
    let fd;
    try { fd = openSync(join(dir, 'claims', t.id), 'wx'); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    writeSync(fd, worker);
    closeSync(fd);
    const claimed = { ...t, status: 'in_progress', owner: worker, startedAt: new Date().toISOString() };
    writeJson(join(dir, 'tasks', `${t.id}.json`), claimed);
    return claimed;
  }
  return null;
}

function teamRoot(cwd) { return join(stateRoot(cwd), 'team'); }
function teamDir(cwd, args) {
  const id = flag(args, '--team') ?? readJson(join(teamRoot(cwd), 'latest.json'))?.id;
  if (!id) fail('no team (start one with `mis team start <N> "<task>"`)');
  if (!/^[a-z0-9-]+$/.test(id)) fail(`invalid team id ${id}`);
  const dir = join(teamRoot(cwd), id);
  if (!existsSync(join(dir, 'team.json'))) fail(`no team ${id}`);
  return dir;
}

function taskPrompt(team, w, t) {
  return [
    `You are worker ${w.name} of Make It Ship team ${team.id}. Work only on the task below, in this git worktree: ${w.worktree} (branch ${w.branch}).`,
    '', `Task ${t.id}: ${t.subject}`, '', t.description, '',
    ...(team.goal ? [`Team goal (context only; other workers own the other parts): ${team.goal}`, ''] : []),
    'Rules:',
    '- Write a failing test first where behavior changes; run the relevant tests before you finish.',
    '- Commit your work on this branch (git add + git commit) before you finish. Uncommitted work is not merged.',
    '- Do not push, open pull requests, or touch other worktrees; the lead merges your branch.',
    '- End with a short summary: what you changed, which commands you ran and their result. If you could not finish, say why.',
  ].join('\n');
}

async function start(args, cwd) {
  const worker = flag(args, '--worker') ?? 'claude';
  const tasksArg = flag(args, '--tasks');
  const [nArg, ...rest] = args;
  const n = Number(nArg), goal = rest.join(' ').trim();
  if (!Number.isInteger(n) || n < 1 || n > 10 || !goal) fail('usage: mis team start <N 1-10> "<task>" [--worker claude|codex|gemini] [--tasks <json-file|->]');
  workerArgv(worker, '');
  const override = process.env.MIS_TEAM_WORKER_CMD;
  requireTmux();
  if (!override && spawnSync('sh', ['-c', `command -v ${worker}`]).status !== 0) fail(`BLOCKED: the ${worker} CLI is not installed`);
  const root = repoRoot(cwd);
  let tasks;
  if (tasksArg) tasks = JSON.parse(tasksArg === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, tasksArg), 'utf8'));
  else {
    const items = goal.split('\n').map((l) => l.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/)?.[1]).filter(Boolean);
    tasks = (items.length ? items : [goal]).map((s) => ({ subject: s, description: s }));
  }
  if (!Array.isArray(tasks) || !tasks.length || tasks.some((t) => !t?.subject)) fail('tasks must be a non-empty array of {subject, description}');
  const id = newRunId().toLowerCase();
  const dir = join(teamRoot(cwd), id);
  writeTasks(dir, tasks);
  excludeWorktrees(root);
  const base = gitOut(root, 'rev-parse', 'HEAD');
  const workers = Array.from({ length: Math.min(n, tasks.length) }, (_, k) => {
    const name = `w${k + 1}`, worktree = join(root, '.worktrees', `team-${id}-${name}`), branch = `mis/team/${id}/${name}`;
    gitOut(root, 'worktree', 'add', '-q', '-b', branch, worktree, base);
    mkdirSync(join(dir, 'workers', name), { recursive: true });
    return { name, worktree, branch };
  });
  const session = `mis-team-${id}`;
  const team = { id, session, socket: process.env.MIS_TMUX_SOCKET ?? null, root, base, worker, workerCmd: override ?? null,
    goal: tasksArg ? goal : null, workers, startedAt: new Date().toISOString(), endedAt: null };
  writeJson(join(dir, 'team.json'), team);
  writeJson(join(teamRoot(cwd), 'latest.json'), { id });
  const paneCmd = (w) => `${sq(process.execPath)} ${sq(MIS)} team _worker ${id} ${w.name}`;
  const steps = [['new-session', '-d', '-s', session, '-x', '240', '-y', '60', '-c', workers[0].worktree, paneCmd(workers[0])],
    ['set-option', '-t', session, 'remain-on-exit', 'on']];
  for (const w of workers.slice(1)) steps.push(['split-window', '-t', session, '-c', w.worktree, paneCmd(w)], ['select-layout', '-t', session, 'tiled']);
  for (const s of steps) {
    const r = tmux(...s);
    if (r.status !== 0) { tmux('kill-session', '-t', session); fail(`tmux ${s[0]} failed: ${r.stderr.trim()}`); }
  }
  writeFileSync(join(dir, 'ready'), ''); // workers wait for this, so no pane exits before the layout exists
  return { id, session, worker, tasks: tasks.length, workers, attach: attachHint(session),
    ...(gitOut(root, 'status', '--porcelain') ? { note: 'the main tree has uncommitted changes; workers start from HEAD and do not see them' } : {}) };
}

/** Pane process: wait for the layout, then claim → run the worker command → record, until no task is left. */
async function runWorker([id, name], cwd) {
  const dir = join(teamRoot(cwd), id);
  const team = readJson(join(dir, 'team.json'));
  const w = team?.workers.find((x) => x.name === name) ?? fail(`no worker ${name} in team ${id}`);
  const wd = join(dir, 'workers', name);
  const log = openSync(join(wd, 'log'), 'a');
  for (let i = 0; i < 100 && !existsSync(join(dir, 'ready')); i++) await sleep(100);
  let current = null;
  const beat = () => writeJson(join(wd, 'heartbeat.json'), { at: new Date().toISOString(), pid: process.pid, task: current });
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  let t;
  while (!existsSync(join(dir, 'shutdown')) && (t = claimNext(dir, name))) {
    current = t.id; beat();
    const taskFile = join(dir, 'tasks', `${t.id}.json`), promptFile = join(dir, 'tasks', `${t.id}.prompt.md`);
    const prompt = taskPrompt(team, w, t);
    writeFileSync(promptFile, prompt);
    writeSync(log, `\n== task ${t.id}: ${t.subject}\n`);
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k))), MIS_TEAM_ID: id, MIS_WORKER: name, MIS_TASK_ID: t.id, MIS_TASK_FILE: taskFile, MIS_TASK_PROMPT_FILE: promptFile, MIS_PLUGIN_ROOT: PLUGIN_ROOT };
    const [cmd, ...argv] = team.workerCmd ? ['sh', '-c', team.workerCmd] : workerArgv(team.worker, prompt);
    const code = await new Promise((res) => {
      const p = spawn(cmd, argv, { cwd: w.worktree, env, stdio: ['ignore', log, log] });
      p.on('error', (e) => { writeSync(log, `${e.message}\n`); res(127); });
      p.on('close', (c) => res(c ?? 1));
    });
    writeJson(taskFile, { ...readJson(taskFile), status: code === 0 ? 'done' : 'failed', exitCode: code, endedAt: new Date().toISOString() });
    writeSync(log, `== task ${t.id} exit ${code}\n`);
    current = null;
  }
  clearInterval(timer);
  beat();
  writeJson(join(wd, 'exit.json'), { state: 'exited', at: new Date().toISOString() });
  closeSync(log);
}

function status(dir) {
  const team = readJson(join(dir, 'team.json'));
  const tasks = listTasks(dir);
  const counts = { pending: 0, in_progress: 0, done: 0, failed: 0 };
  for (const t of tasks) counts[t.status]++;
  const alive = tmux('has-session', '-t', team.session).status === 0;
  const workers = team.workers.map((w) => {
    const hb = readJson(join(dir, 'workers', w.name, 'heartbeat.json'));
    const age = hb ? Date.now() - Date.parse(hb.at) : null;
    // Liveness comes from the heartbeat, not from has-session (which can fail transiently under load).
    const state = existsSync(join(dir, 'workers', w.name, 'exit.json')) ? 'exited' : !hb ? 'starting' : age > STALE_MS ? 'stale' : 'running';
    return { ...w, state, task: hb?.task ?? null, heartbeatAgeSec: age === null ? null : Math.round(age / 1000), log: join(dir, 'workers', w.name, 'log') };
  });
  // Complete = every worker process is gone (drivers exit as soon as no task is left), so merging can start.
  // shortcut: a stale worker's in_progress task is reported, not re-queued; re-run it in a new team if needed.
  const complete = Boolean(team.endedAt) || workers.every((w) => w.state === 'exited' || w.state === 'stale');
  return { id: team.id, session: team.session, worker: team.worker, ended: team.endedAt, alive, complete, counts,
    tasks: tasks.map(({ id, subject, status: s, owner, exitCode }) => ({ id, subject, status: s, owner, exitCode })), workers };
}

async function wait(args, cwd) {
  const timeout = Number(flag(args, '--timeout') ?? 600);
  const dir = teamDir(cwd, args);
  const until = Date.now() + timeout * 1000;
  for (;;) {
    const s = status(dir);
    if (s.complete) return s;
    if (Date.now() > until) fail(`timeout after ${timeout}s: ${JSON.stringify(s.counts)} (mis team status; mis team shutdown to stop)`);
    await sleep(300);
  }
}

function shutdown(args, cwd) {
  const dir = teamDir(cwd, args);
  const team = readJson(join(dir, 'team.json'));
  writeFileSync(join(dir, 'shutdown'), '');
  const killed = tmux('kill-session', '-t', team.session).status === 0;
  const removed = [], kept = [];
  for (const w of team.workers) {
    if (!existsSync(w.worktree)) continue;
    const r = gitTry(team.root, 'worktree', 'remove', w.worktree); // never --force: uncommitted work stays
    if (r.status === 0) removed.push(w.worktree);
    else kept.push({ path: w.worktree, reason: r.stderr.trim() || 'git worktree remove failed' });
  }
  writeJson(join(dir, 'team.json'), { ...team, endedAt: new Date().toISOString() });
  return { id: team.id, killed, removed, kept, branches: team.workers.map((w) => w.branch),
    next: 'review and merge the worker branches (git log/diff <branch>, git merge --no-ff <branch>), then run the checks' };
}

async function team([sub, ...args], cwd) {
  if (sub === 'start') return start(args, cwd);
  if (sub === 'status') return status(teamDir(cwd, args));
  if (sub === 'wait') return wait(args, cwd);
  if (sub === 'shutdown') return shutdown(args, cwd);
  if (sub === '_worker') return runWorker(args, cwd);
  return fail('usage: mis team start <N> "<task>" [--worker claude|codex|gemini] [--tasks <file|->] | status | wait [--timeout s] | shutdown  [--team <id>]');
}

// ---------------------------------------------------------------- project sessions (psm)

function sessionList(root) {
  const out = [];
  for (const block of gitOut(root, 'worktree', 'list', '--porcelain').split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path?.startsWith(join(root, '.worktrees') + '/') || !/^(issue|pr|feat)-/.test(basename(path))) continue;
    const name = basename(path);
    out.push({ name, kind: { issue: 'issue', pr: 'pr', feat: 'feature' }[name.split('-')[0]], path,
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null, dirty: existsSync(path) && gitOut(path, 'status', '--porcelain') !== '',
      tmux: tmux('has-session', '-t', `mis-${name}`).status === 0 ? `mis-${name}` : null });
  }
  return out;
}

function session([sub, ...args], cwd) {
  const root = repoRoot(cwd);
  if (sub === 'list') return sessionList(root);
  if (sub === 'remove') {
    const s = sessionList(root).find((x) => x.name === args[0]) ?? fail(`no session ${args[0]} (mis session list)`);
    if (s.dirty) fail(`${s.path} has uncommitted changes; commit or stash them first (nothing was removed)`);
    const r = gitTry(root, 'worktree', 'remove', s.path);
    if (r.status !== 0) fail(r.stderr.trim());
    if (s.tmux) tmux('kill-session', '-t', s.tmux);
    return { name: s.name, removed: true, branch: s.branch, note: 'the branch is kept (git branch -d to delete it)' };
  }
  if (sub !== 'create') fail('usage: mis session create <issue|pr|feature> <ref> [--base <ref>] [--remote <name>] [--tmux] | list | remove <name>');
  const base = flag(args, '--base') ?? 'HEAD', remote = flag(args, '--remote') ?? 'origin';
  const wantTmux = args.includes('--tmux');
  const [kind, ref] = args.filter((a) => a !== '--tmux');
  if ((kind === 'issue' || kind === 'pr') && !/^\d+$/.test(ref ?? '')) fail(`usage: mis session create ${kind} <number>`);
  const slug = kind === 'feature' ? (ref ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : ref;
  if (!['issue', 'pr', 'feature'].includes(kind) || !slug) fail('usage: mis session create <issue|pr|feature> <ref>');
  if (wantTmux) requireTmux();
  const name = { issue: `issue-${ref}`, pr: `pr-${ref}`, feature: `feat-${slug}` }[kind];
  const branch = { issue: `fix/${ref}`, pr: `pr-${ref}-review`, feature: `feature/${slug}` }[kind];
  const path = join(root, '.worktrees', name);
  if (existsSync(path)) fail(`session ${name} already exists at ${path}`);
  excludeWorktrees(root);
  if (kind === 'pr') {
    const f = gitTry(root, 'fetch', remote, `pull/${ref}/head:${branch}`); // no '+': never drop local review commits
    if (f.status !== 0) fail(`could not fetch pull/${ref}/head from ${remote}: ${f.stderr.trim()}`);
    gitOut(root, 'worktree', 'add', '-q', path, branch);
  } else if (gitTry(root, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`).status === 0) gitOut(root, 'worktree', 'add', '-q', path, branch);
  else gitOut(root, 'worktree', 'add', '-q', '-b', branch, path, base);
  let tmuxName = null;
  if (wantTmux) {
    tmuxName = `mis-${name}`;
    const r = tmux('new-session', '-d', '-s', tmuxName, '-c', path);
    if (r.status !== 0) fail(`worktree created at ${path}, but tmux failed: ${r.stderr.trim()}`);
  }
  return { name, kind, branch, path, base: kind === 'pr' ? `${remote} pull/${ref}/head` : base, tmux: tmuxName, ...(tmuxName ? { attach: attachHint(tmuxName) } : {}) };
}

// ---------------------------------------------------------------- visual companion

async function companion([sub, ...args], cwd) {
  const sr = stateRoot(cwd);
  const infoFile = join(sr, 'companion.json'), choicesFile = join(sr, 'companion-choices.jsonl');
  const info = readJson(infoFile);
  const running = info && pidAlive(info.pid);
  if (sub === 'status') {
    const choices = existsSync(choicesFile) ? readFileSync(choicesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { running: Boolean(running), ...(running ? { url: info.url, dir: info.dir } : {}), choices };
  }
  if (sub === 'stop') {
    if (running && /companion-server\.mjs/.test(spawnSync('ps', ['-p', String(info.pid), '-o', 'command='], { encoding: 'utf8' }).stdout)) process.kill(info.pid);
    if (info) writeFileSync(infoFile, 'null');
    return { stopped: Boolean(running) };
  }
  if (sub !== 'start') fail('usage: mis companion start [dir] [--port <n>] | status | stop');
  if (running) return { url: info.url, dir: info.dir, pid: info.pid, reused: true };
  const port = flag(args, '--port') ?? '0';
  const dir = resolve(cwd, args[0] ?? join(repoRoot(cwd), 'design'));
  mkdirSync(dir, { recursive: true });
  mkdirSync(sr, { recursive: true });
  writeFileSync(infoFile, 'null');
  writeFileSync(choicesFile, '');
  const key = randomBytes(16).toString('hex');
  spawn(process.execPath, [SERVER, dir, port, key, infoFile, choicesFile], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 100; i++) {
    const s = readJson(infoFile);
    if (s?.url) return { url: s.url, dir: s.dir, pid: s.pid, note: 'open the full URL (it carries the access key); pages reload when files change' };
    await sleep(50);
  }
  return fail('companion server did not start within 5 s');
}

export const teamCommands = { team, session, companion };
