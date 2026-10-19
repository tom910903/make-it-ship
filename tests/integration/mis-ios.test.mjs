import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis, git, ROOT } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const TPL = join(ROOT, 'templates', 'ios-debug-bridge');

test('bridge template: every Swift source is wrapped in #if DEBUG, listens on loopback only, documents removal', () => {
  const dir = join(TPL, 'Sources', 'DebugBridge');
  const files = readdirSync(dir).filter((f) => f.endsWith('.swift'));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const code = readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
    assert.equal(code[0].trim(), '#if DEBUG', `${f} starts with #if DEBUG`);
    assert.equal(code.at(-1).trim(), '#endif', `${f} ends with #endif`);
  }
  const src = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  assert.match(src, /127\.0\.0\.1/);
  assert.doesNotMatch(src, /0\.0\.0\.0/);
  assert.match(readFileSync(join(TPL, 'Package.swift'), 'utf8'), /\.iOS\(/);
  assert.match(readFileSync(join(TPL, 'README.md'), 'utf8'), /mis ios bridge-scan/);
});

test('bridge-scan finds leftover bridge code; ship is NOT READY (PARTIAL) until it is removed', () => {
  const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } };
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'App/AppMain.swift': 'import SwiftUI\n#if DEBUG\nimport DebugBridge\n#endif\n@main struct A: App { init() {\n#if DEBUG\nDebugBridge.start()\n#endif\n} var body: some Scene { WindowGroup { Text("x") } } }\n' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  const scan = ok(mis(dir, ['ios', 'bridge-scan']));
  assert.deepEqual(scan.files, ['App/AppMain.swift']);
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']));
  ok(mis(dir, ['task', 'T1', 'start'])); ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  const s = ok(mis(dir, ['ship']));
  assert.equal(s.ready, false);
  assert.equal(s.verdict, 'PARTIAL');
  assert.ok(s.reasons.some((r) => /debug bridge/i.test(r)));
  write(dir, { 'App/AppMain.swift': 'import SwiftUI\n@main struct A: App { var body: some Scene { WindowGroup { Text("x") } } }\n' });
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  assert.equal(ok(mis(dir, ['ship'])).ready, true);
});

test('ios devices: parsing devicectl output; no connected device → device QA BLOCKED (never passed)', async () => {
  const { devicesFromDevicectl, deviceProfile } = await import('../../scripts/lib/ios.mjs');
  assert.deepEqual(devicesFromDevicectl({ result: { devices: [] } }), []);
  const one = { result: { devices: [{ identifier: 'ABC', deviceProperties: { name: 'Mason iPhone' }, connectionProperties: { tunnelState: 'connected' }, hardwareProperties: { platform: 'iOS' } },
    { identifier: 'W1', deviceProperties: { name: 'Watch' }, connectionProperties: { tunnelState: 'unavailable' }, hardwareProperties: { platform: 'watchOS' } }] } };
  assert.deepEqual(devicesFromDevicectl(one), [{ id: 'ABC', name: 'Mason iPhone', connected: true }]);
  assert.match(deviceProfile([]).blocked, /no connected iOS device/);
  assert.equal(deviceProfile([{ id: 'ABC', name: 'x', connected: true }]).blocked, undefined);
});
