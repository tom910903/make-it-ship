// Run state (Spec §5): JSON state + JSONL events under <git-common-dir>/make-it-ship/.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, appendFileSync, existsSync, openSync, closeSync, unlinkSync , statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function stateRoot(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

export const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * O_EXCL lock with PID. A lock whose PID is dead is reclaimed (sets run.reclaimedLock).
 * A live holder is waited for up to waitMs (default MIS_LOCK_WAIT_MS or 30s): locks are held only for short writes.
 */
export function withLock(run, fn, { waitMs = Number(process.env.MIS_LOCK_WAIT_MS ?? 30000) } = {}) {
  const lock = join(run.dir, 'lock');
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); }
      catch (w) { try { unlinkSync(lock); } catch { /* gone */ } throw w; }
      finally { closeSync(fd); }
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const seen = readLock(lock);
      const pid = seen && (() => { try { return JSON.parse(seen).pid; } catch { return null; } })();
      // dead owner, or an empty/garbled lock old enough that its writer must have crashed mid-create
      const orphan = !pid && seen !== null && (() => { try { return Date.now() - statSync(lock).mtimeMs > 5000; } catch { return false; } })();
      if ((pid && !pidAlive(pid)) || orphan) {
        if (reclaimLock(lock, seen)) { run.reclaimedLock = { pid }; continue; }
      }
      if (Date.now() >= until) throw new Error(`run is locked by pid ${pid}`);
      sleepMs(20 + Math.floor(Math.random() * 30));
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

const readLock = (lock) => { try { return readFileSync(lock, 'utf8'); } catch { return null; } };

/** Remove a stale lock only if it is still exactly the one judged stale: its owner may have exited and a new owner
 *  taken the lock since we read it. Reclaimers are serialized by a short-lived `.reclaim` file. */
// shortcut: a reclaimer stalled for over 5s (e.g. SIGSTOP) could have its marker removed by another; the reclaim step is a
// read+unlink of microseconds, so this is accepted (docs/PROGRESS.md RISKS) rather than built on heavier primitives.
export function reclaimLock(lock, seen) {
  const r = `${lock}.reclaim`;
  try { closeSync(openSync(r, 'wx')); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - statSync(r).mtimeMs > 5000) unlinkSync(r); } catch { /* gone */ }
    return false;
  }
  try { if (readLock(lock) === seen) unlinkSync(lock); } catch { /* gone */ } finally { try { unlinkSync(r); } catch { /* gone */ } }
  return true;
}
