#!/usr/bin/env node
// Browser daemon: one per workspace. Started detached by client.mjs; serves 127.0.0.1:<random port> with a bearer token.
// Usage: node daemon.mjs <stateDir> [--local-only]. Exits on idle, on `stop`, or when the browser dies (no self-healing; the next call restarts it).
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, renameSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Browser } from './browser.mjs';
import { runCommand, printPdf, failIfBlocked } from './actions.mjs';
import { findChrome, chromeArgs } from './chrome.mjs';
import { homeDir } from '../home.mjs';

const dir = process.argv[2];
const stateFile = join(dir, 'state.json');
const IDLE_MS = Number(process.env.MIS_BROWSE_IDLE_MS) || 30 * 60 * 1000;
const extraArgs = chromeArgs(process.env.MIS_BROWSE_CHROME_ARGS);
const exe = process.env.MIS_BROWSER_EXE || findChrome();
const token = randomBytes(24).toString('hex');
// M8 R3-1: local-only = Chrome's only proxy is this socket, which drops every connection; owned (not a closed port) so no
// other local process can take the port and receive the traffic. It lives and dies with the daemon.
const sink = process.argv.includes('--local-only') ? tcpServer((s) => s.destroy()) : null;
if (sink) await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const browser = new Browser({ exe, extraArgs, headlessOnly: process.env.MIS_BROWSE_HEADLESS_ONLY === '1', localOnly: sink?.address().port ?? null });
const log = (m) => process.stderr.write(`[${new Date().toISOString()}] ${m}\n`);
let server, idleTimer, queue = Promise.resolve(), stopping = false;

function writeState() {
  const s = { pid: process.pid, port: server.address().port, token, chromePid: browser.proc?.pid ?? null, browser: exe, profile: browser.profile, localOnly: !!sink, startedAt: started };
  const tmp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, stateFile);
}

async function shutdown(code, why) {
  if (stopping) return;
  stopping = true;
  log(`shutting down: ${why}`);
  try { if (JSON.parse(readFileSync(stateFile, 'utf8')).pid === process.pid) rmSync(stateFile, { force: true }); } catch { /* none */ }
  await browser.close().catch((e) => log(`browser close failed: ${e.message}`));
  server?.close();
  process.exit(code);
}

function touch() {
  clearTimeout(idleTimer);
  // a visible window the user works in (handoff, connect) is not idle even when no command arrives
  idleTimer = setTimeout(() => (browser.handoff || browser.connected ? touch() : shutdown(0, 'idle')), IDLE_MS);
}

function status() {
  const t = browser.tabs.get(browser.active);
  return { running: true, pid: process.pid, port: server.address().port, chromePid: browser.proc?.pid ?? null, browser: exe,
    localOnly: !!sink, mode: browser.handoff ? 'handoff' : browser.connected ? 'connected' : browser.headless ? 'headless' : 'headed', handoff: browser.handoff, tabs: browser.tabs.size,
    ...(browser.connected ? { profile: browser.connected.profile, extensionId: browser.extensionId } : {}), watching: !!browser.watch,
    activeTab: t?.id ?? null, url: t?.url ?? null, viewport: browser.viewport, idleShutdownMin: Math.round(IDLE_MS / 600) / 100, stateDir: dir, startedAt: started };
}

// Internal command of `mis pdf`: render an HTML file in a fresh tab (network blocked unless allowed) and print it.
async function renderPdf({ html, out, opts }) {
  const prev = browser.active, tab = await browser.newTab();
  try {
    if (!opts.allowNetwork) await browser.send(tab, 'Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    // fail closed if the page left our file (meta refresh and the like; no CSP stops navigation): before and after printing
    const stay = () => { if (tab.url !== html) throw new Error(`pdf: the page navigated away from ${html} to ${tab.url}; nothing written`); };
    await browser.navigate(tab, html);
    stay();
    await browser.evaluate(tab, 'document.fonts.ready.then(() => true)');
    stay();
    const pdf = await printPdf(browser, tab, opts);
    stay();
    writeFileSync(out, pdf);
    return { bytes: pdf.length, pages: (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length };
  } finally {
    await browser.cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {});
    browser.tabs.delete(tab.id);
    browser.active = prev;
  }
}

const authorized = (req) => {
  const got = Buffer.from(String(req.headers.authorization ?? '')), want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
};

const started = new Date().toISOString();
try {
  mkdirSync(dir, { recursive: true });
  browser.onExit = () => { if (!browser.handoff) shutdown(1, 'browser exited'); };
  await browser.start(true);
  server = createServer((req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || !authorized(req)) return reply(401, { ok: false, error: 'unauthorized' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      touch();
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return reply(400, { ok: false, error: 'bad JSON' }); }
      if (req.url === '/ping') return reply(200, { ok: true });
      if (req.url === '/status') return reply(200, { ok: true, result: status() });
      if (req.url === '/stop') { reply(200, { ok: true }); return shutdown(0, 'stop requested'); }
      if (req.url !== '/command') return reply(404, { ok: false, error: 'not found' });
      // one command at a time: tabs, refs and the active page are shared state
      queue = queue.then(async () => {
        try {
          const before = browser.proc?.pid;
          // _render-pdf skips runCommand, so it gets the same check for requests a held page made meanwhile
          const seen = browser.blocked.length;
          const result = body.cmd === '_render-pdf' ? failIfBlocked(browser, seen, 'pdf', await renderPdf(body.args[0]))
            : await runCommand(browser, body.cmd, body.args ?? [], { cwd: body.cwd, remote: !!body.remote, inChain: false, data: body.data, stateDir: dir, home: homeDir() });
          if (browser.proc?.pid !== before) writeState(); // handoff/resume relaunched the browser
          reply(200, { ok: true, result });
        } catch (e) { reply(200, { ok: false, error: e.message }); }
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  writeState();
  touch();
  log(`listening on ${server.address().port}, browser pid ${browser.proc?.pid}`);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => shutdown(0, sig));
} catch (e) {
  log(`start failed: ${e.stack}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
