// Chrome discovery, launch and a Chrome DevTools Protocol client over Node's built-in WebSocket (no Playwright).
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';

const MAC = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'];
const LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'];
const WIN = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'Chromium/Application/chrome.exe'];

export const NO_CHROME = 'BLOCKED: no Chrome, Chromium or Edge found for the built-in browser. Install Google Chrome or set MIS_BROWSER to the browser executable.';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Browser executable: MIS_BROWSER if set (null when it does not exist), else the usual install paths. */
export function findChrome(env = process.env) {
  if (env.MIS_BROWSER) return isFile(env.MIS_BROWSER) ? env.MIS_BROWSER : null;
  const candidates = process.platform === 'darwin' ? ['/Applications', join(homedir(), 'Applications')].flatMap((d) => MAC.map((a) => join(d, a)))
    : process.platform === 'win32' ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => WIN.map((a) => join(d, a)))
      : [...(env.PATH ?? '').split(delimiter), '/usr/bin', '/snap/bin', '/opt/google/chrome'].flatMap((d) => LINUX.map((n) => join(d, n)));
  return candidates.find(isFile) ?? null;
}

/**
 * Launch the browser on a throwaway profile with CDP over a pipe (fds 3/4): no DevTools TCP port that other local
 * processes could reach without the daemon's token. Resolves once the browser answers.
 */
export const OWNER_MARK = '--mis-browse-owner'; // ignored by Chrome; lets client.mjs recognize (and only kill) browsers it started

export async function launchChrome({ exe, userDataDir, headless, extraArgs = [], extensions = false }) {
  const args = [OWNER_MARK, `--user-data-dir=${userDataDir}`, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    // no phoning home: the org forbids sending data out, and background traffic would pollute `network`/`perf`
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--metrics-recording-only',
    // never the user's Keychain; extensions only for `connect` (loaded over the pipe with Extensions.loadUnpacked)
    '--password-store=basic', '--use-mock-keychain', ...(extensions ? ['--enable-unsafe-extension-debugging'] : ['--disable-extensions']),
    // cross-origin iframes stay in-process so `frame` can reach them through one session
    '--disable-features=Translate,OptimizationHints,MediaRouter,IsolateOrigins,site-per-process',
    ...(headless ? ['--headless=new', '--hide-scrollbars', '--mute-audio'] : []), ...extraArgs, 'about:blank'];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: false });
  const cdp = new CDP(proc.stdio[3], proc.stdio[4]);
  const died = new Promise((_, reject) => {
    proc.once('error', (e) => reject(new Error(`cannot start the browser: ${e.message}`)));
    proc.once('exit', (code) => reject(new Error(`browser exited during start (code ${code})`)));
  });
  try {
    await Promise.race([cdp.send('Browser.getVersion', {}, undefined, 20000), died]);
  } catch (e) {
    proc.kill('SIGKILL'); cdp.close();
    throw new Error(/timed out/.test(e.message) ? 'browser did not answer on its DevTools pipe within 20s' : e.message);
  }
  died.catch(() => {});
  return { proc, cdp };
}

/** One browser-level connection over the DevTools pipe (NUL-terminated JSON); page sessions are multiplexed with Target.attachToTarget({flatten:true}). */
export class CDP {
  constructor(out, input) {
    this.out = out; this.input = input; this.seq = 0; this.pending = new Map(); this.listeners = new Set(); this.closed = false;
    let buf = Buffer.alloc(0);
    input.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]); // split on NUL bytes before decoding: a UTF-8 character may span chunks
      for (let i; (i = buf.indexOf(0)) >= 0; buf = buf.subarray(i + 1)) this.dispatch(JSON.parse(buf.subarray(0, i).toString('utf8')));
    });
    const closed = () => {
      if (this.closed) return;
      this.closed = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('browser connection closed')); }
      this.pending.clear();
      this.onclose?.();
    };
    input.on('close', closed); input.on('error', closed); out.on('error', closed);
  }

  dispatch(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
    } else for (const l of this.listeners) l(msg.method, msg.params, msg.sessionId);
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('browser connection closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  close() { this.out.destroy(); this.input.destroy(); }
}
