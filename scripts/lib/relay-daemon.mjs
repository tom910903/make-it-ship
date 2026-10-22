// QA relay lifecycle shared by the iOS and Android families: a detached relay process, its state file,
// the optional tailnet address, and minted tokens. Each family keeps its own <family>-qa directory,
// so a token minted for one relay never opens the other.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fail, flag, readJson, duration } from './cli-util.mjs';
import { homeDir } from './home.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const hash = (t) => createHash('sha256').update(t).digest('hex');

/** Used inside a relay process: is this Authorization header a minted, unexpired token? */
export function tokenOk(allowlistPath, header) {
  const t = /^Bearer (.+)$/.exec(header ?? '')?.[1];
  if (!t) return false;
  let list = {};
  try { list = JSON.parse(readFileSync(allowlistPath, 'utf8')); } catch { /* none minted */ }
  return Object.values(list).some((e) => e.hash === hash(t) && Date.parse(e.expiresAt) > Date.now());
}

const listen = (server, host, port) => new Promise((ok, bad) => { server.once('error', bad); server.listen(port, host, () => ok(server.address().port)); });

/** Inside a relay process: loopback listener, tailnet listener behind tokens, state file, clean exit on SIGTERM. */
export async function serveRelay(cfg, family, info, handler) {
  const gated = (req, res) => {
    if (tokenOk(cfg.allowlist, req.headers.authorization)) return handler(req, res);
    res.writeHead(401, { 'content-type': 'text/plain' }); res.end(`token required (mis ${family} mint)`);
  };
  const state = { pid: process.pid, ...info, startedAt: new Date().toISOString() };
  state.port = await listen(createServer(handler), '127.0.0.1', cfg.port);
  if (cfg.tailnetAddr) { state.tailnet = cfg.tailnetAddr; state.tailnetPort = await listen(createServer(gated), cfg.tailnetAddr, cfg.tailnetPort ?? 0); }
  writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
  const bye = () => { try { if (JSON.parse(readFileSync(cfg.stateFile, 'utf8')).pid === process.pid) rmSync(cfg.stateFile); } catch { /* gone */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}

export function relayFamily(family) {
  const home = () => { const d = join(homeDir(), `${family}-qa`); mkdirSync(d, { recursive: true }); return d; };
  const stateFile = () => join(home(), 'daemon.json');
  const allowlist = () => join(home(), 'allowlist.json');
  const current = () => readJson(stateFile());

  function status() { const cur = current(); return cur && alive(cur.pid) ? { running: true, ...cur } : { running: false }; }

  async function stop() {
    const cur = current();
    if (!cur || !alive(cur.pid)) return { stopped: false, note: 'not running' };
    process.kill(cur.pid, 'SIGTERM');
    for (let i = 0; i < 100 && alive(cur.pid); i++) await sleep(50);
    return { stopped: !alive(cur.pid), pid: cur.pid };
  }

  /** tailscale's IPv4 address, or BLOCKED. */
  function tailnetAddr() {
    const t = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 15000 });
    const addr = t.status === 0 ? t.stdout.trim().split('\n')[0] : null;
    return addr || fail('BLOCKED: tailscale is not installed or not connected (tailscale ip -4 failed)');
  }

  /** Starts `script` detached with cfg (plus stateFile and allowlist); resolves once it wrote its state. */
  async function start(script, cfg) {
    const cur = current();
    if (cur && alive(cur.pid)) fail(`relay already running (pid ${cur.pid}, port ${cur.port}); mis ${family} daemon stop`);
    writeFileSync(stateFile(), '{}');
    const child = spawn(process.execPath, [script, JSON.stringify({ ...cfg, stateFile: stateFile(), allowlist: allowlist() })], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 200; i++) {
      const s = readJson(stateFile());
      if (s?.pid === child.pid) return { running: true, ...s, ...(cfg.tailnetAddr ? { note: `Remote agents need a token: mis ${family} mint <name> (the guard asks).` } : {}) };
      if (!alive(child.pid)) break;
      await sleep(50);
    }
    return fail('relay did not start (port in use?)');
  }

  /** mis <family> mint <name> [--ttl 24h]: a token for one remote agent; only its hash is stored (mode 0600). */
  function mint(argv) {
    const args = [...argv];
    const ttl = duration(flag(args, '--ttl') ?? '24h', '--ttl'), [name] = args;
    if (!/^[\w.-]+$/.test(name ?? '')) fail(`usage: mis ${family} mint <agent-name> [--ttl 24h]`);
    const token = randomBytes(24).toString('base64url'), list = readJson(allowlist(), {});
    list[name] = { hash: hash(token), expiresAt: new Date(Date.now() + ttl).toISOString() };
    writeFileSync(allowlist(), JSON.stringify(list, null, 2));
    chmodSync(allowlist(), 0o600);
    return { name, token, expiresAt: list[name].expiresAt, note: 'Shown once. The agent sends it as Authorization: Bearer <token> to the tailnet listener.' };
  }

  function tokens([sub, name]) {
    const list = readJson(allowlist(), {});
    if (sub === 'revoke') { if (!list[name]) fail(`no token for ${name}`); delete list[name]; writeFileSync(allowlist(), JSON.stringify(list, null, 2)); return { revoked: name }; }
    return { tokens: Object.entries(list).map(([n, e]) => ({ name: n, expiresAt: e.expiresAt, expired: Date.parse(e.expiresAt) <= Date.now() })) };
  }

  return { home, status, stop, tailnetAddr, start, mint, tokens };
}
