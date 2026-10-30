// M8 R3-1/R3-2: the local-only browser (`mis browse start --local-only`). Every exfiltration path the round-3 verifier found
// is retried against "remote" listeners on this machine's non-loopback address (by IP and by a name mapped to it), and the
// bytes they receive are counted. The same harness in a normal browser shows the leak, so a 0 means the path is closed.
// Where no Chrome exists, every case asserts BLOCKED instead.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { browserLock, makeRepo, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const chrome = findChrome();
// The "remote" destination is a listener on a non-loopback interface of this machine (no internet). A machine without one
// cannot run the measurement: that fails loudly (below) instead of passing silently.
const LAN = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
const SITE = fileURLToPath(new URL('../fixtures/exfil-site.mjs', import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'mis-browse-lo-home-'));
const ENV = { MIS_STATE_HOME: HOME, MIS_BROWSE_IDLE_MS: '300000', MIS_BROWSE_HEADLESS_ONLY: '1',
  MIS_BROWSE_CHROME_ARGS: `--host-resolver-rules=MAP lan.test ${LAN}, MAP *.test 127.0.0.1` };
let dir, server, port, base, secret, targets;
const b = (...args) => mis(dir, ['browse', ...args], { env: ENV });
const ok = (r) => { assert.equal(r.code, 0, `exit ${r.code}\n${r.err}${r.out}`); return r.json !== null && typeof r.json === 'object' ? r.json : r.out; };
const failed = (r, re) => { assert.notEqual(r.code, 0, r.out); assert.match(r.err, re); return r; };
const blocked = (r) => failed(r, /BLOCKED: no Chrome, Chromium or Edge/);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const local = (path) => JSON.parse(execFileSync(process.execPath, ['-e', `fetch('${base}${path}').then((r) => r.text()).then((t) => process.stdout.write(t))`], { encoding: 'utf8' }) || 'null');
const received = () => local('/log');
const reset = () => execFileSync(process.execPath, ['-e', `fetch('${base}/reset')`]);
const chromeCmd = () => execFileSync('ps', ['-ww', '-p', String(ok(b('status')).chromePid), '-o', 'command='], { encoding: 'utf8' });
const attack = (kind) => `${base}/attack?kind=${kind}&t=${encodeURIComponent(JSON.stringify(targets))}&udp=${LAN}:${port.udp}`;

let unlock = () => {};
before(async () => {
  unlock = await browserLock();
  assert.ok(LAN, 'this test needs a non-loopback IPv4 interface to stand in for a remote host');
  dir = makeRepo();
  secret = join(dir, 'secret.txt'); writeFileSync(secret, 'SECRET-TOKEN-42');
  server = spawn(process.execPath, [SITE, LAN], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [line] = await once(server.stdout, 'data');
  port = JSON.parse(String(line));
  base = `http://127.0.0.1:${port.local}`;
  targets = [`http://${LAN}:${port.tcp}`, `http://lan.test:${port.tcp}`];
});
after(() => {
  try {
    if (chrome) b('stop');
    server.kill();
    rmSync(HOME, { recursive: true, force: true });
  } finally { unlock(); }
});

// event waits end as soon as the event happens; the bound only matters under heavy load (load avg 20-60 exceeded 20 s)
const until = (fn, what, ms = 120000) => {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); pause(200); }
};
const closeHolder = () => { const holder = ok(b('tabs')).find((t) => t.active).id; ok(b('newtab', `${base}/next`)); ok(b('closetab', String(holder))); };
/** The R3-1/R3-2 paths: [name, attack page kind, loopback marker it sends right before its remote send, how it is triggered] */
const PATHS = [
  ['Service Worker', 'sw', 'worker'], ['SharedWorker', 'shared', 'worker'],
  ['another local document (sessionStorage)', 'nav-storage', 'moved'], ['another local document (?query)', 'nav-query', 'moved'],
  ['WebSocket', 'ws', 'ws'], ['WebRTC TURN/STUN (UDP)', 'webrtc', 'webrtc'],
  ['pagehide beacon + keepalive on closetab', 'pagehide', 'pagehide', closeHolder],
  ...[1, 2, 3].map((n) => [`pagehide keepalive on goto (race, try ${n})`, 'pagehide', 'pagehide', () => b('goto', `${base}/next`)]),
];
/** Run one path (file attached with or without --remote) and return what the remote listeners got, once its marker arrived. */
function attempt([name, kind, marker, finish = () => b('click', '#go')], remote) {
  reset();
  ok(b('newtab', attack(kind)));
  if (kind === 'sw') until(() => ok(b('js', 'navigator.serviceWorker.controller ? 1 : 0')).trim() === '1', `${name}: service worker active`);
  b('upload', '#f', secret, ...(remote ? ['--remote'] : [])); // a command that saw a blocked request fails; what counts is what reached the listeners
  finish();
  until(() => local('/marks').includes(marker), `${name}: the attack ran (marker ${marker})`);
  return received;
}
test('local-only: start --local-only records the mode, launches Chrome with the network closed and loopback open', () => {
  if (!chrome) return blocked(b('start', '--local-only'));
  const s = ok(b('start', '--local-only'));
  assert.equal(s.running, true); assert.equal(s.localOnly, true);
  assert.equal(JSON.parse(readFileSync(join(s.stateDir, 'state.json'), 'utf8')).localOnly, true);
  const cmd = chromeCmd();
  for (const f of [/--proxy-server=http:\/\/127\.0\.0\.1:\d+/, /--proxy-bypass-list=<-loopback>;localhost;\*\.localhost;127\.0\.0\.1;\[::1\]/,
    /--host-resolver-rules=MAP lan\.test [\d.]+, MAP \*\.test 127\.0\.0\.1, MAP \* ~NOTFOUND, EXCLUDE localhost, EXCLUDE \*\.localhost, EXCLUDE 127\.0\.0\.1, EXCLUDE ::1/,
    /--webrtc-ip-handling-policy=disable_non_proxied_udp/]) assert.match(cmd, f);
  assert.equal((cmd.match(/--host-resolver-rules=/g) ?? []).length, 1, 'one merged rule set (Chrome uses the last one given)');
  for (const u of [base, `http://localhost:${port.local}`, `http://[::1]:${port.local}`, `http://app.localhost:${port.local}`]) {
    assert.match(ok(b('goto', `${u}/next`)), /\(200\)/, u);
  }
  reset();
  for (const u of targets) failed(b('goto', `${u}/nav`), /cannot open|ERR_/);
  assert.deepEqual(received(), [], 'a plain navigation to the "remote" host does not reach it');
  assert.equal(ok(b('start', '--local-only')).pid, s.pid, 'same mode: the running daemon is kept');
});

