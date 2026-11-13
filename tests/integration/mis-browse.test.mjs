// Built-in browser against the real Chrome on this machine; where no Chrome exists, every case asserts BLOCKED instead.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserLock, makeRepo, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';
import { decodePng } from '../../scripts/lib/png.mjs';

const chrome = findChrome();
const SITE = fileURLToPath(new URL('../fixtures/browse-site.mjs', import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), 'mis-browse-home-'));
const ENV = { MIS_STATE_HOME: HOME, MIS_BROWSE_IDLE_MS: '180000', MIS_BROWSE_HEADLESS_ONLY: '1',
  MIS_BROWSE_CHROME_ARGS: '--host-resolver-rules=MAP *.test 127.0.0.1' };
let dir, server, base, out;
const b = (...args) => mis(dir, ['browse', ...args], { env: ENV });
const ok = (r) => { assert.equal(r.code, 0, `exit ${r.code}\n${r.err}${r.out}`); return r.json !== null && typeof r.json === 'object' ? r.json : r.out; };
const failed = (r, re) => { assert.notEqual(r.code, 0, r.out); assert.match(r.err, re); return r; };
const blocked = (r) => failed(r, /BLOCKED: no Chrome, Chromium or Edge/);

let unlock = () => {};
before(async () => {
  unlock = await browserLock();
  dir = makeRepo();
  out = mkdtempSync(join(tmpdir(), 'mis-browse-out-'));
  // own process: the mis() helper uses spawnSync, which blocks this process's event loop (an in-process server would hang)
  server = spawn(process.execPath, [SITE], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [line] = await once(server.stdout, 'data');
  base = `http://127.0.0.1:${String(line).trim()}`;
});
after(() => {
  try {
    if (chrome) b('stop');
    server.kill();
    for (const d of [HOME, out]) rmSync(d, { recursive: true, force: true }); // no temp dirs left behind
  } finally { unlock(); }
});
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** poll a sync check until it returns truthy (generous deadline: the machine may be loaded) */
const until = (fn, what, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); pause(200); }
};

test('without a browser every page command is BLOCKED; status still answers', () => {
  const r = mis(dir, ['browse', 'goto', 'about:blank'], { env: { ...ENV, MIS_BROWSER: '/nonexistent/chrome' } });
  blocked(r);
  assert.equal(ok(mis(dir, ['browse', 'status'], { env: { ...ENV, MIS_BROWSER: '/nonexistent/chrome' } })).running, false);
});

