// Persistent python3 processes for python_repl, one per researchSessionID, kept for the MCP session.
// Timeout: SIGINT (KeyboardInterrupt, state kept); if the interpreter does not answer within 2s, SIGKILL and restart next time.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { which } from './lsp.mjs';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), 'repl_bridge.py');
const sessions = new Map();

function start(id, dir) {
  const venv = join(dir, '.venv', 'bin', 'python');
  const py = existsSync(venv) ? venv : which('python3');
  if (!py) throw new Error('BLOCKED: python3 not found on PATH. Install Python 3 (macOS: xcode-select --install or brew install python; Linux: your package manager), or create a .venv in the project.');
  const proc = spawn(py, ['-u', BRIDGE], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: true }); // own group: killing it also stops subprocesses user code started
  const s = { proc, waiting: [], queue: Promise.resolve(), count: 0 };
  proc.stdout.resume(); proc.stderr.resume(); proc.stdin.on('error', () => {});
  createInterface({ input: proc.stdio[3] }).on('line', (l) => { const m = JSON.parse(l); if (m.ack) s.acked = true; else s.waiting.shift()?.(m); });
  proc.on('exit', () => { if (sessions.get(id) === s) sessions.delete(id); for (const w of s.waiting.splice(0)) w(null); });
  proc.on('error', () => {});
  sessions.set(id, s);
  return s;
}

const ask = (s, req, ms) => new Promise((res) => {
  const t = setTimeout(() => { s.waiting.splice(s.waiting.indexOf(done), 1); res(undefined); }, ms);
  const done = (m) => { clearTimeout(t); res(m); };
  s.waiting.push(done);
  s.acked = false;
  s.proc.stdin.write(JSON.stringify(req) + '\n');
});
const late = (s, ms) => new Promise((res) => {
  const t = setTimeout(() => res(undefined), ms);
  s.waiting.unshift((m) => { clearTimeout(t); res(m); });
});

/** @returns result object; requests for one session run one at a time. */
export function repl({ action, code = '', id = 'default', timeoutMs = 300000, dir }) {
  if (action === 'interrupt') {
    const s = sessions.get(id);
    if (!s) return Promise.resolve({ session: id, status: 'no running session' });
    s.proc.kill('SIGINT');
    return Promise.resolve({ session: id, status: 'interrupt sent' });
  }
  if (!['execute', 'reset', 'get_state'].includes(action)) throw new Error(`unknown action ${action}; use execute, interrupt, reset or get_state`);
  if (action === 'execute' && !code) throw new Error('code is required for execute');
  let s = sessions.get(id);
  if (s && (s.proc.exitCode !== null || s.proc.signalCode !== null)) { sessions.delete(id); s = null; }
  s ??= start(id, dir);
  const run = async () => {
    let r = await ask(s, { action, code }, action === 'execute' ? timeoutMs : 10000);
    if (r === null && s.acked) return { session: id, error: 'python process exited while running this code (it was not retried); the next call starts a fresh interpreter (state lost)' };
    if (r === null) {
      // the interpreter was already dead and never received the request, so the code did not run: run it once in a fresh one
      sessions.delete(id); s = start(id, dir);
      r = await ask(s, { action, code }, action === 'execute' ? timeoutMs : 10000);
      if (r === null) return { session: id, error: 'python process exited; it will be restarted on the next call (state lost)' };
      if (r !== undefined) return { session: id, restarted: true, note: 'the previous interpreter had died; state was lost', ...(action === 'execute' ? { execution: ++s.count } : {}), ...r };
    }
    if (r !== undefined) return { session: id, ...(action === 'execute' ? { execution: ++s.count } : {}), ...r };
    s.proc.kill('SIGINT');
    const after = await late(s, 2000);
    if (after) return { session: id, ...after, error: `timed out after ${timeoutMs}ms; interrupted, session state kept\n${after.error ?? ''}`.trim() };
    killGroup(s.proc);
    return { session: id, error: `timed out after ${timeoutMs}ms; the interpreter did not respond to SIGINT and was killed (state lost)` };
  };
  return (s.queue = s.queue.then(run, run));
}

const killGroup = (p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* already gone */ } };
export function killRepls() { for (const s of sessions.values()) killGroup(s.proc); sessions.clear(); }
