// Chrome discovery, launch and a Chrome DevTools Protocol client over Node's built-in WebSocket (no Playwright).
import { existsSync, readFileSync, statSync, rmSync } from 'node:fs';
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

/** Launch the browser on a throwaway profile; resolves with the browser WebSocket URL from DevToolsActivePort. */
export async function launchChrome({ exe, userDataDir, headless, extraArgs = [] }) {
  const args = [`--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    // no phoning home: the org forbids sending data out, and background traffic would pollute `network`/`perf`
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--metrics-recording-only',
    '--password-store=basic', '--use-mock-keychain', '--disable-extensions',
    // cross-origin iframes stay in-process so `frame` can reach them through one session
    '--disable-features=Translate,OptimizationHints,MediaRouter,IsolateOrigins,site-per-process',
    ...(headless ? ['--headless=new', '--hide-scrollbars', '--mute-audio'] : []), ...extraArgs, 'about:blank'];
  const portFile = join(userDataDir, 'DevToolsActivePort');
  rmSync(portFile, { force: true }); // a relaunch on the same profile must not read the previous port
  const proc = spawn(exe, args, { stdio: 'ignore', detached: false });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`browser exited during start (code ${proc.exitCode})`);
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').split('\n');
      if (port && path) return { proc, wsUrl: `ws://127.0.0.1:${port.trim()}${path.trim()}` };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill('SIGKILL');
  throw new Error('browser did not open its DevTools port within 20s');
}

/** One browser-level connection; page sessions are multiplexed with Target.attachToTarget({flatten:true}). */
export class CDP {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = () => reject(new Error(`cannot connect to the browser at ${url}`));
    });
  }

  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = new Set(); this.closed = false;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id); clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      } else for (const l of this.listeners) l(msg.method, msg.params, msg.sessionId);
    };
    ws.onclose = () => {
      this.closed = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('browser connection closed')); }
      this.pending.clear();
      this.onclose?.();
    };
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('browser connection closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}
