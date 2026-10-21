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
import { makeRepo, mis } from '../helpers.mjs';
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

before(async () => {
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
  if (chrome) b('stop');
  server.kill();
  rmSync(HOME, { recursive: true, force: true });
});

/** One R3 path: open the attack page, attach the file, trigger the send, then `finish` (e.g. close the tab). */
function run(kind, finish = () => b('click', '#go')) {
  const tab = ok(b('newtab', attack(kind)));
  if (kind === 'sw') ok(b('wait', '--load'));
  b('upload', '#f', secret); // a command that saw a blocked request fails; what counts is what reached the listeners
  finish(tab);
  pause(2500);
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

test('local-only: every R3-1/R3-2 path delivers 0 bytes to the remote listeners (IP and mapped name)', () => {
  if (!chrome) return blocked(b('start', '--local-only'));
  assert.equal(ok(b('status')).localOnly, true);
  const paths = {
    'Service Worker': () => run('sw'),
    SharedWorker: () => run('shared'),
    'another local document (sessionStorage)': () => run('nav-storage'),
    'another local document (?query)': () => run('nav-query'),
    'WebSocket': () => run('ws'),
    'WebRTC TURN/STUN (UDP)': () => run('webrtc'),
    'pagehide beacon + keepalive on closetab': () => run('pagehide', () => {
      const holder = ok(b('tabs')).find((t) => t.active).id;
      ok(b('newtab', `${base}/next`)); ok(b('closetab', String(holder)));
    }),
  };
  for (let i = 0; i < 3; i++) paths[`pagehide keepalive on goto (race, try ${i + 1})`] = () => run('pagehide', () => b('goto', `${base}/next`));
  for (const [name, attempt] of Object.entries(paths)) {
    reset();
    attempt();
    assert.deepEqual(received(), [], `${name}: nothing may reach the remote listeners`);
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
  ok(b('closetab'));
});

test('normal browser (control): plain upload is refused, and the same harness measures the leak a page script makes after upload --remote', () => {
  if (!chrome) return blocked(b('start'));
  const s = ok(b('start'));
  assert.equal(s.localOnly, false);
  assert.doesNotMatch(chromeCmd(), /--proxy-server/);
  ok(b('goto', `${base}/attack?kind=none`));
  failed(b('upload', '#f', secret), /local-only[\s\S]*--remote/);
  for (const [kind, want] of [['sw', /tcp/], ['webrtc', /udp/]]) {
    reset();
    ok(b('newtab', attack(kind)));
    if (kind === 'sw') ok(b('wait', '--load'));
    ok(b('upload', '#f', secret, '--remote'));
    b('click', '#go');
    pause(2500);
    const got = received();
    assert.ok(got.some((g) => want.test(g.proto) && g.bytes > 0), `${kind}: the control run reaches the listener: ${JSON.stringify(got)}`);
    if (kind === 'sw') {
      assert.ok(got.some((g) => /POST \/worker/.test(g.head)), JSON.stringify(got));
      assert.equal(got.filter((g) => /POST \/worker/.test(g.head)).length, 2, 'both the IP and the mapped name were reached');
    }
  }
  ok(b('stop'));
});
