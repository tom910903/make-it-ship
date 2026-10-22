// Android QA relay daemon: a fixed HTTP API over adb for one device or emulator. There is no passthrough to
// `adb shell`; every input is validated by android.mjs first. Loopback always; the tailnet listener needs a token.
// Started detached by `mis android daemon start`; argv[2] is a JSON config.
import { serveRelay } from './relay-daemon.mjs';
import { screenshot, uiNodes, input, launch } from './android.mjs';

const cfg = JSON.parse(process.argv[2]);
const GET = { '/healthz': () => ({ ok: true, serial: cfg.serial }), '/ui': () => ({ nodes: uiNodes(cfg.serial) }) };
const POST = Object.fromEntries(['tap', 'swipe', 'text', 'key'].map((a) => [`/${a}`, (b) => input(cfg.serial, a, b)]));
POST['/launch'] = (b) => launch(cfg.serial, b.package);

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const readBody = (req) => new Promise((ok, bad) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 65536) bad(new Error('body too large')); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(new Error('body must be JSON')); } });
});

// DNS rebinding: a web page reaching 127.0.0.1 under its own name sends that name as Host.
const HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', cfg.tailnetAddr].filter(Boolean));
const hostOk = (h) => HOSTS.has(String(h ?? '').replace(/:\d+$/, ''));

await serveRelay(cfg, 'android', { serial: cfg.serial }, async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (!hostOk(req.headers.host)) return send(res, 403, { error: 'Host must be loopback or the tailnet address' });
  // a JSON content-type forces a CORS preflight, which this relay never answers, so web pages cannot POST input
  if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'POST bodies must be application/json' });
  try {
    if (path === '/screenshot' && req.method === 'GET') return send(res, 200, screenshot(cfg.serial), 'image/png');
    if (GET[path] && req.method === 'GET') return send(res, 200, GET[path]());
    if (!POST[path]) return send(res, GET[path] || path === '/screenshot' ? 405 : 404, { error: `${req.method} ${path} is not supported` });
    if (req.method !== 'POST') return send(res, 405, { error: `${path} is POST only` });
    POST[path](await readBody(req));
    return send(res, 200, { ok: true });
  } catch (e) {
    // validation errors come from fail() before adb runs; adb failures say "adb ... failed"
    return send(res, /^adb /.test(e.message) ? 502 : 400, { error: e.message });
  }
});
