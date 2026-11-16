// Android family (user decision 2026-10-22): adb stub on PATH; emulators never count as device verification,
// more than one online device needs --serial, input is validated before adb, and the relay exposes only fixed
// endpoints with tailnet tokens separate from the iOS relay's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { makeRepo, mis, fakeHome, SYS_PATH } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GFX = `Applications Graphics Acceleration Info:
** Graphics info for pid 4242 [com.android.settings] **
Stats since: 123ns
Total frames rendered: 240
Janky frames: 12 (5.00%)
Janky frames (legacy): 30 (12.50%)
50th percentile: 8ms
90th percentile: 14ms
95th percentile: 18ms
99th percentile: 32ms
Number Missed Vsync: 2
`;
// SurfaceFlinger layer list as API 34+ prints it; OLD_SFLIST is the one-name-per-line form of older Android.
const SFLIST = `RequestedLayerState{Leaf:0:0#5 parentId=4}
RequestedLayerState{ActivityRecord{1 u0 com.android.settings/.Settings t5}#40 parentId=3}
RequestedLayerState{com.android.settings/com.android.settings.Settings#50 parentId=40}
RequestedLayerState{6ccdc74 SurfaceView[com.android.settings/com.android.settings.Settings](BLAST)#52 parentId=51}
RequestedLayerState{com.other.app/x.Main#60 parentId=1}
`;
const OLD_SFLIST = 'Leaf:0:0#5\ncom.android.settings/com.android.settings.Settings#50\n6ccdc74 SurfaceView[com.android.settings/com.android.settings.Settings](BLAST)#52\ncom.other.app/x.Main#60\n';
const XML = '<?xml version="1.0"?><hierarchy><node text="Settings" resource-id="" class="android.widget.TextView" content-desc="" clickable="true" bounds="[0,0][100,50]" /></hierarchy>UI hierchary dumped to: /dev/tty';

/** Stub adb/emulator: logs argv as JSON lines to <home>/adb.log; device list comes from <home>/devices.txt. */
function androidHome(devices) {
  const h = fakeHome(), log = join(h.home, 'adb.log');
  writeFileSync(join(h.home, 'devices.txt'), `List of devices attached\n${devices}\n`);
  writeFileSync(join(h.bin, 'adb'), `#!${process.execPath}
const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const s = a.join(' ');
if (s === 'devices -l') process.stdout.write(fs.readFileSync(${JSON.stringify(join(h.home, 'devices.txt'))}, 'utf8'));
else if (s.endsWith('getprop ro.kernel.qemu')) process.stdout.write(a[1] === '10.0.2.2:5555' ? '1\\n' : '\\n');
else if (s.endsWith('getprop sys.boot_completed')) process.stdout.write('1\\n');
else if (s.endsWith('emu avd name')) process.stdout.write('Medium_Phone\\r\\nOK\\r\\n');
else if (s.endsWith('exec-out screencap -p')) process.stdout.write(Buffer.from(${JSON.stringify(PNG)}, 'base64'));
else if (s.endsWith('exec-out uiautomator dump /dev/tty')) process.stdout.write(${JSON.stringify(XML)});
else if (s.endsWith('dumpsys gfxinfo com.android.settings')) process.stdout.write(${JSON.stringify(GFX)});
else if (s.includes('dumpsys gfxinfo com.example.gone')) process.stdout.write('No process found for: com.example.gone\\n');
else if (a[3] === 'dumpsys' && a[4] === 'SurfaceFlinger') {
  // --latency: refresh period, then desiredPresent actualPresent frameReady per frame (0 = empty slot, INT64_MAX = not presented yet)
  const name = String(a[6] ?? '').replace(/^'|'$/g, ''), lf = ${JSON.stringify(join(h.home, 'sflist.txt'))};
  if (a[5] === '--list') process.stdout.write(fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8') : ${JSON.stringify(SFLIST)});
  else if (a[5] === '--latency') {
    const rows = ['16666667'];
    if (name.includes('SurfaceView[com.android.settings')) {
      for (let i = 0; i < 61; i++) { const t = 1000000000 + i * 16666667; rows.push(t + ' ' + (t + 5) + ' ' + (t + 2)); }
      rows.push('0 9223372036854775807 0', '0 0 0');
    } else if (name === 'com.android.settings/com.android.settings.Settings#50') rows.push('5000 2000000000 5000', '6000 2100000000 6000');
    process.stdout.write(rows.join('\\n') + '\\n');
  }
}
else if (a[3] === 'settings') {
  const f = ${JSON.stringify(join(h.home, 'settings.json'))}, st = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { animator_duration_scale: '1.0', window_animation_scale: '1.0' };
  if (a[4] === 'get') process.stdout.write((st[a[6]] ?? 'null') + '\\n');
  else if (a[4] === 'put') st[a[6]] = a[7];
  else if (a[4] === 'delete') delete st[a[6]];
  fs.writeFileSync(f, JSON.stringify(st));
}
`);
  writeFileSync(join(h.bin, 'emulator'), `#!${process.execPath}
const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(['emulator', ...a]) + '\\n');
if (a[0] === '-list-avds') process.stdout.write('Medium_Phone\\n');
else fs.writeFileSync(${JSON.stringify(join(h.home, 'devices.txt'))}, 'List of devices attached\\nemulator-5554 device model:sdk_gphone64\\n');
`);
  for (const f of ['adb', 'emulator']) chmodSync(join(h.bin, f), 0o755);
  const env = { ...h.env, PATH: `${h.bin}:${SYS_PATH}`, ANDROID_HOME: '', ANDROID_SDK_ROOT: '' };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { ...h, env, calls };
}

test('devices: an emulator alone (serial or qemu property) is BLOCKED for device QA; a phone is not', () => {
  const a = androidHome('emulator-5554 device model:sdk\n10.0.2.2:5555 device model:sdk');
  const r = ok(mis(makeRepo(), ['android', 'devices'], { env: a.env }));
  assert.deepEqual(r.devices.map((d) => d.emulator), [true, true]);
  assert.match(r.blocked, /BLOCKED.*emulator results do not count/);
  const b = androidHome('emulator-5554 device model:sdk\nR5CT1 device usb:1 model:SM_G991N');
  assert.equal(ok(mis(makeRepo(), ['android', 'devices'], { env: b.env })).blocked, undefined);
});

test('without adb, Android QA is BLOCKED', () => {
  const h = fakeHome();
  const r = ok(mis(makeRepo(), ['android', 'devices'], { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}`, ANDROID_HOME: '', ANDROID_SDK_ROOT: '' } }));
  assert.match(r.blocked, /adb is unavailable/);
});

