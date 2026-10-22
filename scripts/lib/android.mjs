// Android devices and emulators over adb (user decision 2026-10-22, iOS-equivalent scope). No in-app bridge:
// adb reads screens and UI trees and sends input, so there is nothing to remove before shipping.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fail } from './cli-util.mjs';

/** An SDK tool (adb, emulator): ANDROID_HOME, ANDROID_SDK_ROOT, the default macOS SDK, then PATH. */
export function sdkTool(name) {
  const sub = name === 'adb' ? 'platform-tools' : 'emulator';
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk')].filter(Boolean);
  return roots.map((r) => join(r, sub, name)).find(existsSync) ?? name;
}

export function devicesFromAdb(text) {
  return text.split('\n').slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state] = l.split(/\s+/);
    return { serial, state, model: /\bmodel:(\S+)/.exec(l)?.[1] ?? null, emulator: serial.startsWith('emulator-') };
  });
}

export function deviceProfile(devices) {
  return devices.some((d) => d.state === 'device' && !d.emulator) ? { devices }
    : { devices, blocked: 'no connected Android device: on-device QA is BLOCKED (emulator results do not count as device verification)' };
}

export function adb(args, opts = {}) {
  return spawnSync(sdkTool('adb'), args, { encoding: 'utf8', timeout: 60000, ...opts });
}

export function listDevices() {
  const r = adb(['devices', '-l']);
  if (r.status !== 0) return { devices: [], blocked: 'adb is unavailable (install Android SDK platform-tools): Android QA is BLOCKED' };
  // A network emulator (e.g. host:5555) has no emulator- serial; the qemu property tells.
  const devices = devicesFromAdb(r.stdout).map((d) => (d.emulator || d.state !== 'device' ? d
    : { ...d, emulator: adb(['-s', d.serial, 'shell', 'getprop', 'ro.kernel.qemu']).stdout.trim() === '1' }));
  return deviceProfile(devices);
}

/** --serial, else the only online device or emulator. */
export function pickSerial(serial) {
  if (serial) return serial;
  const online = listDevices().devices.filter((d) => d.state === 'device');
  if (online.length === 1) return online[0].serial;
  return fail(online.length ? `more than one device is online (${online.map((d) => d.serial).join(', ')}): pass --serial <serial>`
    : 'BLOCKED: no online Android device or emulator (mis android avds, then mis android boot <avd>)');
}

const int = (v, name) => {
  if (!/^\d+$/.test(String(v ?? ''))) fail(`${name} must be a non-negative integer`);
  return String(v);
};

/** argv after `adb shell input`; validated because the device shell re-parses it. */
export function inputArgs(action, p) {
  if (action === 'tap') return ['tap', int(p.x, 'x'), int(p.y, 'y')];
  if (action === 'swipe') return ['swipe', ...['x1', 'y1', 'x2', 'y2'].map((k) => int(p[k], k)), int(p.ms ?? 300, 'ms')];
  if (action === 'key') {
    if (!/^(KEYCODE_[A-Z0-9_]+|\d+)$/.test(String(p.key ?? ''))) fail('key must be a KEYCODE_* name or a number');
    return ['keyevent', String(p.key)];
  }
  if (action === 'text') {
    const t = String(p.text ?? '');
    if (!t || !/^[A-Za-z0-9 .,_@:/+=-]+$/.test(t)) fail('text may only contain letters, digits, spaces and . , _ @ : / + = -');
    return ['text', t.replaceAll(' ', '%s')];
  }
  return fail(`unknown input action ${action}`);
}

/** argv after `adb -s <serial> shell` that opens an app's launcher activity. */
export function launchArgs(pkg) {
  if (!/^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/.test(String(pkg ?? ''))) fail('package must look like com.example.app');
  return ['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'];
}

const ok = (r, what) => (r.status === 0 ? r : fail(`adb ${what} failed: ${String(r.stderr || r.error?.message || '').trim()}`));
export const screenshot = (serial) => ok(adb(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' }), 'screencap').stdout;
export const uiNodes = (serial) => nodesFromUiXml(ok(adb(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty']), 'uiautomator dump').stdout);
export const input = (serial, action, p) => { ok(adb(['-s', serial, 'shell', 'input', ...inputArgs(action, p)]), `input ${action}`); };
export const launch = (serial, pkg) => { ok(adb(['-s', serial, 'shell', ...launchArgs(pkg)]), 'launch'); };

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENT[e]);

export function nodesFromUiXml(xml) {
  return [...xml.matchAll(/<node\b([^>]*?)\/?>/g)].map(([, attrs]) => {
    const a = (k) => unxml(new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1] ?? '');
    const [x1, y1, x2, y2] = (a('bounds').match(/\d+/g) ?? [0, 0, 0, 0]).map(Number);
    return { text: a('text'), id: a('resource-id'), desc: a('content-desc'), class: a('class'), clickable: a('clickable') === 'true',
      center: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)] };
  });
}
