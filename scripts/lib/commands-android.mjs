// mis android (user decision 2026-10-22): devices and emulators over adb, at the iOS family's level —
// device detection (emulators never count as device verification), control, and a QA relay with tailnet tokens.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, flag } from './cli-util.mjs';
import { relayFamily } from './relay-daemon.mjs';
import { adb, sdkTool, listDevices, pickSerial, screenshot, uiNodes, input, launch, launchArgs, parseGfx, packageLayers, latencyFps } from './android.mjs';
import { readHome, writeHome } from './home.mjs';

const RELAY = fileURLToPath(new URL('./android-relay.mjs', import.meta.url));
const relay = relayFamily('android');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USAGE = 'usage: mis android <devices|avds|boot <avd> [--timeout 300]|kill <emulator-serial>|shot [--out f.png]|ui|tap <x> <y>'
  + '|swipe <x1> <y1> <x2> <y2> [ms]|type <text>|key <KEYCODE_*>|launch <package>|install <apk>|gfx <package> [--reset]|reduced-motion on|off|status'
  + '|daemon start [--port 9098] [--tailnet]|status|stop|mint <name>|tokens [revoke <name>]> [--serial <serial>]';

function avds() {
  const r = spawnSync(sdkTool('emulator'), ['-list-avds'], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) fail('BLOCKED: the Android emulator is not installed (Android SDK emulator package)');
  return { avds: r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('INFO')) };
}

