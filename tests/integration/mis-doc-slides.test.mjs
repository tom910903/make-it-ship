// mis doc / mis slides (user decision 2026-11-04): markdown with mermaid charts and diagrams → CSP-locked HTML (+ PDF), human docs in every language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserLock, makeRepo, write, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';
import { encodePng } from '../../scripts/lib/png.mjs';

const chrome = findChrome();
const ENV = { MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-doc-home-')), MIS_BROWSE_IDLE_MS: '120000' };
const NOCHROME = { ...ENV, MIS_BROWSER: '/nonexistent/chrome' };
const dir = makeRepo();
let unlock = () => {};
before(async () => { unlock = await browserLock(); });
after(() => { try { if (chrome) mis(dir, ['browse', 'stop'], { env: ENV }); } finally { unlock(); } });

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const png = encodePng({ width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(200) });
const FLOW = '```mermaid\nflowchart LR\n  A --> B\n```\n';

test('mis doc: x.md + x.ko.md → two HTML files with lang en/ko; a configured language without its file is reported', () => {
  write(dir, {
    '.make-it-ship.json': { version: 1, checks: { test: { argv: ['true'] } }, layout: { paths: ['**'], docs: { human: 'docs', languages: ['en', 'ko', 'ja'] } } },
    'docs/guide.md': `# Guide\n\n${FLOW}\n\`\`\`mermaid\nnot a diagram\n\`\`\`\n`, 'docs/guide.ko.md': `# 안내\n\n${FLOW}`,
  });
  const r = ok(mis(dir, ['doc', 'docs/guide.ko.md'], { env: NOCHROME }));
  assert.deepEqual(r.docs.map((d) => [d.lang, d.source, d.html]), [['en', 'docs/guide.md', 'docs/guide.html'], ['ko', 'docs/guide.ko.md', 'docs/guide.ko.html']]);
  assert.deepEqual(r.missingTranslations, ['docs/guide.ja.md']);
  assert.equal(r.visuals, 2);
  assert.deepEqual(r.errors.map((e) => [e.file, e.index, e.line]), [['docs/guide.md', 2, 8]]);
  const en = readFileSync(join(dir, 'docs/guide.html'), 'utf8'), ko = readFileSync(join(dir, 'docs/guide.ko.html'), 'utf8');
  assert.match(en, /^<!doctype html><html lang="en">/); assert.match(ko, /^<!doctype html><html lang="ko">/);
  assert.match(en, /Content-Security-Policy/); assert.match(en, /<svg/); assert.match(en, /not a diagram/);
  assert.doesNotMatch(en, /<base href/); // written next to its source: relative links already resolve
  for (const h of [en, ko]) assert.doesNotMatch(h, /https?:\/\/(?!www\.w3\.org)|file:\/\//);
});

test('mis doc: -o elsewhere gets a relative <base>; translations follow as out.<lang>.html; no config → nothing missing', () => {
  write(dir, { 'notes/a.md': '# A\n\n![l](l.png)\n', 'notes/a.ko.md': '# 가\n' });
  writeFileSync(join(dir, '.make-it-ship.json'), '{}'); // invalid config → no configured languages
  const r = ok(mis(dir, ['doc', 'notes/a.md', '-o', 'site/a.html']));
  assert.deepEqual(r.docs.map((d) => d.html), ['site/a.html', 'site/a.ko.html']);
  assert.deepEqual(r.missingTranslations, []);
  assert.match(readFileSync(join(dir, 'site/a.html'), 'utf8'), /<base href="\.\.\/notes\/">/);
});

test('mis doc / slides: paths outside the repository are refused before anything is written', () => {
  const outside = mkdtempSync(join(tmpdir(), 'mis-doc-out-'));
  write(dir, { 'deck.md': '# x\n' });
  for (const cmd of [['doc', 'notes/a.md', '-o', join(outside, 'a.html')], ['slides', 'deck.md', '-o', join(outside, 'd.html')]]) {
    const r = mis(dir, cmd);
    assert.equal(r.code, 1, cmd.join(' '));
    assert.match(r.err, /outside the repository/);
  }
  assert.equal(existsSync(join(outside, 'a.html')) || existsSync(join(outside, 'd.html')), false);
  assert.match(mis(dir, ['doc', 'a.txt']).err, /usage: mis doc/);
});

test('mis slides: Marp deck → one HTML with a section per slide; --pdf without Chrome is BLOCKED and the HTML stays', () => {
  write(dir, { 'talk/deck.md': `---\nmarp: true\ntitle: Talk\npaginate: true\n---\n\n# One\n\n<!-- note -->\n\n---\n\n## Two\n\n${FLOW}\n---\n\n## Three\n` });
  const r = ok(mis(dir, ['slides', 'talk/deck.md', '--pdf'], { env: NOCHROME }));
  assert.equal(r.html, 'talk/deck.html');
  assert.deepEqual([r.title, r.slides, r.visuals, r.notes], ['Talk', 3, 1, 1]);
  assert.equal(r.pdf, null); assert.match(r.blocked, /BLOCKED: no Chrome/);
  const h = readFileSync(join(dir, 'talk/deck.html'), 'utf8');
  assert.equal((h.match(/<section class="slide"/g) ?? []).length, 3);
  assert.doesNotMatch(h, /https?:\/\/(?!www\.w3\.org)/);
  const d = ok(mis(dir, ['doc', 'docs/guide.md', '--pdf'], { env: NOCHROME }));
  assert.ok(d.docs.every((x) => x.pdf === null && /BLOCKED: no Chrome/.test(x.blocked)));
});

test('mis doc / slides --pdf through the built-in browser: local images load under the CSP, one page per slide (or BLOCKED without one)', () => {
  if (!chrome) return; // the BLOCKED path is asserted in the test above
  write(dir, { 'pics/p.md': '# Pic\n\n![dot](dot.png)\n' });
  writeFileSync(join(dir, 'pics/dot.png'), png);
  const d = ok(mis(dir, ['doc', 'pics/p.md', '--pdf'], { env: ENV }));
  assert.equal(d.docs[0].pdf, 'pics/p.pdf');
  assert.match(readFileSync(join(dir, 'pics/p.pdf')).toString('latin1'), /\/Subtype\s*\/Image/, 'the local image rendered');
  const s = ok(mis(dir, ['slides', 'talk/deck.md', '--pdf'], { env: ENV }));
  assert.equal(s.pdf, 'talk/deck.pdf');
  assert.equal(s.pages, 3);
  const box = readFileSync(join(dir, 'talk/deck.pdf')).toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
  assert.ok(box && Math.abs(box[1] - 960) < 2 && Math.abs(box[2] - 540) < 2, `16:9 page 13.333in × 7.5in, got ${box?.slice(1)}`);
});
