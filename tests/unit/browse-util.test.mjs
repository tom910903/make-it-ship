import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalOrigin, lineDiff, toInches, toUrl } from '../../scripts/lib/browse/util.mjs';
import { findChrome, chromeArgs } from '../../scripts/lib/browse/chrome.mjs';
import { markdownToHtml } from '../../scripts/lib/markdown.mjs';

test('M8 D0: local origins are file and loopback only; opaque/unknown origins (about:, data:, blob:, "://", "null") and real sites are not local', () => {
  for (const u of ['file://', 'file:///tmp/a.html', 'http://localhost:3000', 'http://127.0.0.1:8080',
    'http://[::1]:5000', 'http://app.localhost', 'https://127.1.2.3']) assert.equal(isLocalOrigin(u), true, u);
  for (const u of ['://', 'null', 'about:blank', 'data:text/html,x', 'blob:http://shop.test/1', 'blob:http://127.0.0.1:5/1',
    'https://example.com', 'http://localhost.evil.com', 'https://evil.com/?u=http://localhost', 'http://10.0.0.5', 'chrome://settings', 'not a url', '', undefined])
    assert.equal(isLocalOrigin(u), false, String(u));
});

test('toUrl: schemes kept, existing files become file URLs, bare hosts get a scheme', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mis-url-'));
  writeFileSync(join(dir, 'p.html'), '<p>x</p>');
  assert.equal(toUrl('https://a.b/c', dir), 'https://a.b/c');
  assert.equal(toUrl('p.html', dir), `file://${join(dir, 'p.html')}`);
  assert.equal(toUrl('file://./p.html', dir), `file://${join(dir, 'p.html')}`);
  assert.equal(toUrl('localhost:3000/x', dir), 'http://localhost:3000/x');
  assert.equal(toUrl('example.com', dir), 'https://example.com');
});

test('lineDiff marks removed and added lines', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), ['- b', '+ B', '+ d']);
  assert.deepEqual(lineDiff('same', 'same'), []);
});

test('toInches parses print dimensions', () => {
  assert.equal(toInches('1in'), 1); assert.equal(toInches('72pt'), 1); assert.equal(toInches('2.54cm'), 1);
  assert.equal(toInches('25.4mm'), 1); assert.equal(toInches('96px'), 1);
  assert.throws(() => toInches('wide'), /dimension/);
});

test('findChrome honours MIS_BROWSER and returns null for a missing path', () => {
  assert.equal(findChrome({ MIS_BROWSER: '/nonexistent/chrome' }), null);
  assert.equal(findChrome({ MIS_BROWSER: process.execPath }), process.execPath);
});

test('markdown → print HTML: title from first H1, smart quotes outside code, remote images blocked', () => {
  const { html, title } = markdownToHtml('# On "Horizons"\n\nIt\'s -- really --- "fine".\n\n`"raw"`\n\n![pic](https://x.test/a.png)\n\n![local](img/a.png)\n', { baseDir: '/docs' });
  assert.equal(title, 'On “Horizons”');
  assert.match(html, /It’s – really — “fine”\./);
  assert.match(html, /<code>&quot;raw&quot;<\/code>/);
  assert.match(html, /remote image blocked/);
  assert.doesNotMatch(html, /x\.test/);
  assert.match(html, /<base href="file:\/\/\/docs\/">/);
  assert.match(html, /<img src="img\/a\.png"/);
  const net = markdownToHtml('![pic](https://x.test/a.png)', { baseDir: '/d', allowNetwork: true }).html;
  assert.match(net, /<img src="https:\/\/x\.test\/a\.png"/);
});

test('M8 R2-3: extra Chrome flags cannot reopen a DevTools port, drop web security, swap the profile or load extensions', () => {
  assert.deepEqual(chromeArgs('--host-resolver-rules=MAP *.test 127.0.0.1 --lang=ko'), ['--host-resolver-rules=MAP *.test 127.0.0.1', '--lang=ko']);
  assert.deepEqual(chromeArgs(''), []);
  for (const bad of ['--remote-debugging-port=0', '-remote-debugging-port=9222', '--remote-debugging-address=0.0.0.0', '--remote-allow-origins=*',
    '--disable-web-security', '--user-data-dir=/Users/me/Library/Chrome', '--profile-directory=Default', '--load-extension=/x',
    '--disable-extensions-except=/x', '--allow-file-access-from-files', '--proxy-server=http://p:1', '--lang=ko --REMOTE-DEBUGGING-PIPE']) {
    assert.throws(() => chromeArgs(bad), /MIS_BROWSE_CHROME_ARGS[\s\S]*not allowed/, bad);
  }
  assert.throws(() => chromeArgs('http://evil.test/'), /MIS_BROWSE_CHROME_ARGS[\s\S]*flag/, 'a bare URL would open at startup, before any gate');
});

test('M8 R3-3: extra Chrome flags are an allow list (fail closed); host-resolver-rules may only point names at loopback or map non-local names', () => {
  assert.deepEqual(chromeArgs('--lang=ko --window-size=800,600 --force-device-scale-factor=2 --disable-gpu'), ['--lang=ko', '--window-size=800,600', '--force-device-scale-factor=2', '--disable-gpu']);
  assert.deepEqual(chromeArgs('--host-resolver-rules=MAP *.test 127.0.0.1, MAP lan.test 10.0.0.5, MAP a.test [::1]:8080, MAP b.test ~NOTFOUND'),
    ['--host-resolver-rules=MAP *.test 127.0.0.1, MAP lan.test 10.0.0.5, MAP a.test [::1]:8080, MAP b.test ~NOTFOUND']);
  for (const bad of ['--host-resolver-rules=MAP localhost 10.10.77.78', '--host-resolver-rules=MAP * 10.0.0.5', '--host-resolver-rules=MAP *.localhost 1.2.3.4',
    '--host-resolver-rules=MAP 127.0.0.1 1.2.3.4', '--host-resolver-rules=MAP x.test 127.0.0.1, EXCLUDE *', '--host-resolver-rules=MAP app.localhost 10.0.0.5',
    '--ignore-certificate-errors', '--no-sandbox', '--unsafely-treat-insecure-origin-as-secure=http://x.test', '--renderer-cmd-prefix=/tmp/w',
    '--browser-subprocess-path=/tmp/w', '--gpu-launcher=/tmp/w', '--enable-features=X', '--LANG=ko', '--some-future-flag']) {
    assert.throws(() => chromeArgs(bad), /MIS_BROWSE_CHROME_ARGS[\s\S]*not allowed/, bad);
  }
});
