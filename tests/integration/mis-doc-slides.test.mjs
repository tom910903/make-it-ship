// mis doc / mis slides (user decision 2026-11-04): markdown with mermaid charts and diagrams → CSP-locked HTML (+ PDF), human docs in every language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const run = mis(dir, ['doc', 'docs/guide.ko.md'], { env: NOCHROME });
  assert.equal(run.code, 1, 'a broken mermaid block fails the command; the files and the report are still written'); // as visual-verdict: JSON + exit 1
  const r = run.json;
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

test('mis doc / slides: an output (html, translation, pdf) that is a symlink, even dangling, or a source linked outside is refused; nothing lands outside', () => {
  const d = makeRepo(), outside = realpathSync(mkdtempSync(join(tmpdir(), 'mis-doc-link-')));
  write(d, { 'docs/g.md': '# G\n', 'docs/g.ko.md': '# 지\n', 'deck.md': '# D\n', 't/x.md': '# X\n', 'p/y.md': '# Y\n' });
  write(outside, { 's.md': '# S\n' });
  symlinkSync(join(outside, 'x.html'), join(d, 'docs/out.html'));
  symlinkSync(join(outside, 'k.html'), join(d, 't/x.ko.html')); write(d, { 't/x.ko.md': '# 엑스\n' });
  symlinkSync(join(outside, 'd.html'), join(d, 'deck.out.html'));
  symlinkSync(join(outside, 'y.pdf'), join(d, 'p/y.pdf'));
  symlinkSync(join(outside, 's.md'), join(d, 'linked.md'));
  for (const args of [['doc', 'docs/g.md', '-o', 'docs/out.html'], ['doc', 't/x.md'], ['slides', 'deck.md', '-o', 'deck.out.html'], ['doc', 'p/y.md', '--pdf'], ['doc', 'linked.md'], ['slides', 'linked.md']]) {
    const r = mis(d, args, { env: NOCHROME });
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /symlink|outside the repository/, args.join(' '));
  }
  assert.deepEqual(readdirSync(outside), ['s.md']);
  assert.ok(!existsSync(join(d, 'p/y.html')), 'refused before the HTML was written');
});

test('mis doc: local images inside the repository are inlined as data: URIs, outside ones are a blocked box', () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'mis-doc-img-')));
  writeFileSync(join(outside, 'o.png'), png);
  write(dir, { 'img/i.md': `# I\n\n![in](dot.png) ![out](${relative(join(dir, 'img'), join(outside, 'o.png'))}) ![abs](${join(outside, 'o.png')}) ![gone](nope.png)\n` });
  writeFileSync(join(dir, 'img/dot.png'), png);
  const r = ok(mis(dir, ['doc', 'img/i.md']));
  assert.equal(r.docs.length, 1);
  const h = readFileSync(join(dir, 'img/i.html'), 'utf8');
  assert.match(h, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="in">/);
  for (const t of ['out', 'abs', 'gone']) assert.match(h, new RegExp(`local image blocked: ${t}`));
  assert.ok(!h.includes(outside));
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
  const dr = mis(dir, ['doc', 'docs/guide.md', '--pdf'], { env: NOCHROME }), d = dr.json;
  assert.equal(dr.code, 1, 'guide.md still has its broken mermaid block');
  assert.ok(d.docs.every((x) => x.pdf === null && /BLOCKED: no Chrome/.test(x.blocked)));
  write(dir, { 'talk/bad.md': '# Bad\n\n```mermaid\nnot a diagram\n```\n' });
  const bad = mis(dir, ['slides', 'talk/bad.md'], { env: NOCHROME });
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.json.errors.map((e) => e.slide), [1]);
  assert.ok(existsSync(join(dir, 'talk/bad.html')));
});

