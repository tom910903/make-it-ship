// M9-D D4: iOS device family beyond devices/bridge-scan (absorbs gstack ios-sync, gstack-ios-qa-daemon, -mint).
// sync shows the template diff and overwrites only with --apply (guard asks). The relay binds loopback by default;
// --tailnet (and minting tokens for it) exposes it to other machines on your tailnet and always asks.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, flag, bool, rootOf } from './cli-util.mjs';
import { relayFamily } from './relay-daemon.mjs';

const TEMPLATE = fileURLToPath(new URL('../../templates/ios-debug-bridge', import.meta.url));
const RELAY = fileURLToPath(new URL('./ios-relay.mjs', import.meta.url));
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

const relay = relayFamily('ios');

async function daemon([sub, ...argv]) {
  const args = [...argv];
  if (sub === 'status') return relay.status();
  if (sub === 'stop') return relay.stop();
  if (sub !== 'start') fail('usage: mis ios daemon start --target <bridge url> [--port 9099] [--tailnet] | status | stop');
  const target = flag(args, '--target'), port = Number(flag(args, '--port') ?? 9099), tailnet = bool(args, '--tailnet');
  // shortcut: the device bridge URL is given by the user; CoreDevice tunnel discovery of the bridge is not implemented.
  if (!target || !/^http:\/\//.test(target)) fail('BLOCKED: --target <http://device-bridge-url> is required (start the app with the DEBUG bridge on a connected device; mis ios devices)');
  const tailnetAddr = tailnet ? relay.tailnetAddr() : null;
  return relay.start(RELAY, { target, port, tailnetAddr, tailnetPort: tailnet ? Number(flag(args, '--tailnet-port') ?? 0) : null });
}

export const iosExtra = { sync: (a, cwd) => sync([...a], cwd), daemon: (a) => daemon(a), mint: (a) => relay.mint(a), tokens: (a) => relay.tokens(a) };
