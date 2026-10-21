// Pair-agent endpoint (M9-D D8): lets another AI agent drive this workspace's built-in browser with a bearer token.
// Started detached by `mis pair-agent start`; argv[2] is a JSON config. Listens on 127.0.0.1 only (a tunnel, if any,
// forwards to it). Only the commands in ALLOWED pass; see refusal().
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { send, status } from './browse/client.mjs';

const cfg = JSON.parse(process.argv[2]);
// Read, navigate and interact only: nothing that runs page JavaScript, touches storage or reads/writes local files
// (load-html, upload, eval, screenshot/pdf paths, snapshot -o), and navigation only to http(s) URLs (no file:/data:).
const ALLOWED = new Set(['status', 'goto', 'back', 'forward', 'reload', 'url', 'wait', 'text', 'html', 'links', 'forms', 'accessibility', 'data', 'css', 'attrs', 'is',
  'console', 'network', 'dialog', 'perf', 'click', 'fill', 'select', 'hover', 'type', 'press', 'scroll', 'viewport', 'dialog-accept', 'dialog-dismiss', 'snapshot', 'tabs', 'tab', 'newtab', 'closetab', 'frame']);
function refusal(cmd, args) {
  if (typeof cmd !== 'string' || !Array.isArray(args)) return 'body must be {"cmd": string, "args": [..]}';
  if (!ALLOWED.has(cmd)) return `"${cmd}" is not available to a paired agent (allowed: ${[...ALLOWED].join(', ')})`;
  if (['goto', 'newtab'].includes(cmd) && args[0] !== undefined && !/^https?:\/\//i.test(String(args[0]))) return `${cmd} takes an http(s) URL only`;
  if (cmd === 'snapshot' && args.some((a) => ['-o', '--output'].includes(String(a)))) return 'snapshot -o writes a local file; not available to a paired agent';
  return null;
}
// M9 fix1 D3: the agent sees only pages it opened itself: http(s) origins it went to with goto/newtab, in tabs it opened or
// navigated. Every command is checked against the active page before it runs and where it landed after; a page outside
// that set (the user's local file: pages, pages from before pairing reached with back/forward) is blanked, never read.
const run = (cmd, args = []) => send(cfg.browseDir, { cmd, args: args.map(String), cwd: cfg.cwd, remote: false });
const origins = new Set(), openedTabs = new Set();
const originOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; } };
const shared = (t) => { const o = originOf(t?.url); return !!o && origins.has(o) && openedTabs.has(t.id); };
const tabList = async () => { const r = await run('tabs'); return Array.isArray(r) ? r : JSON.parse(r); };
const activeTab = async () => (await tabList()).find((t) => t.active);
const refused = (msg) => Object.assign(new Error(msg), { status: 400 });
const clearLogs = async () => { for (const c of ['console', 'network', 'dialog']) await run(c, ['--clear']).catch(() => {}); };

async function handle(cmd, args) {
  if (cmd === 'status') { const st = await status(cfg.browseDir); return { running: !!st.running, mode: st.mode ?? null, tabs: st.tabs ?? 0 }; } // no local paths or URLs
  if (cmd === 'tabs') return (await tabList()).map((t) => (shared(t) ? t : { id: t.id, active: t.active, title: '(not shared with the paired agent)', url: '(not shared)' }));
  const opens = cmd === 'goto' || cmd === 'newtab';
  if (cmd === 'tab' || (cmd === 'closetab' && args[0] !== undefined)) {
    if (!shared((await tabList()).find((t) => String(t.id) === String(args[0])))) throw refused(`tab ${args[0]} was not opened by the paired agent`);
  } else if (!opens && !shared(await activeTab())) throw refused('the current page was not opened by the paired agent; goto an http(s) URL first');
  if (opens && originOf(args[0])) origins.add(originOf(args[0]));
  if (cmd === 'goto') await clearLogs(); // the tab's earlier console/network entries belong to pages the agent did not open
  const result = await run(cmd, args);
  if (cmd === 'closetab') return result;
  const now = await activeTab();
  if (opens && now) { openedTabs.add(now.id); if (originOf(now.url)) origins.add(originOf(now.url)); } // a redirect it followed
  if (!shared(now)) {
    await run('goto', ['about:blank']).catch(() => {}); await clearLogs();
    throw refused(`${cmd} left the pages the paired agent opened (back/forward into earlier or local pages, or a link to an origin it did not open with goto); the page was blanked. Use goto <http(s) URL>`);
  }
  return result;
}

const want = Buffer.from(cfg.tokenHash, 'hex');
function authorized(h) {
  const t = /^Bearer (.+)$/.exec(h ?? '')?.[1];
  if (!t || Date.parse(cfg.expiresAt) <= Date.now()) return false;
  return timingSafeEqual(createHash('sha256').update(t).digest(), want);
}
const server = createServer((req, res) => {
  const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (!authorized(req.headers.authorization)) return json(401, { error: 'token required (expired or wrong)' });
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, expiresAt: cfg.expiresAt });
  if (req.method !== 'POST' || req.url !== '/command') return json(404, { error: 'POST /command {"cmd": "goto", "args": ["https://..."]} or GET /health' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const { cmd, args = [] } = JSON.parse(body);
      const no = refusal(cmd, args);
      if (no) return json(400, { error: no });
      json(200, { ok: true, result: await handle(cmd, args.map(String)) });
    } catch (e) { json(e.status ?? 500, { ok: false, error: e.message }); }
  });
});
// An agent may pause between commands (a test or script blocked for seconds): keep idle sockets open well past that, so a
// reused connection is never closed by the server just as a request goes out ("fetch failed").
server.keepAliveTimeout = 65000; server.headersTimeout = 70000;
server.listen(cfg.port, '127.0.0.1', () => {
  writeFileSync(cfg.stateFile, JSON.stringify({ pid: process.pid, port: server.address().port, expiresAt: cfg.expiresAt, startedAt: new Date().toISOString() }));
});
const bye = () => { server.close(); try { if (JSON.parse(readFileSync(cfg.stateFile, 'utf8')).pid === process.pid) rmSync(cfg.stateFile); } catch { /* gone */ } process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
