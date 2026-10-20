import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';
import { encodePng, decodePng } from '../../scripts/lib/png.mjs';

const chrome = findChrome();
const ENV = { MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-pdf-home-')), MIS_BROWSE_IDLE_MS: '120000' };
const dir = makeRepo();
after(() => { if (chrome) mis(dir, ['browse', 'stop'], { env: ENV }); });

const solid = (w, h, rgb) => encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) });

test('visual-verdict: identical images pass (exit 0); a different image fails with a diff image and regions', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'mis-vv-')));
  writeFileSync(join(d, 'ref.png'), solid(40, 40, [255, 255, 255]));
  writeFileSync(join(d, 'same.png'), solid(40, 40, [255, 255, 255]));
  const img = decodePng(solid(40, 40, [255, 255, 255]));
  for (let i = 0; i < 40 * 20 * 4; i += 4) img.data.set([0, 0, 0, 255], i); // top half black
  writeFileSync(join(d, 'shot.png'), encodePng(img));
  const ok = mis(d, ['visual-verdict', 'same.png', 'ref.png']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.json.score, 100); assert.equal(ok.json.verdict, 'pass'); assert.equal(ok.json.pass, true);
  const bad = mis(d, ['visual-verdict', 'shot.png', 'ref.png', '-o', 'diff.png']);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.score, 0); assert.equal(bad.json.verdict, 'fail');
  assert.ok(bad.json.differences.some((x) => /region x 0-/.test(x)));
  assert.equal(decodePng(readFileSync(join(d, 'diff.png'))).width, 40);
  assert.equal(bad.json.diffImage, join(d, 'diff.png'));
  const lenient = mis(d, ['visual-verdict', 'shot.png', 'ref.png', '--threshold', '0']);
  assert.equal(lenient.code, 0);
  const usage = mis(d, ['visual-verdict', 'shot.png']);
  assert.equal(usage.code, 1); assert.match(usage.err, /usage: mis visual-verdict/);
});

test('mis pdf: markdown → tagged PDF through the built-in browser (or BLOCKED without one)', () => {
  write(dir, { 'docs/guide.md': '# Part one\n\n"Quoted" text -- with dashes.\n\n![logo](logo.png)\n\n![remote](https://example.com/x.png)\n\n# Part two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' });
  writeFileSync(join(dir, 'docs/logo.png'), solid(20, 20, [0, 128, 255]));
  const blocked = mis(dir, ['pdf', 'docs/guide.md'], { env: { ...ENV, MIS_BROWSER: '/nonexistent/chrome' } });
  assert.equal(blocked.code, 1); assert.match(blocked.err, /BLOCKED: no Chrome/);
  if (!chrome) return;
  const r = mis(dir, ['pdf', 'docs/guide.md'], { env: ENV });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.pdf, join(dir, 'docs/guide.pdf'));
  assert.equal(r.json.title, 'Part one');
  assert.ok(r.json.pages >= 2, `chapter break per H1, got ${r.json.pages} pages`);
  assert.equal(readFileSync(r.json.pdf).subarray(0, 5).toString(), '%PDF-');
  const o = mis(dir, ['pdf', 'docs/guide.md', '-o', 'out/g.pdf', '--page-size', 'a4', '--no-page-numbers'], { env: ENV });
  assert.equal(o.code, 0, o.err);
  assert.ok(existsSync(join(dir, 'out/g.pdf')));
  assert.equal(mis(dir, ['pdf', 'missing.md'], { env: ENV }).code, 1);
});
