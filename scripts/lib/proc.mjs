// Stored commands (checks, bench, health, worktree baselines) run in their own process group, so a timeout ends the whole
// tree, not only the direct child (review 2026-11-10, RELIABILITY-001): SIGTERM to the group, SIGKILL after a grace period.
// When mis itself is interrupted (SIGINT, SIGTERM, SIGHUP) or exits while one runs, the group goes too.
// shortcut: a SIGKILL of mis leaves the group running and a command that daemonizes (setsid) escapes it; isolation needs a container.
// shortcut: a passing command's background child that closed its output keeps running (only timeouts and mis's exit end the group);
// output past maxBuffer is dropped, not an error as with spawnSync. Kill the group after every run if leftovers start to matter.
import { spawn } from 'node:child_process';

export const GRACE_MS = 2000;
const SIGNALS = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

/** spawnSync-like result {status, signal, stdout, stderr, error}; error.code ETIMEDOUT when the time ran out. */
export function runTree(argv, { cwd, env, timeoutMs, maxBuffer = 64 * 1024 * 1024, capture = true }) {
  return new Promise((resolve) => {
    const io = capture ? 'pipe' : 'ignore';
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', io, io] });
    const out = { stdout: '', stderr: '' };
    for (const k of ['stdout', 'stderr']) child[k]?.on('data', (d) => { if (out[k].length < maxBuffer) out[k] += d; });
    const group = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
    const onExit = () => group('SIGKILL');
    const onSignal = (sig) => { group('SIGKILL'); process.exit(128 + SIGNALS[sig]); };
    process.on('exit', onExit);
    for (const s of Object.keys(SIGNALS)) process.on(s, onSignal);
    let exited = null, timedOut = false, kill;
    const timer = setTimeout(() => {
      timedOut = !exited; // after the direct child exited in time, only leftovers holding its output are cleared
      group('SIGTERM');
      kill = setTimeout(() => group('SIGKILL'), timedOut ? GRACE_MS : 0);
    }, timeoutMs);
    const finish = (r) => {
      clearTimeout(timer); clearTimeout(kill);
      if (timedOut) group('SIGKILL');
      process.off('exit', onExit);
      for (const s of Object.keys(SIGNALS)) process.off(s, onSignal);
      resolve({ ...out, ...r });
    };
    child.on('exit', (status, signal) => { exited = { status, signal }; });
    child.on('error', (error) => finish({ status: null, signal: null, error }));
    child.on('close', (status, signal) => finish(timedOut
      ? { status: null, signal: signal ?? 'SIGTERM', error: Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' }) }
      : { status: exited?.status ?? status, signal: exited?.signal ?? signal }));
  });
}
