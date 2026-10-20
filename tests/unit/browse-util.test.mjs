import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalUrl, lineDiff, toInches, toUrl } from '../../scripts/lib/browse/util.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';
import { markdownToHtml } from '../../scripts/lib/markdown.mjs';

test('local URLs: file, about, data, localhost, loopback; real sites and look-alikes are not local', () => {
  for (const u of ['file:///tmp/a.html', 'about:blank', 'data:text/html,x', 'http://localhost:3000/x', 'http://127.0.0.1:8080',
    'http://[::1]:5000/', 'http://app.localhost/', 'https://127.1.2.3/']) assert.equal(isLocalUrl(u), true, u);
  for (const u of ['https://example.com', 'http://localhost.evil.com', 'https://evil.com/?u=http://localhost', 'http://10.0.0.5', 'chrome://settings', 'not a url', '', undefined])
    assert.equal(isLocalUrl(u), false, String(u));
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