test('control: more than one online device needs --serial; input is validated before adb runs', () => {
  const a = androidHome('emulator-5554 device model:sdk\nR5CT1 device usb:1 model:SM');
  const dir = makeRepo();
  assert.match(mis(dir, ['android', 'tap', '10', '20'], { env: a.env }).err, /more than one device.*--serial/);
  ok(mis(dir, ['android', 'tap', '10', '20', '--serial', 'emulator-5554'], { env: a.env }));
  ok(mis(dir, ['android', 'type', 'hello world', '--serial', 'emulator-5554'], { env: a.env }));
  ok(mis(dir, ['android', 'key', 'KEYCODE_BACK', '--serial', 'emulator-5554'], { env: a.env }));
  ok(mis(dir, ['android', 'launch', 'com.android.settings', '--serial', 'emulator-5554'], { env: a.env }));
  for (const bad of [['type', '$(reboot)'], ['type', 'a;reboot'], ['type', '`id`'], ['tap', '1;reboot', '2'], ['launch', 'x;reboot']])
    assert.notEqual(mis(dir, ['android', ...bad, '--serial', 'emulator-5554'], { env: a.env }).code, 0, bad.join(' '));
  const input = a.calls().filter((c) => c.includes('input') || c.includes('monkey'));
  assert.deepEqual(input, [
    ['-s', 'emulator-5554', 'shell', 'input', 'tap', '10', '20'],
    ['-s', 'emulator-5554', 'shell', 'input', 'text', 'hello%sworld'],
    ['-s', 'emulator-5554', 'shell', 'input', 'keyevent', 'KEYCODE_BACK'],
    ['-s', 'emulator-5554', 'shell', 'monkey', '-p', 'com.android.settings', '-c', 'android.intent.category.LAUNCHER', '1'],
  ], 'rejected input never reached adb');
});

