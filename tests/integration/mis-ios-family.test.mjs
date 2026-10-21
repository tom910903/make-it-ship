// M9-D D4: iOS device family — no device is BLOCKED, ios sync shows the diff and applies only with --apply,
// the QA relay binds loopback by default and needs a minted token on the tailnet listener (stub tailscale, stub bridge).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, chmodSync, cpSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis, fakeHome, ROOT } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const STUB = fileURLToPath(new URL('../fixtures/http-stub.mjs', import.meta.url));
let server, base;
before(async () => {
  server = spawn(process.execPath, [STUB], { stdio: ['ignore', 'pipe', 'inherit'] });
  base = `http://127.0.0.1:${String((await once(server.stdout, 'data'))[0]).trim()}`;
});
after(() => server.kill());

test('without a connected device, device QA is BLOCKED (xcrun devicectl stub fails)', () => {
  const h = fakeHome();
  writeFileSync(join(h.bin, 'xcrun'), '#!/bin/sh\nexit 1\n'); chmodSync(join(h.bin, 'xcrun'), 0o755);
  const r = ok(mis(makeRepo(), ['ios', 'devices'], { env: { ...h.env, PATH: `${h.bin}:/usr/bin:/bin` } }));
  assert.deepEqual(r.devices, []); assert.match(r.blocked, /BLOCKED/);
});

test('mis ios sync shows the template diff and overwrites only with --apply', () => {
  const dir = makeRepo();
  cpSync(join(ROOT, 'templates/ios-debug-bridge'), join(dir, 'Bridge'), { recursive: true });
  const swift = join(dir, 'Bridge/Sources/DebugBridge/DebugBridge.swift');
  writeFileSync(swift, readFileSync(swift, 'utf8').replace('#endif', '// local edit\n#endif'));
  const d = ok(mis(dir, ['ios', 'sync']));
  assert.deepEqual(d.changed, ['Sources/DebugBridge/DebugBridge.swift']);
  assert.match(d.diff, /-\/\/ local edit/);
  assert.match(readFileSync(swift, 'utf8'), /local edit/, 'not applied without --apply');
  assert.deepEqual(ok(mis(dir, ['ios', 'sync', '--apply'])).applied, ['Sources/DebugBridge/DebugBridge.swift']);
  assert.equal(readFileSync(swift, 'utf8'), readFileSync(join(ROOT, 'templates/ios-debug-bridge/Sources/DebugBridge/DebugBridge.swift'), 'utf8'));
  assert.deepEqual(ok(mis(dir, ['ios', 'sync'])).changed, []);
  assert.match(mis(makeRepo(), ['ios', 'sync']).err, /no debug bridge copy/);
});

test('mis ios daemon relays loopback traffic to the bridge; the tailnet listener needs a minted, unexpired token; stop ends it', async () => {
  const h = fakeHome();
  writeFileSync(join(h.bin, 'tailscale'), '#!/bin/sh\necho 127.0.0.1\n'); chmodSync(join(h.bin, 'tailscale'), 0o755);
  const env = { ...h.env, PATH: `${h.bin}:/usr/bin:/bin` };
  const dir = makeRepo();
  assert.match(mis(dir, ['ios', 'daemon', 'start'], { env }).err, /BLOCKED: --target/);
  try {
    const s = ok(mis(dir, ['ios', 'daemon', 'start', '--target', base, '--port', '0', '--tailnet'], { env }));
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/ok`)).status, 200, 'loopback needs no token');
    const remote = `http://${s.tailnet}:${s.tailnetPort}/ok`;
    assert.equal((await fetch(remote)).status, 401);
    const m = ok(mis(dir, ['ios', 'mint', 'agent1'], { env }));
    assert.equal(statSync(join(h.state, 'ios-qa/allowlist.json')).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(join(h.state, 'ios-qa/allowlist.json'), 'utf8'), new RegExp(m.token), 'only the hash is stored');
    assert.equal((await fetch(remote, { headers: { authorization: `Bearer ${m.token}` } })).status, 200);
    ok(mis(dir, ['ios', 'tokens', 'revoke', 'agent1'], { env }));
    assert.equal((await fetch(remote, { headers: { authorization: `Bearer ${m.token}` } })).status, 401);
    assert.equal(ok(mis(dir, ['ios', 'daemon', 'status'], { env })).running, true);
  } finally {
    assert.equal(ok(mis(dir, ['ios', 'daemon', 'stop'], { env })).stopped, true);
  }
  assert.equal(ok(mis(dir, ['ios', 'daemon', 'status'], { env })).running, false);
  const local = ok(mis(dir, ['ios', 'daemon', 'start', '--target', base, '--port', '0'], { env }));
  try { assert.equal(local.tailnet, undefined, 'loopback only by default'); } finally { ok(mis(dir, ['ios', 'daemon', 'stop'], { env })); }
});
