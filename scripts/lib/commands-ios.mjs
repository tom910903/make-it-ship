// M9-D D4: iOS device family beyond devices/bridge-scan (absorbs gstack ios-sync, gstack-ios-qa-daemon, -mint).
// sync shows the template diff and overwrites only with --apply (guard asks). The relay binds loopback by default;
// --tailnet (and minting tokens for it) exposes it to other machines on your tailnet and always asks.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, flag, bool, rootOf, readJson, duration } from './cli-util.mjs';
import { homeDir } from './home.mjs';

const TEMPLATE = fileURLToPath(new URL('../../templates/ios-debug-bridge', import.meta.url));
const RELAY = fileURLToPath(new URL('./ios-relay.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iosHome = () => { const d = join(homeDir(), 'ios-qa'); mkdirSync(d, { recursive: true }); return d; };
const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : [relative(base, join(dir, e.name))]));

/** The project's copy of the bridge: the directory holding Sources/DebugBridge/DebugBridge.swift. */
function bridgeCopy(root) {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*Sources/DebugBridge/DebugBridge.swift'], { cwd: root, encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean).map((f) => resolve(root, f, '../../..')).find((d) => d !== TEMPLATE) ?? null;
}

function sync(args, cwd) {
  const apply = bool(args, '--apply'), destArg = flag(args, '--dest');
  const root = rootOf(cwd), dest = destArg ? resolve(cwd, destArg) : bridgeCopy(root);
  if (!dest || !existsSync(dest)) fail(`no debug bridge copy found in this project (pass --dest <dir>; the template is ${TEMPLATE})`);
  const changed = files(TEMPLATE).filter((f) => !existsSync(join(dest, f)) || readFileSync(join(dest, f), 'utf8') !== readFileSync(join(TEMPLATE, f), 'utf8'));
  const diff = spawnSync('git', ['diff', '--no-index', '--no-color', '--', dest, TEMPLATE], { encoding: 'utf8' }).stdout;
  if (!apply) return { dest, template: TEMPLATE, changed, diff, next: changed.length ? 'Show the user the diff; update only with their OK: mis ios sync --apply (the guard asks).' : 'Up to date.' };
  for (const f of changed) cpSync(join(TEMPLATE, f), join(dest, f));
  return { dest, applied: changed, next: 'Rebuild the app; run mis ios bridge-scan before shipping.' };
}

// ---------------------------------------------------------------- relay daemon and tokens

const stateFile = () => join(iosHome(), 'daemon.json');
const allowlist = () => join(iosHome(), 'allowlist.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function daemon([sub, ...argv]) {
  const args = [...argv];
  const cur = readJson(stateFile());
  if (sub === 'status') return cur && alive(cur.pid) ? { running: true, ...cur } : { running: false };
  if (sub === 'stop') {
    if (!cur || !alive(cur.pid)) return { stopped: false, note: 'not running' };
    process.kill(cur.pid, 'SIGTERM');
    for (let i = 0; i < 100 && alive(cur.pid); i++) await sleep(50);
    return { stopped: !alive(cur.pid), pid: cur.pid };
  }
  if (sub !== 'start') fail('usage: mis ios daemon start --target <bridge url> [--port 9099] [--tailnet] | status | stop');
  if (cur && alive(cur.pid)) fail(`relay already running (pid ${cur.pid}, port ${cur.port}); mis ios daemon stop`);
  const target = flag(args, '--target'), port = Number(flag(args, '--port') ?? 9099), tailnet = bool(args, '--tailnet');
  // shortcut: the device bridge URL is given by the user; CoreDevice tunnel discovery of the bridge is not implemented.
  if (!target || !/^http:\/\//.test(target)) fail('BLOCKED: --target <http://device-bridge-url> is required (start the app with the DEBUG bridge on a connected device; mis ios devices)');
  let tailnetAddr = null;
  if (tailnet) {
    const t = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 15000 });
    tailnetAddr = t.status === 0 ? t.stdout.trim().split('\n')[0] : null;
    if (!tailnetAddr) fail('BLOCKED: tailscale is not installed or not connected (tailscale ip -4 failed)');
  }
  const cfg = { target, port, tailnetAddr, tailnetPort: tailnet ? Number(flag(args, '--tailnet-port') ?? 0) : null, stateFile: stateFile(), allowlist: allowlist() };
  writeFileSync(stateFile(), '{}');
  const child = spawn(process.execPath, [RELAY, JSON.stringify(cfg)], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 200; i++) {
    const s = readJson(stateFile());
    if (s?.pid === child.pid) return { running: true, ...s, ...(tailnet ? { note: 'Remote agents need a token: mis ios mint <name> (the guard asks).' } : {}) };
    if (!alive(child.pid)) break;
    await sleep(50);
  }
  fail('relay did not start (port in use?)');
}

/** mis ios mint <name> [--ttl 24h]: a token for one remote agent; only its hash is stored (mode 0600). */
function mint(args) {
  const ttl = duration(flag(args, '--ttl') ?? '24h', '--ttl'), [name] = args;
  if (!/^[\w.-]+$/.test(name ?? '')) fail('usage: mis ios mint <agent-name> [--ttl 24h]');
  const token = randomBytes(24).toString('base64url'), list = readJson(allowlist(), {});
  list[name] = { hash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + ttl).toISOString() };
  writeFileSync(allowlist(), JSON.stringify(list, null, 2));
  chmodSync(allowlist(), 0o600);
  return { name, token, expiresAt: list[name].expiresAt, note: 'Shown once. The agent sends it as Authorization: Bearer <token> to the tailnet listener.' };
}

function tokens([sub, name]) {
  const list = readJson(allowlist(), {});
  if (sub === 'revoke') { if (!list[name]) fail(`no token for ${name}`); delete list[name]; writeFileSync(allowlist(), JSON.stringify(list, null, 2)); return { revoked: name }; }
  return { tokens: Object.entries(list).map(([n, e]) => ({ name: n, expiresAt: e.expiresAt, expired: Date.parse(e.expiresAt) <= Date.now() })) };
}

export const iosExtra = { sync: (a, cwd) => sync([...a], cwd), daemon: (a) => daemon(a), mint: (a) => mint([...a]), tokens: (a) => tokens(a) };