test('shot and ui: a PNG file and a node list with tap centers', () => {
  const a = androidHome('emulator-5554 device model:sdk');
  const dir = makeRepo();
  const s = ok(mis(dir, ['android', 'shot', '--out', 'shot.png'], { env: a.env }));
  assert.equal(readFileSync(s.path).toString('base64'), PNG);
  assert.deepEqual(ok(mis(dir, ['android', 'ui'], { env: a.env })).nodes, [{ text: 'Settings', id: '', desc: '', class: 'android.widget.TextView', clickable: true, center: [50, 25] }]);
});

test('avds and boot: boot waits for sys.boot_completed and reports the emulator serial', () => {
  const a = androidHome('');
  const dir = makeRepo();
  assert.deepEqual(ok(mis(dir, ['android', 'avds'], { env: a.env })).avds, ['Medium_Phone']);
  assert.match(mis(dir, ['android', 'boot', 'x;y'], { env: a.env }).err, /usage/);
  const b = ok(mis(dir, ['android', 'boot', 'Medium_Phone', '--timeout', '20'], { env: a.env }));
  assert.equal(b.serial, 'emulator-5554'); assert.equal(b.booted, true);
  const again = ok(mis(dir, ['android', 'boot', 'Medium_Phone'], { env: a.env }));
  assert.deepEqual(again, { avd: 'Medium_Phone', serial: 'emulator-5554', booted: true, alreadyRunning: true });
  assert.equal(a.calls().filter((c) => c[0] === 'emulator' && c[1] === '-avd').length, 1, 'a running AVD is not started twice');
  assert.match(mis(dir, ['android', 'kill', 'R5CT1'], { env: a.env }).err, /only emulators/);
  ok(mis(dir, ['android', 'kill', 'emulator-5554'], { env: a.env }));
  assert.deepEqual(a.calls().at(-1), ['-s', 'emulator-5554', 'emu', 'kill']);
});