/** Starts the AVD detached and waits (gated on sys.boot_completed, capped by --timeout) for its emulator serial. */
async function boot(args) {
  const [name] = args, timeout = Number(flag(args, '--timeout') ?? 300);
  if (!/^[\w.-]+$/.test(name ?? '')) fail(USAGE);
  if (!avds().avds.includes(name)) fail(`no AVD named ${name} (mis android avds)`);
  const running = bootedAvd(name);
  if (running) return { avd: name, serial: running, booted: true, alreadyRunning: true };
  const child = spawn(sdkTool('emulator'), ['-avd', name, '-no-boot-anim'], { detached: true, stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  child.unref();
  for (const end = Date.now() + timeout * 1000; Date.now() < end; await sleep(1000)) {
    const serial = bootedAvd(name);
    if (serial) return { avd: name, serial, booted: true };
    if (exited !== null) fail(`emulator ${name} exited with code ${exited} before booting`);
  }
  return fail(`emulator ${name} did not finish booting within ${timeout}s`);
}

/** The serial of a running, fully booted emulator for this AVD (matched by `adb emu avd name`), or null. */
function bootedAvd(name) {
  const emus = listDevices().devices.filter((d) => d.serial.startsWith('emulator-') && d.state === 'device');
  const d = emus.find((e) => adb(['-s', e.serial, 'emu', 'avd', 'name']).stdout.split(/\r?\n/)[0].trim() === name);
  return d && adb(['-s', d.serial, 'shell', 'getprop', 'sys.boot_completed']).stdout.trim() === '1' ? d.serial : null;
}

function kill([serial]) {
  if (!/^emulator-\d+$/.test(serial ?? '')) fail('only emulators can be stopped: mis android kill emulator-<port>');
  const r = adb(['-s', serial, 'emu', 'kill']);
  return r.status === 0 ? { killed: serial } : fail(`adb emu kill failed: ${r.stderr.trim()}`);
}

function shot(args, cwd, serial) {
  const out = resolve(cwd, flag(args, '--out') ?? join(relay.home(), 'shots', `${serial}-${Date.now()}.png`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, screenshot(serial));
  return { serial, path: out };
}

function install([apk], cwd, serial) {
  if (!apk) fail('usage: mis android install <apk>');
  const r = adb(['-s', serial, 'install', '-r', resolve(cwd, apk)], { timeout: 300000 });
  return r.status === 0 ? { serial, installed: apk } : fail(`adb install failed: ${(r.stderr || r.stdout).trim()}`);
}

async function daemon([sub, ...args]) {
  if (sub === 'status') return relay.status();
  if (sub === 'stop') return relay.stop();
  if (sub !== 'start') fail('usage: mis android daemon start [--serial <serial>] [--port 9098] [--tailnet] | status | stop');
  const serial = pickSerial(flag(args, '--serial')), port = Number(flag(args, '--port') ?? 9098);
  const tailnet = args.includes('--tailnet');
  const tailnetAddr = tailnet ? relay.tailnetAddr() : null;
  return relay.start(RELAY, { serial, port, tailnetAddr, tailnetPort: tailnet ? Number(flag(args, '--tailnet-port') ?? 0) : null });
}

/**
 * Frame statistics of a running app: the UI toolkit's frames (`dumpsys gfxinfo`: janky share, frame-time percentiles) and, per
 * surface of the app (a GL or Vulkan scene in a SurfaceView, a browser's content surface), the frames SurfaceFlinger presented
 * and their rate. `--reset` clears both first: reset, use the screen for a few seconds, then read. Reads only; changes nothing else.
 */
function gfx([pkg, ...rest], cwd, serial) {
  launchArgs(pkg); // the same package-name check as launch
  const reset = rest.includes('--reset');
  const r = adb(['-s', serial, 'shell', 'dumpsys', 'gfxinfo', pkg, ...(reset ? ['reset'] : [])]);
  if (r.status !== 0) fail(`adb dumpsys gfxinfo failed: ${String(r.stderr).trim()}`);
  if (/No process found/i.test(r.stdout)) fail(`${pkg} is not running: launch it first`);
  const sf = (...a) => adb(['-s', serial, 'shell', 'dumpsys', 'SurfaceFlinger', ...a]).stdout;
  // the device shell gets one command line: names (with spaces, brackets) go in single quotes, so a name with one is skipped
  const layers = packageLayers(sf('--list'), pkg).filter((n) => !n.includes("'"));
  if (reset) { for (const n of layers) sf('--latency-clear', `'${n}'`); return { serial, package: pkg, reset: true }; }
  const s = parseGfx(r.stdout);
  if (!s) fail(`${pkg} is not running (or has drawn nothing): launch it first`);
  const surfaces = layers.map((n) => ({ layer: n, ...latencyFps(sf('--latency', `'${n}'`)) })).filter((x) => x.frames > 0).sort((x, y) => y.frames - x.frames);
  return { serial, package: pkg, ...s, surfaces };
}

// Android's "Remove animations": the three animation scales at 0 (apps see ValueAnimator.areAnimatorsEnabled() false).
// `on` remembers the values it replaced (per device, the first time), `off` puts exactly those back (deleting unset ones).
const SCALES = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];
function reducedMotion([sub], cwd, serial) {
  if (!['on', 'off', 'status'].includes(sub)) fail('usage: mis android reduced-motion on|off|status [--serial <serial>]');
  const sh = (...a) => { const r = adb(['-s', serial, 'shell', 'settings', ...a]); if (r.status !== 0) fail(`adb settings failed: ${String(r.stderr).trim()}`); return r.stdout.trim(); };
  const read = () => Object.fromEntries(SCALES.map((k) => [k, sh('get', 'global', k)]));
  const saved = readHome('android-motion.json', {}) ?? {};
  if (sub === 'on') {
    if (!saved[serial]) writeHome('android-motion.json', { ...saved, [serial]: read() });
    for (const k of SCALES) sh('put', 'global', k, '0');
  } else if (sub === 'off') {
    const back = saved[serial] ?? Object.fromEntries(SCALES.map((k) => [k, '1.0']));
    for (const k of SCALES) back[k] === 'null' ? sh('delete', 'global', k) : sh('put', 'global', k, back[k]);
    const { [serial]: _, ...rest } = saved;
    writeHome('android-motion.json', rest);
  }
  const scales = read();
  return { serial, reduced: SCALES.every((k) => Number(scales[k]) === 0 && scales[k] !== 'null'), scales };
}

const ON_DEVICE = {
  gfx, 'reduced-motion': reducedMotion,
  shot, install,
  ui: (a, cwd, serial) => ({ serial, nodes: uiNodes(serial) }),
  tap: ([x, y], cwd, serial) => (input(serial, 'tap', { x, y }), { serial, tapped: [Number(x), Number(y)] }),
  swipe: ([x1, y1, x2, y2, ms], cwd, serial) => (input(serial, 'swipe', { x1, y1, x2, y2, ms }), { serial, swiped: true }),
  type: ([text], cwd, serial) => (input(serial, 'text', { text }), { serial, typed: text }),
  key: ([key], cwd, serial) => (input(serial, 'key', { key }), { serial, key }),
  launch: ([pkg], cwd, serial) => (launch(serial, pkg), { serial, launched: pkg }),
};

export function android([sub, ...rest], cwd) {
  const args = [...rest];
  if (sub === 'devices') return listDevices();
  if (sub === 'avds') return avds();
  if (sub === 'boot') return boot(args);
  if (sub === 'kill') return kill(args);
  if (sub === 'daemon') return daemon(args);
  if (sub === 'mint') return relay.mint(args);
  if (sub === 'tokens') return relay.tokens(args);
  if (!ON_DEVICE[sub]) return fail(USAGE);
  const serial = pickSerial(flag(args, '--serial'));
  return ON_DEVICE[sub](args, cwd, serial);
}
