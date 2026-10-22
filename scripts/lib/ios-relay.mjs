// iOS QA relay daemon (M9-D D4, absorbs gstack-ios-qa-daemon): forwards HTTP to the app's DEBUG bridge.
// Loopback listener always; a tailnet listener only with --tailnet, and every tailnet request needs a minted token.
// Started detached by `mis ios daemon start`; argv[2] is a JSON config. Writes its state file once listening.
import { request } from 'node:http';
import { serveRelay } from './relay-daemon.mjs';

const cfg = JSON.parse(process.argv[2]);
const target = new URL(cfg.target);
await serveRelay(cfg, 'ios', { target: cfg.target }, (req, res) => {
  const headers = { ...req.headers, host: target.host };
  delete headers.authorization;
  const up = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`device bridge unreachable: ${e.message}`); });
  req.pipe(up);
});
