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
      const result = cmd === 'status' ? await status(cfg.browseDir) : await send(cfg.browseDir, { cmd, args: args.map(String), cwd: cfg.cwd, remote: false });
      json(200, { ok: true, result });
    } catch (e) { json(500, { ok: false, error: e.message }); }
  });
});
server.listen(cfg.port, '127.0.0.1', () => {
  writeFileSync(cfg.stateFile, JSON.stringify({ pid: process.pid, port: server.address().port, expiresAt: cfg.expiresAt, startedAt: new Date().toISOString() }));
});
const bye = () => { server.close(); try { if (JSON.parse(readFileSync(cfg.stateFile, 'utf8')).pid === process.pid) rmSync(cfg.stateFile); } catch { /* gone */ } process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