test('relay: fixed endpoints over adb on loopback; tailnet needs an android token (an iOS token does not work)', async () => {
  const a = androidHome('emulator-5554 device model:sdk');
  writeFileSync(join(a.bin, 'tailscale'), '#!/bin/sh\necho 127.0.0.1\n'); chmodSync(join(a.bin, 'tailscale'), 0o755);
  const dir = makeRepo();
  try {
    const s = ok(mis(dir, ['android', 'daemon', 'start', '--port', '0', '--tailnet'], { env: a.env }));
    assert.equal(s.serial, 'emulator-5554');
    const loop = `http://127.0.0.1:${s.port}`;
    assert.deepEqual(await (await fetch(`${loop}/healthz`)).json(), { ok: true, serial: 'emulator-5554' });
    assert.equal(Buffer.from(await (await fetch(`${loop}/screenshot`)).arrayBuffer()).toString('base64'), PNG);
    assert.equal((await (await fetch(`${loop}/ui`)).json()).nodes[0].text, 'Settings');
    const post = (path, body, headers = {}) => fetch(`${loop}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/tap', { x: 5, y: 6 })).status, 200);
    assert.equal((await post('/text', { text: '$(reboot)' })).status, 400);
    assert.equal((await post('/shell', { cmd: 'reboot' })).status, 404, 'no passthrough to adb shell');
    assert.equal((await fetch(`${loop}/tap`)).status, 405, 'input is POST only');
    // a web page can send a no-preflight text/plain POST to loopback, and DNS rebinding sends a foreign Host
    assert.equal((await fetch(`${loop}/tap`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"x":1,"y":1}' })).status, 415);
    const foreign = await new Promise((done) => request(`${loop}/ui`, { headers: { host: 'evil.example:9098' } }, (r) => { r.resume(); done(r.statusCode); }).end());
    assert.equal(foreign, 403);
    assert.deepEqual(a.calls().filter((c) => c.includes('input')), [['-s', 'emulator-5554', 'shell', 'input', 'tap', '5', '6']]);

    const remote = `http://${s.tailnet}:${s.tailnetPort}/healthz`;
    assert.equal((await fetch(remote)).status, 401);
    const iosToken = ok(mis(dir, ['ios', 'mint', 'agent1'], { env: a.env })).token;
    assert.equal((await fetch(remote, { headers: { authorization: `Bearer ${iosToken}` } })).status, 401, 'iOS tokens do not open the Android relay');
    const m = ok(mis(dir, ['android', 'mint', 'agent1'], { env: a.env }));
    assert.equal((await fetch(remote, { headers: { authorization: `Bearer ${m.token}` } })).status, 200);
    assert.equal(ok(mis(dir, ['android', 'tokens'], { env: a.env })).tokens[0].name, 'agent1');
    assert.equal(ok(mis(dir, ['android', 'daemon', 'status'], { env: a.env })).running, true);
  } finally {
    assert.equal(ok(mis(dir, ['android', 'daemon', 'stop'], { env: a.env })).stopped, true);
  }
});

test('gfx: frame statistics of a running app from dumpsys gfxinfo; --reset clears them first; a stopped app is an error', () => {
  const h = androidHome('emulator-5554 device model:sdk_gphone64');
  const r = ok(mis(makeRepo(), ['android', 'gfx', 'com.android.settings'], { env: h.env }));
  const surfaces = [{ layer: '6ccdc74 SurfaceView[com.android.settings/com.android.settings.Settings](BLAST)#52', frames: 61, fps: 60 },
    { layer: 'com.android.settings/com.android.settings.Settings#50', frames: 2, fps: 10 }];
  assert.deepEqual(r, { serial: 'emulator-5554', package: 'com.android.settings', totalFrames: 240, jankyFrames: 12, jankyPercent: 5,
    percentilesMs: { p50: 8, p90: 14, p95: 18, p99: 32 }, surfaces });
  assert.ok(!h.calls().some((c) => c.join(' ').includes('com.other.app')), 'another app\'s layers are never queried');
  writeFileSync(join(h.home, 'sflist.txt'), OLD_SFLIST);
  assert.deepEqual(ok(mis(makeRepo(), ['android', 'gfx', 'com.android.settings', '--serial', 'emulator-5554'], { env: h.env })).surfaces, surfaces, 'older Android list format');
  ok(mis(makeRepo(), ['android', 'gfx', 'com.android.settings', '--reset'], { env: h.env }));
  const calls = h.calls().map((c) => c.join(' '));
  assert.ok(calls.includes('-s emulator-5554 shell dumpsys gfxinfo com.android.settings reset'));
  assert.ok(calls.includes("-s emulator-5554 shell dumpsys SurfaceFlinger --latency-clear 'com.android.settings/com.android.settings.Settings#50'"), 'reset clears the app\'s layers');
  assert.ok(!calls.some((c) => c.includes('com.other.app')));
  assert.match(mis(makeRepo(), ['android', 'gfx', 'com.example.gone'], { env: h.env }).err, /com\.example\.gone is not running/);
  assert.match(mis(makeRepo(), ['android', 'gfx', 'com.example.gone', '--reset'], { env: h.env }).err, /com\.example\.gone is not running/, 'no silent reset of nothing');
  assert.match(mis(makeRepo(), ['android', 'gfx', 'x; reboot'], { env: h.env }).err, /package must look like/);
});

test('reduced-motion: on sets the three animation scales to 0 and remembers them; off puts back exactly what was there', () => {
  const h = androidHome('emulator-5554 device model:sdk_gphone64');
  const run = (...a) => ok(mis(makeRepo(), ['android', 'reduced-motion', ...a], { env: h.env }));
  assert.deepEqual(run('status'), { serial: 'emulator-5554', reduced: false,
    scales: { window_animation_scale: '1.0', transition_animation_scale: 'null', animator_duration_scale: '1.0' } });
  const on = run('on');
  assert.equal(on.reduced, true);
  assert.deepEqual(Object.values(on.scales), ['0', '0', '0']);
  run('on'); // twice: the first saved values stay the ones to restore
  const off = run('off');
  assert.deepEqual(off.scales, { window_animation_scale: '1.0', transition_animation_scale: 'null', animator_duration_scale: '1.0' });
  assert.equal(off.reduced, false);
  assert.match(mis(makeRepo(), ['android', 'reduced-motion', 'maybe'], { env: h.env }).err, /usage: mis android reduced-motion on\|off\|status/);
});