test('mis doc / slides --pdf through the built-in browser: local images load under the CSP, one page per slide (or BLOCKED without one)', () => {
  if (!chrome) return; // the BLOCKED path is asserted in the test above
  write(dir, { 'pics/p.md': '# Pic\n\n![dot](dot.png)\n' });
  writeFileSync(join(dir, 'pics/dot.png'), png);
  const d = ok(mis(dir, ['doc', 'pics/p.md', '--pdf'], { env: ENV }));
  assert.equal(d.docs[0].pdf, 'pics/p.pdf');
  assert.match(readFileSync(join(dir, 'pics/p.pdf')).toString('latin1'), /\/Subtype\s*\/Image[^>]*\/Width\s+20\b|\/Width\s+20\b[^>]*\/Subtype\s*\/Image/, 'the 20x20 local image rendered (not a broken-image icon)');
  const s = ok(mis(dir, ['slides', 'talk/deck.md', '--pdf'], { env: ENV }));
  assert.equal(s.pdf, 'talk/deck.pdf');
  assert.equal(s.pages, 3);
  const box = readFileSync(join(dir, 'talk/deck.pdf')).toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
  assert.ok(box && Math.abs(box[1] - 960) < 2 && Math.abs(box[2] - 540) < 2, `16:9 page 13.333in × 7.5in, got ${box?.slice(1)}`);
});

// A 37x23 canary image outside the repository: if any PDF shows an image of that size, the page navigated to it.
const CANARY = /\/Width\s+37\b/;
const canary = () => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'mis-doc-secret-')));
  writeFileSync(join(out, 'secret.png'), encodePng({ width: 37, height: 23, data: new Uint8Array(37 * 23 * 4).fill(90) }));
  return pathToFileURL(join(out, 'secret.png')).href;
};

test('mis pdf / doc --pdf / slides --pdf: a meta refresh (or any navigating tag) in the markdown never prints a file outside the repository', () => {
  if (!chrome) return;
  const url = canary();
  write(dir, { 'leak/l.md': `# Leak\n\n<meta http-equiv="refresh" content="0;url=${url}">\n\ntext <meta http-equiv="refresh" content="0;url=${url}"> inline\n\n<iframe src="${url}"></iframe>\n` });
  const p = ok(mis(dir, ['pdf', 'leak/l.md'], { env: ENV }));
  const d = ok(mis(dir, ['doc', 'leak/l.md', '--pdf'], { env: ENV }));
  const s = ok(mis(dir, ['slides', 'leak/l.md', '-o', 'leak/deck.html', '--pdf'], { env: ENV }));
  for (const f of [p.pdf, join(dir, d.docs[0].pdf), join(dir, s.pdf)]) assert.doesNotMatch(readFileSync(f).toString('latin1'), CANARY, f);
});

test('the Chrome PDF path itself refuses a page that navigated away after loading, and writes nothing', () => {
  if (!chrome) return;
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'mis-doc-nav-'))), html = join(tmp, 'p.html'), out = join(tmp, 'p.pdf');
  writeFileSync(html, `<!doctype html><meta http-equiv="refresh" content="0;url=${canary()}"><p>x</p>`);
  const client = new URL('../../scripts/lib/browse/client.mjs', import.meta.url).href;
  const script = `import { send, browseDir } from '${client}';
    try { await send(browseDir(process.cwd()), { cmd: '_render-pdf', cwd: process.cwd(), args: [{ html: '${pathToFileURL(html).href}', out: '${out}', opts: {} }] }); console.log('printed'); }
    catch (e) { console.log('refused: ' + e.message); }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, env: { ...process.env, ...ENV }, encoding: 'utf8' });
  // the refresh races the print: committed before it → refused by our check; during it → Chrome fails the print; still pending → our own page was printed
  if (/^printed/.test(r.stdout)) assert.doesNotMatch(readFileSync(out).toString('latin1'), CANARY, 'printed, so it must be our page');
  else { assert.match(r.stdout, /refused: .*(navigated away|Printing failed)/, r.stdout + r.stderr); assert.ok(!existsSync(out), 'no PDF written'); }
});

test("doc base: a relative <base> of ours still applies under base-uri 'none'; a document's own <base> never changes the base", () => {
  if (!chrome) return;
  write(dir, { 'b/n.md': '# N\n\n<base href="https://evil.example/">\n\n[x](y.html)\n', 'b2/m.md': '# M\n' });
  ok(mis(dir, ['doc', 'b/n.md']));
  ok(mis(dir, ['doc', 'b2/m.md', '-o', 'site2/m.html']));
  const base = (f) => { ok(mis(dir, ['browse', 'goto', pathToFileURL(join(dir, f)).href], { env: ENV })); return mis(dir, ['browse', 'js', 'document.baseURI'], { env: ENV }).out.trim(); };
  assert.equal(base('b/n.html'), pathToFileURL(join(dir, 'b/n.html')).href);
  assert.equal(base('site2/m.html'), pathToFileURL(join(dir, 'b2/')).href);
});
