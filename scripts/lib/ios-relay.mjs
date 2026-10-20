// iOS QA relay daemon (M9-D D4, absorbs gstack-ios-qa-daemon): forwards HTTP to the app's DEBUG bridge.
// Loopback listener always; a tailnet listener only with --tailnet, and every tailnet request needs a minted token.
// Started detached by `mis ios daemon start`; argv[2] is a JSON config. Writes its state file once listening.
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const cfg = JSON.parse(process.argv[2]);
const target = new URL(cfg.target);
const hash = (t) => createHash('sha256').update(t).digest('hex');
function tokenOk(header) {
  const t = /^Bearer (.+)$/.exec(header ?? '')?.[1];
  if (!t) return false;
  let list = {};
  try { list = JSON.parse(readFileSync(cfg.allowlist, 'utf8')); } catch { /* none minted */ }
  return Object.values(list).some((e) => e.hash === hash(t) && Date.parse(e.expiresAt) > Date.now());
}
const relay = (needToken) => (req, res) => {
  if (needToken && !tokenOk(req.headers.authorization)) { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('token required (mis ios mint)'); return; }
  const headers = { ...req.headers, host: target.host };
  delete headers.authorization;
  const up = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`device bridge unreachable: ${e.message}`); });
  req.pipe(up);
};
const listen = (server, host, port) => new Promise((ok, bad) => { server.once('error', bad); server.listen(port, host, () => ok(server.address().port)); });

const state = { pid: process.pid, target: cfg.target, startedAt: new Date().toISOString() };
state.port = await listen(createServer(relay(false)), '127.0.0.1', cfg.port);
if (cfg.tailnetAddr) { state.tailnet = cfg.tailnetAddr; state.tailnetPort = await listen(createServer(relay(true)), cfg.tailnetAddr, cfg.tailnetPort ?? 0); }
writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
const bye = () => { try { if (JSON.parse(readFileSync(cfg.stateFile, 'utf8')).pid === process.pid) rmSync(cfg.stateFile); } catch { /* gone */ } process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