test('lifecycle: first command starts one daemon per workspace (state under git-common-dir, token file 0600)', () => {
  if (!chrome) return blocked(b('goto', base));
  assert.equal(ok(b('status')).running, false);
  assert.match(ok(b('goto', base)), /Navigated to .*\(200\)/);
  const s = ok(b('status'));
  assert.equal(s.running, true); assert.equal(s.mode, 'headless');
  assert.match(s.stateDir, /\.git\/make-it-ship\/browse\//);
  assert.equal(statSync(join(s.stateDir, 'state.json')).mode & 0o777, 0o600);
  assert.equal(ok(b('status')).pid, s.pid, 'same daemon reused');
  assert.equal(ok(b('url')).trim(), `${base}/`);
});

test('reading: text, html, links, forms (passwords redacted), data, accessibility', () => {
  if (!chrome) return blocked(b('text'));
  assert.match(ok(b('text')), /Welcome[\s\S]*Bottom/);
  assert.equal(ok(b('html', 'nav')).trim(), '<a href="/next">Next page</a>');
  assert.match(ok(b('links')), new RegExp(`Next page → ${base}/next`));
  const forms = ok(b('forms'));
  const fields = forms[0].fields;
  assert.equal(fields.find((f) => f.name === 'pw').value, '[redacted]');
  assert.ok(fields.find((f) => f.name === 'email'));
  const data = ok(b('data'));
  assert.equal(data.og['og:title'], 'OG Home'); assert.equal(data.jsonld[0].name, 'fx');
  assert.match(ok(b('accessibility')), /\[heading\] "Welcome"/);
});

test('snapshot: @e refs (stable across snapshots), interactive filter, diff, stale-ref detection', () => {
  if (!chrome) return blocked(b('snapshot'));
  const s1 = ok(b('snapshot', '-i'));
  const ref = (text, role) => (text.match(new RegExp(`(@e\\d+) \\[${role}\\] "${role === 'textbox' ? 'Email' : ''}[^"]*`)) ?? [])[1];
  const link = s1.match(/(@e\d+) \[link\] "Next page"/)[1];
  const email = s1.match(/(@e\d+) \[textbox\] "Email"/)[1];
  const target = s1.match(/(@e\d+) \[button\] "Target"/)[1];
  assert.ok(ref(s1, 'textbox'));
  assert.doesNotMatch(s1, /\[heading\]/, '-i lists interactive elements only');
  assert.match(ok(b('snapshot')), /\[heading\] "Welcome" \[level=1\]/);
  assert.match(ok(b('snapshot', '-i')), new RegExp(`${link} \\[link\\] "Next page"`), 'same element keeps its ref');
  ok(b('fill', email, 'me@example.com'));
  assert.equal(ok(b('js', 'document.querySelector("#email").value')).trim(), 'me@example.com');
  ok(b('snapshot', '-D'));
  ok(b('click', '#add'));
  assert.match(ok(b('snapshot', '-D')), /\+ .*\[listitem\]/);
  ok(b('click', '#swap'));
  failed(b('click', target), /stale ref/);
  failed(b('click', '@e999'), /unknown ref/);
});

test('interaction: select, check, hover, type, press Enter submits, scroll, viewport, upload, dialogs', () => {
  if (!chrome) return blocked(b('click', '#add'));
  ok(b('select', '#size', 'Large'));
  assert.equal(ok(b('js', 'document.querySelector("#size").value')).trim(), 'l');
  ok(b('click', '#agree')); assert.equal(ok(b('is', 'checked', '#agree')).trim(), 'true');
  ok(b('hover', '#hover')); assert.equal(ok(b('attrs', '#hover'))['data-hovered'], 'yes');
  assert.equal(ok(b('is', 'visible', '#box')).trim(), 'true');
  ok(b('scroll', '#bottom'));
  assert.ok(Number(ok(b('js', 'scrollY'))) > 500);
  ok(b('viewport', '375x812'));
  assert.equal(ok(b('js', 'innerWidth')).trim(), '375');
  ok(b('viewport', '1280x720'));
  const f = join(out, 'up.txt'); writeFileSync(f, 'hello');
  failed(b('upload', '#file', f), /local-only[\s\S]*--remote/); // a normal browser attaches files only with --remote
  ok(b('upload', '#file', f, '--remote'));
  assert.equal(ok(b('js', 'document.querySelector("#file").files[0].name')).trim(), 'up.txt');
  ok(b('dialog-dismiss'));
  ok(b('click', '#confirm'));
  assert.equal(ok(b('js', 'window.lastConfirm')).trim(), 'false');
  assert.match(ok(b('dialog')), /confirm: Sure\?/);
  ok(b('dialog-accept'));
  ok(b('fill', '#email', 'a@b.c'));
  ok(b('click', '#email'));
  ok(b('type', 'x'));
  ok(b('press', 'Enter'));
  assert.match(ok(b('url')), /\/submitted\?email=a%40b\.cx/);
  ok(b('back')); assert.equal(ok(b('url')).trim(), `${base}/`);
  ok(b('forward')); assert.match(ok(b('url')), /submitted/);
  ok(b('goto', base));
  ok(b('reload'));
  ok(b('wait', '#bottom'));
  failed(b('wait', '#never', '--timeout', '300'), /timed out/);
});

test('inspection: js (with await), eval file, css, console, network, perf', () => {
  if (!chrome) return blocked(b('js', '1'));
  assert.equal(ok(b('js', '1 + 2')).trim(), '3');
  assert.equal(ok(b('js', 'await Promise.resolve(7)')).trim(), '7');
  const f = join(dir, 'probe.js'); writeFileSync(f, 'const t = document.title;\nt.toUpperCase()');
  assert.equal(ok(b('eval', 'probe.js')).trim(), 'FIXTURE HOME');
  failed(b('eval', '/etc/hosts'), /under the working directory/);
  assert.equal(ok(b('css', '#box', 'background-color')).trim(), 'rgb(255, 0, 0)');
  assert.match(ok(b('console', '--errors')), /boom from app/);
  assert.doesNotMatch(ok(b('console', '--errors')), /app loaded/);
  assert.match(ok(b('network')), /GET 200 .*\/app\.js/);
  const perf = ok(b('perf'));
  assert.ok(perf.transferBytes > 0 && perf.requests >= 3, JSON.stringify(perf));
  assert.ok(perf.loadMs >= 0 && perf.ttfbMs >= 0);
  assert.equal(typeof perf.jsBytes, 'number');
});

test('storage/js on local pages run directly; on real sites they need --remote; cdp never runs inside chain', () => {
  if (!chrome) return blocked(b('storage'));
  ok(b('storage', 'set', 'k', 'v'));
  assert.equal(ok(b('storage')).localStorage.k, 'v');
  const site = base.replace('127.0.0.1', 'shop.test');
  assert.match(ok(b('goto', site)), /Navigated/);
  assert.match(ok(b('text')), /Welcome/);
  failed(b('storage'), /--remote/);
  failed(b('js', 'document.cookie'), /--remote/);
  assert.deepEqual(ok(b('storage', '--remote')).localStorage, {});
  failed(b('chain', JSON.stringify([['cdp', 'Runtime.evaluate', '{"expression":"1"}']])), /not allowed inside chain/);
  failed(b('chain', JSON.stringify([['storage']])), /--remote/);
  assert.equal(ok(b('cdp', 'Runtime.evaluate', '{"expression":"6*7","returnByValue":true}')).result.value, 42);
});

test('visuals: full-page, viewport and element screenshots, responsive set, pdf, text diff', () => {
  if (!chrome) return blocked(b('screenshot'));
  ok(b('goto', base));
  const full = join(out, 'full.png'), view = join(out, 'view.png'), el = join(out, 'box.png');
  ok(b('screenshot', full)); ok(b('screenshot', '--viewport', view)); ok(b('screenshot', '#box', el));
  const F = decodePng(readFileSync(full)), V = decodePng(readFileSync(view)), E = decodePng(readFileSync(el));
  assert.equal(V.width, 1280); assert.equal(V.height, 720);
  assert.ok(F.height > 2000, `full page height ${F.height}`);
  assert.equal(E.width, 120); assert.equal(E.height, 80);
  assert.deepEqual([...E.data.subarray(0, 4)], [255, 0, 0, 255]);
  const shots = ok(b('responsive', join(out, 'r')));
  assert.deepEqual(shots.map((p) => decodePng(readFileSync(p)).width), [375, 768, 1280]);
  assert.equal(ok(b('js', 'innerWidth')).trim(), '1280', 'viewport restored');
  const pdf = join(out, 'page.pdf');
  ok(b('pdf', pdf, '--format', 'a4'));
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  assert.match(ok(b('diff', base, `${base}/next`)), /- Welcome[\s\S]*\+ Home/);
  assert.match(ok(b('snapshot', '-i', '-a', '-o', join(out, 'ann.png'))), /annotated screenshot/);
  assert.ok(existsSync(join(out, 'ann.png')));
});

test('tabs and frames', () => {
  if (!chrome) return blocked(b('tabs'));
  ok(b('newtab', `${base}/next`));
  let tabs = ok(b('tabs'));
  assert.equal(tabs.length, 2); assert.equal(tabs.find((t) => t.active).title, 'Next');
  ok(b('tab', String(tabs[0].id)));
  assert.match(ok(b('text')), /Welcome/);
  ok(b('closetab', String(tabs[1].id)));
  assert.equal(ok(b('tabs')).length, 1);
  ok(b('frame', '#frm'));
  assert.match(ok(b('text')), /Inside frame/);
  assert.match(ok(b('snapshot', '-i')), /\[button\] "Frame button"/);
  ok(b('frame', 'main'));
  assert.match(ok(b('text')), /Welcome/);
});

test('chain runs commands in order and stops at the first error', () => {
  if (!chrome) return blocked(b('chain', '[]'));
  const r = ok(b('chain', JSON.stringify([['goto', `${base}/next`], ['text']])));
  assert.match(r[1].result, /Next page/);
  failed(b('chain', JSON.stringify([['goto', base], ['click', '#missing'], ['text']])), /step 2 \(click #missing\)/);
  const f = join(out, 'steps.json'); writeFileSync(f, JSON.stringify([['url']]));
  assert.match(ok(b('chain', f))[0].result, /127\.0\.0\.1/);
});

test('a blob: page and an about:blank popup made by a real site count as that site; opaque origins are not local; file pages are', () => {
  if (!chrome) return blocked(b('js', '1'));
  const site = base.replace('127.0.0.1', 'shop.test');
  ok(b('goto', `${site}/blob.html`));
  until(() => String(ok(b('url'))).startsWith('blob:'), 'the blob page');
  failed(b('js', 'self.origin + " " + localStorage.secret'), /non-local page \(http:\/\/shop\.test:\d+\)[\s\S]*--remote/);
  failed(b('storage'), /--remote/);
  assert.equal(ok(b('js', 'localStorage.secret', '--remote')).trim(), 'S3CR3T');
  ok(b('goto', `${site}/pop.html`));
  ok(b('click', '#open'));
  const popup = until(() => ok(b('tabs')).find((t) => t.url === 'about:blank'), 'the popup tab');
  ok(b('tab', String(popup.id)));
  failed(b('js', 'opener.localStorage.secret'), /--remote/);
  failed(b('chain', JSON.stringify([['storage']])), /--remote/);
  ok(b('closetab', String(popup.id)));
  ok(b('goto', `${base}/xframe`));
  // a remote frame in a local page is judged by the frame, not by the page around it (always selectable)
  assert.match(ok(b('frame', '#x')), /Switched to frame http:\/\/shop\.test:\d+\/next/);
  failed(b('js', '1'), /non-local page \(http:\/\/shop\.test:\d+\)/);
  ok(b('frame', 'main'));
  assert.equal(ok(b('js', 'document.title')).trim(), 'X');
  ok(b('goto', 'data:text/html,<p>x</p>'));
  const opaque = b('js', '1');
  failed(opaque, /non-local page \(opaque origin\)[\s\S]*cannot be shown to be local[\s\S]*--remote/);
  assert.doesNotMatch(opaque.err, /cookies|storage/, 'an opaque document has no cookies or storage of its own');
  writeFileSync(join(dir, 'local.html'), '<title>Local file</title>');
  ok(b('goto', 'local.html'));
  assert.equal(ok(b('js', 'document.title')).trim(), 'Local file', 'file: pages stay local');
});

test('remote upload: sending a file to a non-local page needs --remote (the guard asks); local pages take it directly only in the local-only browser', () => {
  if (!chrome) return blocked(b('upload', '#f', 'x'));
  const f = join(out, 'up2.txt'); writeFileSync(f, 'internal');
  ok(b('goto', `${base}/upload.html`));
  failed(b('upload', '#f', f), /upload without --remote runs only in the local-only browser[\s\S]*start --local-only[\s\S]*--remote/);
  assert.equal(ok(b('js', 'document.querySelector("#f").files.length')).trim(), '0', 'nothing was attached');
  ok(b('goto', `${base.replace('127.0.0.1', 'shop.test')}/upload.html`));
  failed(b('upload', '#f', f), /upload on a non-local page[\s\S]*--remote/);
  failed(b('chain', JSON.stringify([['upload', '#f', f]])), /--remote/);
  assert.equal(ok(b('js', 'document.querySelector("#f").files.length', '--remote')).trim(), '0', 'nothing was attached');
  ok(b('upload', '#f', f, '--remote'));
});

const hits = () => JSON.parse(spawnSync(process.execPath, ['-e', `fetch('${base}/hits').then((r) => r.text()).then((t) => process.stdout.write(t))`], { encoding: 'utf8' }).stdout);
const remoteHits = () => hits().filter((h) => h.host.startsWith('shop.test'));

test('a file attached without --remote never leaves the machine, whatever page holds it and however the page sends it', () => {
  if (!chrome) return blocked(b('upload', '#f', 'x'));
  // unconfirmed upload runs only in the local-only browser; the destination check and the hold stay as a second line
  assert.equal(ok(b('start', '--local-only')).localOnly, true);
  const site = base.replace('127.0.0.1', 'shop.test');
  const f = join(out, 'secret.txt'); writeFileSync(f, 'internal data');
  // the original repro: a local file page whose form posts to a real site
  writeFileSync(join(dir, 'localform.html'), `<form method="post" action="${site}/up" enctype="multipart/form-data"><input type="file" id="f" name="f"><button id="send">Send</button></form>`);
  ok(b('goto', 'localform.html'));
  failed(b('upload', '#f', f), /upload[\s\S]*http:\/\/shop\.test:\d+[\s\S]*--remote/);
  assert.equal(ok(b('js', 'document.querySelector("#f").files.length')).trim(), '0', 'nothing was attached');
  ok(b('goto', `${base}/remoteform.html`));
  failed(b('upload', '#f', f), /http:\/\/shop\.test:\d+\/up[\s\S]*--remote/);
  ok(b('goto', `${base}/formaction.html`));
  failed(b('upload', '#f', f), /http:\/\/shop\.test:\d+\/up[\s\S]*--remote/); // a submit button's formaction counts too
  // page script sends the file: the browser blocks every non-local request while the page holds it
  ok(b('goto', `${base}/jsupload.html`));
  failed(b('upload', '#f', f), /blocked[\s\S]*shop\.test:\d+\/up\?onchange[\s\S]*--remote/);
  failed(b('click', '#send'), /blocked[\s\S]*shop\.test:\d+\/up\?click/);
  failed(b('click', '#redir'), /blocked[\s\S]*shop\.test:\d+\/up\?redirect/);
  b('click', '#popup'); // the popup's request is blocked while click is still settling or just after: either way it must fail
  until(() => ok(b('tabs')).find((t) => t.title === 'blocked' || t.title === 'sent'), 'the popup to try sending');
  assert.ok(ok(b('tabs')).some((t) => t.title === 'blocked'), 'the popup was blocked too');
  ok(b('goto', `${base}/next`)); ok(b('back'));
  b('click', '#send'); // back may restore the page with its file (still blocked) or reload it empty: either way nothing may reach the site
  assert.deepEqual(remoteHits(), [], 'no request reached the remote site');
  // local destinations take the file directly; --remote sends it on purpose; ordinary remote browsing works afterwards
  ok(b('goto', `${base}/localform.html`));
  ok(b('upload', '#f', f));
  assert.match(ok(b('click', '#send')), /→ http:\/\/127\.0\.0\.1:\d+\/up/);
  assert.ok(hits().some((h) => h.host.startsWith('127.0.0.1') && h.url === '/up' && h.bytes > 0));
  // a page that holds a file stays held while it is open; the error points to a normal browser and --remote for a deliberate send
  ok(b('goto', `${base}/jsupload.html`));
  failed(b('upload', '#f', f), /mis browse stop[\s\S]*upload \.\.\. --remote/);
  const holder = ok(b('tabs')).find((t) => t.active).id;
  ok(b('newtab', `${base}/jsupload.html`));
  assert.equal(ok(b('js', '1 + 1')).trim(), '2', 'a tab opened while a hold is armed starts normally');
  ok(b('closetab', String(holder)));
  // even with --remote, the local-only browser cannot reach the site: closing the holder and sending let nothing out
  ok(b('upload', '#f', f, '--remote'));
  b('click', '#send');
  pause(1500);
  assert.deepEqual(remoteHits(), [], 'the local-only network reaches no remote host, --remote or not');
  // passive loads of a held page (a remote image) are blocked and logged, but do not fail unrelated commands
  ok(b('goto', `${base}/img.html`));
  const logos = () => hits().filter((h) => h.url === '/logo.png').length, before = logos(); // the local-only network never loads it; the hold still logs the attempt
  ok(b('upload', '#f', f));
  ok(b('goto', `${base}/img.html`));
  assert.match(ok(b('console')), /blocked GET http:\/\/shop\.test:\d+\/logo\.png/);
  assert.equal(logos(), before);
  // a deliberate send (--remote, the guard asks) goes from a normal browser; ordinary remote browsing works there
  assert.equal(ok(b('start')).localOnly, false);
  ok(b('goto', `${base}/remoteform.html`));
  ok(b('upload', '#f', f, '--remote'));
  assert.match(ok(b('click', '#send')), /→ http:\/\/shop\.test:\d+\/up/);
  assert.equal(remoteHits().length, 1);
  ok(b('goto', `${site}/next`));
});

test('in a chain each goto waits for its own page, so js right after a goto to a real site is refused without --remote', () => {
  if (!chrome) return blocked(b('chain', '[]'));
  const site = base.replace('127.0.0.1', 'shop.test');
  for (let i = 0; i < 3; i++) {
    failed(b('chain', JSON.stringify([['goto', `${base}/next`], ['goto', `${site}/slow`], ['js', 'location.host']])), /step 3 \(js location\.host\)[\s\S]*--remote/);
  }
  const r = ok(b('chain', JSON.stringify([['goto', `${base}/next`], ['goto', `${base}/slow`], ['url']])));
  assert.equal(r[1].result, `Navigated to ${base}/slow (200)`);
  assert.equal(r[2].result, `${base}/slow`);
});

test('back/forward/reload report the page after the navigation; a 204 goto returns instead of hanging', () => {
  if (!chrome) return blocked(b('back'));
  ok(b('goto', base)); ok(b('goto', `${base}/next`));
  assert.equal(ok(b('back')).trim(), `Back to ${base}/`);
  assert.equal(ok(b('forward')).trim(), `Forward to ${base}/next`);
  assert.equal(ok(b('reload')).trim(), `Reloaded ${base}/next`);
  const t0 = Date.now();
  b('goto', `${base}/nocontent`); // Chrome may report the 204 as aborted; what matters is that it returns
  assert.ok(Date.now() - t0 < 25000, `204 took ${Date.now() - t0} ms`);
  assert.equal(ok(b('url')).trim(), `${base}/next`, 'a 204 keeps the current page');
});

test('the DevTools endpoint is a pipe: no DevToolsActivePort file and no TCP port listening in the browser', () => {
  if (!chrome) return blocked(b('status'));
  ok(b('goto', base));
  const s = ok(b('status'));
  const st = JSON.parse(readFileSync(join(s.stateDir, 'state.json'), 'utf8'));
  assert.ok(!existsSync(join(st.profile, 'DevToolsActivePort')));
  const lsof = spawnSync('lsof', ['-nP', '-a', '-p', String(s.chromePid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (!lsof.error) assert.equal(lsof.stdout.trim(), '', `browser listens on TCP:\n${lsof.stdout}`);
});

test('handoff → resume relaunches on the same profile: page and cookies survive', () => {
  if (!chrome) return blocked(b('handoff'));
  ok(b('goto', `${base}/next`));
  ok(b('js', 'document.cookie = "sess=abc; max-age=3600"'));
  assert.match(ok(b('handoff', 'solve the CAPTCHA')), /HANDOFF[\s\S]*mis browse resume/);
  assert.equal(ok(b('status')).mode, 'handoff');
  const r = ok(b('resume'));
  assert.match(r, /RESUMED/); assert.match(r, /\[link\] "Home"/);
  assert.equal(ok(b('url')).trim(), `${base}/next`);
  assert.match(ok(b('js', 'document.cookie')), /sess=abc/);
  assert.equal(ok(b('status')).mode, 'headless');
});

test('resume after the user closed the visible browser reopens the handed-off page', async () => {
  if (!chrome) return blocked(b('handoff'));
  ok(b('goto', `${base}/next`));
  ok(b('handoff'));
  process.kill(ok(b('status')).chromePid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ok(b('status')).running, true, 'daemon waits for resume');
  assert.match(ok(b('resume')), /RESUMED at .*\/next/);
});

test('a crashed daemon: the next command starts a new one and removes the orphaned browser and profile', async () => {
  if (!chrome) return blocked(b('url'));
  const s = ok(b('status'));
  const state = JSON.parse(readFileSync(join(s.stateDir, 'state.json'), 'utf8'));
  process.kill(s.pid, 'SIGKILL');
  assert.match(ok(b('goto', base)), /Navigated/);
  assert.notEqual(ok(b('status')).pid, s.pid);
  assert.throws(() => process.kill(s.chromePid, 0), 'old browser killed');
  assert.ok(!existsSync(state.profile), 'old profile removed');
});

test('load-html, scoped/limited snapshot, clip screenshot, frame by url', () => {
  if (!chrome) return blocked(b('load-html', 'x.html'));
  writeFileSync(join(dir, 'card.html'), '<main><h2>Card</h2><section id="s"><button>Inner</button></section><button>Outer</button></main>');
  assert.match(ok(b('load-html', 'card.html')), /Loaded/);
  assert.match(ok(b('text')), /Card[\s\S]*Inner[\s\S]*Outer/);
  assert.equal(ok(b('js', 'document.querySelector("h2").textContent')).trim(), 'Card', 'a loaded local file is a local page');
  const scoped = ok(b('snapshot', '-s', '#s'));
  assert.match(scoped, /"Inner"/); assert.doesNotMatch(scoped, /Outer/);
  assert.doesNotMatch(ok(b('snapshot', '-d', '0')), /\[button\]/);
  failed(b('load-html', 'probe.js'), /\.html/);
  const clip = join(out, 'clip.png');
  ok(b('screenshot', '--clip', '0,0,50,40', clip));
  assert.equal(decodePng(readFileSync(clip)).width, 50);
  ok(b('goto', base));
  ok(b('frame', '--url', '/frame'));
  assert.match(ok(b('text')), /Inside frame/);
  ok(b('frame', 'main'));
});

test('canary: N checks of each page record HTTP status and console errors; new errors and failed pages are alerts', () => {
  if (!chrome) return blocked(mis(dir, ['canary', base, '--checks', '1'], { env: ENV }));
  const r = mis(dir, ['canary', base, '--pages', '/,/next,/missing', '--checks', '2', '--interval', '0s'], { env: ENV });
  assert.equal(r.code, 1, r.err);
  assert.equal(r.json.checks, 2);
  const first = Object.fromEntries(r.json.results[0].map((p) => [new URL(p.url).pathname, p]));
  assert.equal(first['/'].status, 200); assert.equal(first['/'].consoleErrors, 1);
  assert.equal(first['/next'].consoleErrors, 0); assert.equal(first['/missing'].status, 404);
  assert.deepEqual(r.json.alerts.map((a) => `${a.level} ${new URL(a.url).pathname}`).sort(), ['CRITICAL /missing', 'HIGH /']);
  ok(mis(dir, ['canary', base, '--pages', '/', '--baseline'], { env: ENV }));
  const healthy = mis(dir, ['canary', base, '--pages', '/', '--checks', '2', '--interval', '0s'], { env: ENV }).json;
  // load-time alerts (MEDIUM) depend on machine load, so only the error comparison is asserted here (unit test: mis-ops)
  assert.deepEqual(healthy.alerts.filter((a) => a.level !== 'MEDIUM'), [], 'the error the baseline already had is not an alert');
});

test('canary: every check saves a screenshot and a load time; --discover adds same-origin pages from sitemap.xml and links', () => {
  if (!chrome) return blocked(mis(dir, ['canary', base, '--discover', '--checks', '1'], { env: ENV }));
  const bl = ok(mis(dir, ['canary', base, '--pages', '/next', '--baseline'], { env: ENV }));
  assert.equal(decodePng(readFileSync(bl.pages[0].screenshot)).width > 0, true);
  assert.match(bl.pages[0].screenshot, /canary\/baseline\/next\.png$/);
  const r = mis(dir, ['canary', base, '--discover', '--checks', '1'], { env: ENV }).json;
  assert.deepEqual(r.pages.map((u) => new URL(u).pathname).sort(), ['/', '/frame', '/next']);
  for (const p of r.results[0]) {
    assert.ok(Number.isInteger(p.loadMs) && p.loadMs > 0, `${p.url} load time`);
    assert.ok(decodePng(readFileSync(p.screenshot)).width > 0, p.screenshot);
  }
  assert.match(r.results[0][0].screenshot, /canary\/shots\/.+-1\.png$/);
});

test('stop shuts the daemon and the browser down; restart brings it back', async () => {
  if (!chrome) return blocked(b('restart'));
  const s = ok(b('restart'));
  assert.equal(s.running, true);
  const profile = JSON.parse(readFileSync(join(s.stateDir, 'state.json'), 'utf8')).profile;
  assert.ok(existsSync(profile));
  assert.equal(ok(b('stop')).stopped, true);
  assert.equal(ok(b('status')).running, false);
  assert.ok(!existsSync(join(s.stateDir, 'state.json')));
  assert.throws(() => process.kill(s.chromePid, 0));
  assert.ok(!existsSync(profile), 'the browser profile temp dir is removed');
});

test('idle shutdown', async () => {
  if (!chrome) return blocked(b('goto', 'about:blank'));
  const d2 = makeRepo();
  const env = { ...ENV, MIS_BROWSE_IDLE_MS: '6000' }; // long enough that a loaded machine still sends the first command in time
  ok(mis(d2, ['browse', 'goto', 'about:blank'], { env }));
  const { pid } = ok(mis(d2, ['browse', 'status'], { env }));
  // poll the process, not `status`: every request to the daemon counts as activity
  until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'the idle shutdown', 60000);
  assert.equal(ok(mis(d2, ['browse', 'status'], { env })).running, false);
});

test('real screenshots: the same page moved 2px scores high (pass), a different page in the same layout fails', () => {
  if (!chrome) return blocked(b('goto', 'about:blank'));
  const body = (margin, h, p, btn) => `<body style="margin:${margin}"><style>body{font:16px sans-serif}</style><h1>${h}</h1><p>${p}</p><button>${btn}</button>`;
  writeFileSync(join(dir, 'vv-a.html'), body('20px', 'Demo', 'Welcome to the demo page. It has a short paragraph.', 'Start'));
  writeFileSync(join(dir, 'vv-moved.html'), body('22px 20px', 'Demo', 'Welcome to the demo page. It has a short paragraph.', 'Start'));
  writeFileSync(join(dir, 'vv-other.html'), body('20px', 'Second', 'This is another page with different words in it.', 'Next'));
  for (const f of ['vv-a', 'vv-moved', 'vv-other']) { ok(b('goto', `${f}.html`)); ok(b('screenshot', '--viewport', join(out, `${f}.png`))); }
  const moved = mis(dir, ['visual-verdict', join(out, 'vv-moved.png'), join(out, 'vv-a.png')]).json;
  assert.ok(moved.score >= 95 && moved.verdict === 'pass', JSON.stringify(moved));
  const other = mis(dir, ['visual-verdict', join(out, 'vv-other.png'), join(out, 'vv-a.png')]).json;
  assert.ok(other.score < 50 && other.verdict === 'fail', JSON.stringify(other));
  // full-page shots of a tall page: the margin change also makes the page taller
  const tall = (margin) => body(margin, 'Demo', 'Welcome to the demo page.<div style="height:1500px"></div>', 'Start');
  writeFileSync(join(dir, 'vv-tall.html'), tall('20px')); writeFileSync(join(dir, 'vv-tall2.html'), tall('22px 20px'));
  for (const f of ['vv-tall', 'vv-tall2']) { ok(b('goto', `${f}.html`)); ok(b('screenshot', join(out, `${f}.png`))); }
  const full = mis(dir, ['visual-verdict', join(out, 'vv-tall2.png'), join(out, 'vv-tall.png')]).json;
  assert.ok(full.sizeMatch === false && full.score >= 95 && full.verdict === 'pass', JSON.stringify(full));
});