test('local-only: every R3-1/R3-2 path runs (its loopback marker arrives) and delivers 0 bytes to the remote listeners (IP and mapped name)', (t) => {
  if (!chrome) return blocked(b('start', '--local-only'));
  assert.equal(ok(b('status')).localOnly, true);
  for (const p of PATHS) {
    const got = attempt(p, false);
    pause(1500); // late sends (keepalive, retries) get time to arrive too
    const r = got();
    t.diagnostic(`local-only ${p[0]}: ${r.length} packets/chunks, ${r.reduce((n, g) => n + g.bytes, 0)} bytes`);
    assert.deepEqual(r, [], `${p[0]}: nothing may reach the remote listeners`);
  }
});

test('local-only: upload needs no confirmation; connect is refused; handoff/resume keep the network closed; mis pdf fails when a held page tried to send', () => {
  if (!chrome) return blocked(b('start', '--local-only'));
  ok(b('goto', `${base}/attack?kind=none`));
  assert.match(ok(b('upload', '#f', secret)), /Uploaded 1 file/);
  failed(b('connect', '--profile-dir', join(dir, 'prof')), /connect[\s\S]*local-only/);
  ok(b('handoff', 'check'));
  assert.match(chromeCmd(), /--proxy-server=http:\/\/127\.0\.0\.1:\d+[\s\S]*--webrtc-ip-handling-policy=disable_non_proxied_udp/);
  ok(b('resume'));
  assert.match(chromeCmd(), /--proxy-server=http:\/\/127\.0\.0\.1:\d+[\s\S]*--webrtc-ip-handling-policy=disable_non_proxied_udp/);
  assert.equal(ok(b('status')).localOnly, true);
  // a page that holds a file keeps trying to post it: the internal pdf render must report the blocked requests too
  ok(b('newtab', attack('interval')));
  b('upload', '#f', secret);
  writeFileSync(join(dir, 'doc.md'), '# Doc\n\ntext\n');
  failed(mis(dir, ['pdf', 'doc.md'], { env: ENV }), /blocked[\s\S]*\/i/);
  // the page posts every 50ms, so any command while it is open (closing it too) may report a blocked request; it is the active tab
  b('closetab');
  assert.ok(!ok(b('tabs')).some((t) => t.url.includes('kind=interval')), 'the holding tab was closed');
});

test('normal browser (control): plain upload is refused, and the same harness measures every path leaking after upload --remote', (t) => {
  if (!chrome) return blocked(b('start'));
  const s = ok(b('start'));
  assert.equal(s.localOnly, false);
  assert.doesNotMatch(chromeCmd(), /--proxy-server/);
  ok(b('goto', `${base}/attack?kind=none`));
  failed(b('upload', '#f', secret), /local-only[\s\S]*--remote/);
  for (const p of PATHS) {
    const got = attempt(p, true);
    // WebRTC goes by UDP; every other path by TCP to the IP and to the mapped name (a race may deliver only one of them)
    const want = (g) => g.proto === (p[1] === 'webrtc' ? 'udp' : 'tcp');
    const r = until(() => { const x = got(); return x.some(want) && x; }, `${p[0]}: the control run reaches the listener`);
    t.diagnostic(`normal ${p[0]}: ${r.length} packets/chunks, ${r.reduce((n, g) => n + g.bytes, 0)} bytes; ${r.map((g) => g.proto === 'udp' ? `udp ${g.bytes}B` : g.head).join(' | ')}`);
    if (p[1] === 'sw') until(() => got().filter((g) => /POST \/worker/.test(g.head)).length === 2, 'both the IP and the mapped name to be reached');
  }
  ok(b('stop'));
});
