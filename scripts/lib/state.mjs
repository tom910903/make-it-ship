// Run state (Spec §5): JSON state + JSONL events under <git-common-dir>/make-it-ship/.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, appendFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function stateRoot(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return join(resolve(cwd, common), 'make-it-ship');
}

const pad = (n) => String(n).padStart(2, '0');
export function newRunId(now = new Date()) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}-${randomBytes(2).toString('hex')}`;
}

// §5.3. BLOCKED/CANCELLED reachable from any non-terminal state.
const NEXT = {
  PLANNING: ['AWAITING_APPROVAL', 'EXECUTING'],
  AWAITING_APPROVAL: ['PLANNING', 'EXECUTING'],
  EXECUTING: ['VERIFYING'],
  VERIFYING: ['EXECUTING', 'REPORTED'],
};
export const TERMINAL = ['REPORTED', 'BLOCKED', 'CANCELLED'];

export function canTransition(from, to) {
  if (TERMINAL.includes(from)) return false;
  return to === 'BLOCKED' || to === 'CANCELLED' || (NEXT[from] ?? []).includes(to);
}

export function transition(state, to) {
  if (!canTransition(state.state, to)) throw new Error(`illegal transition ${state.state} -> ${to}`);
  state.state = to;
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const event = (run, ev) => appendFileSync(join(run.dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n');

export function createRun(cwd, { input, baseCommit = null, configHash = 'none', maxRuntimeMinutes = 120, now = new Date() }) {
  const root = stateRoot(cwd);
  const runId = newRunId(now);
  const dir = join(root, 'runs', runId);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const state = {
    schema: 1, runId, state: 'PLANNING', mode: null, modeReasons: [], riskFlags: [],
    input, baseCommit, configHash,
    startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + maxRuntimeMinutes * 60000).toISOString(),
    plan: null, planHash: null, approvals: [], evidence: [], reviews: [], interview: [], notes: [], blockedReason: null,
  };
  const run = { root, dir, state };
  atomicWrite(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  event(run, { type: 'start', runId });
  atomicWrite(join(root, 'current'), runId);
  return run;
}

/** @returns {{root:string, dir:string, state:object}|null} */
export function loadRun(cwd, runId) {
  const root = stateRoot(cwd);
  const id = runId ?? (existsSync(join(root, 'current')) ? readFileSync(join(root, 'current'), 'utf8').trim() : null);
  if (!id) return null;
  const dir = join(root, 'runs', id);
  if (!existsSync(join(dir, 'state.json'))) return null;
  return { root, dir, state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) };
}

export function setCurrent(run) { atomicWrite(join(run.root, 'current'), run.state.runId); }

export function saveState(run, ev) {
  atomicWrite(join(run.dir, 'state.json'), JSON.stringify(run.state, null, 2));
  event(run, ev);
}

export function readEvents(run) {
  const f = join(run.dir, 'events.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/** O_EXCL lock with PID; a lock whose PID is dead is reclaimed. Sets run.reclaimedLock. */
export function withLock(run, fn) {
  const lock = join(run.dir, 'lock');
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' || attempt > 0) throw e.code === 'EEXIST' ? new Error(`run is locked by pid ${holder(lock)}`) : e;
      const pid = holder(lock);
      if (pid && alive(pid)) throw new Error(`run is locked by pid ${pid}`);
      unlinkSync(lock);
      run.reclaimedLock = { pid };
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

function holder(lock) {
  try { return JSON.parse(readFileSync(lock, 'utf8')).pid; } catch { return null; }
}
