// CLI side of the built-in browser: find or start the workspace daemon and send it commands over HTTP.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir } from '../home.mjs';
import { findChrome, NO_CHROME } from './chrome.mjs';

const DAEMON = fileURLToPath(new URL('./daemon.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** <git-common-dir>/make-it-ship/browse/<worktree hash>: one daemon per worktree; outside a repo, one per user. */
export function browseDir(cwd) {
  try {
    const git = (a) => execFileSync('git', ['rev-parse', a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const top = git('--show-toplevel'), common = resolve(cwd, git('--git-common-dir'));
    return join(common, 'make-it-ship', 'browse', createHash('sha256').update(top).digest('hex').slice(0, 12));
  } catch {
    return join(homeDir(), 'browse');
  }
}

const readState = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); } catch { return null; } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Only kill a recorded pid if it is still our process (pids get reused): daemon.mjs or a browser on a mis-browse profile.
function ours(pid, marker) {
  try { return execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes(marker); } catch { return false; }
}
const kill = (pid, marker) => { if (alive(pid) && ours(pid, marker)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };
const DAEMON_MARK = 'browse/daemon.mjs', CHROME_MARK = 'mis-browse-profile-';

async function request(s, path, body, timeoutMs) {
  const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
}
async function live(s) {
  if (!s || !alive(s.pid)) return false;
  try { return (await request(s, '/ping', {}, 3000)).ok === true; } catch { return false; }
}

async function waitForDaemon(dir, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = readState(dir);
    if (await live(s)) return s;
    await sleep(100);
  }
  let tail = '';
  try { tail = readFileSync(join(dir, 'daemon.log'), 'utf8').trim().split('\n').slice(-5).join('\n'); } catch { /* no log */ }
  throw new Error(`browser daemon did not start within ${ms / 1000}s${tail ? `:\n${tail}` : ''}`);
}

export async function ensureDaemon(dir) {
  const s = readState(dir);
  if (await live(s)) return s;
  const exe = findChrome();
  if (!exe) throw new Error(NO_CHROME);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'start.lock');
  let fd;
  try { fd = openSync(lock, 'wx'); } catch {
    let age = 0;
    try { age = Date.now() - statSync(lock).mtimeMs; } catch { return ensureDaemon(dir); }
    if (age > 40000) { rmSync(lock, { force: true }); return ensureDaemon(dir); }
    return waitForDaemon(dir, 40000); // another call is starting it
  }
  try {
    const old = readState(dir);
    if (await live(old)) return old;
    if (old) { // crashed daemon leftovers: its orphaned browser and temp profile
      kill(old.pid, DAEMON_MARK); kill(old.chromePid, CHROME_MARK);
      for (let i = 0; i < 30 && alive(old.chromePid); i++) await sleep(100);
      if (old.profile?.includes(CHROME_MARK)) rmSync(old.profile, { recursive: true, force: true });
      rmSync(join(dir, 'state.json'), { force: true });
    }
    const logFd = openSync(join(dir, 'daemon.log'), 'a');
    // detached with file stdio: a pipe would keep the caller (e.g. spawnSync) waiting for the daemon to exit
    spawn(process.execPath, [DAEMON, dir], { detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, MIS_BROWSER_EXE: exe } }).unref();
    closeSync(logFd);
    return await waitForDaemon(dir, 30000);
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

export async function send(dir, body) {
  const s = await ensureDaemon(dir);
  const r = await request(s, '/command', body, 10 * 60 * 1000);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

export async function status(dir) {
  const s = readState(dir);
  if (!(await live(s))) return { running: false, stateDir: dir };
  return (await request(s, '/status', {}, 5000)).result;
}

export async function stop(dir) {
  const s = readState(dir);
  if (!s) return { stopped: false, reason: 'not running' };
  if (await live(s)) await request(s, '/stop', {}, 5000).catch(() => {});
  for (let i = 0; i < 100 && alive(s.pid); i++) await sleep(100);
  kill(s.pid, DAEMON_MARK);
  for (let i = 0; i < 50 && alive(s.chromePid); i++) await sleep(100);
  kill(s.chromePid, CHROME_MARK);
  rmSync(join(dir, 'state.json'), { force: true });
  return { stopped: true };
}
