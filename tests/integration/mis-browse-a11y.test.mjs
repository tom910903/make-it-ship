// mis browse a11y (axe-core) and layout-check against the real Chrome on this machine; without Chrome every case asserts BLOCKED.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserLock, makeRepo, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const chrome = findChrome();
const HOME = mkdtempSync(join(tmpdir(), 'mis-a11y-home-'));
const ENV = { MIS_STATE_HOME: HOME, MIS_BROWSE_IDLE_MS: '180000', MIS_BROWSE_HEADLESS_ONLY: '1' };
let dir, bad, good;
const b = (...args) => mis(dir, ['browse', ...args], { env: ENV });
const ok = (r) => { assert.equal(r.code, 0, `exit ${r.code}\n${r.err}${r.out}`); return r.json; };
const blocked = (r) => assert.match(r.err, /BLOCKED: no Chrome, Chromium or Edge/);

// planted problems: no alt, low contrast, an unnamed icon button, a 16px button, 10px text, a 1200px box, a title in a fixed box
const BAD = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>bad</title>
<body style="margin:0;font:16px sans-serif">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">
<p style="color:#bbb;background:#fff">Low contrast text</p>
<button id="icon"><svg width="16" height="16"></svg></button>
<button id="tiny" style="width:16px;height:16px;padding:0">x</button>
<div id="wide" style="width:1200px;height:20px">wide</div>
<h2 id="title" style="width:200px;white-space:nowrap;overflow:hidden">Short title</h2>
<p id="fine" style="font-size:10px">fine print</p>
<p>Read the <a href="#terms">terms</a> first.</p>
</body></html>`;
const GOOD = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>good</title>
<body style="margin:0;font:16px sans-serif;overflow-wrap:anywhere"><main><h1>Book a table</h1><p>Open until 22:00.</p>
<button style="min-width:44px;min-height:44px">Book</button></main></body></html>`;

let unlock = () => {};
before(async () => {
  unlock = await browserLock();
  dir = makeRepo();
  bad = join(dir, 'bad.html'); good = join(dir, 'good.html');
  writeFileSync(bad, BAD); writeFileSync(good, GOOD);
});
after(() => { try { if (chrome) b('stop'); rmSync(HOME, { recursive: true, force: true }); } finally { unlock(); } });

test('a11y: axe-core finds the planted WCAG violations with their criteria and elements; a clean page has none', () => {
  if (!chrome) return blocked(b('goto', pathToFileURL(bad).href));
  ok(b('goto', pathToFileURL(bad).href));
  const r = ok(b('a11y'));
  assert.match(r.engine, /^axe-core \d/);
  const v = Object.fromEntries(r.violations.map((x) => [x.id, x]));
  for (const [id, wcag] of [['image-alt', 'wcag111'], ['button-name', 'wcag412'], ['color-contrast', 'wcag143']]) assert.ok(v[id]?.wcag.includes(wcag), `${id}: ${JSON.stringify(v[id])}`);
  assert.deepEqual(v['button-name'].targets, ['#icon']);
  assert.ok(r.counts.critical >= 2, JSON.stringify(r.counts));
  assert.deepEqual(ok(b('a11y', '#fine')).violations, [], 'scoped to one element');
  ok(b('goto', pathToFileURL(good).href));
  assert.deepEqual(ok(b('a11y')).violations, []);
});

test('layout-check: overflow and what causes it, small targets and text, text cut off once long words go in; the page is put back', () => {
  if (!chrome) return blocked(b('layout-check'));
  ok(b('goto', pathToFileURL(bad).href));
  const r = ok(b('layout-check', '--widths', '1440,390', '--stress'));
  assert.equal(r.ok, false);
  const [wide, narrow] = r.widths;
  assert.deepEqual([wide.width, wide.overflowX, narrow.width], [1440, 0, 390]);
  assert.ok(narrow.overflowX > 0 && narrow.offscreen.some((d) => d.startsWith('div#wide')), JSON.stringify(narrow));
  assert.ok(narrow.smallTargets.includes('button#tiny "x" 16x16'), JSON.stringify(narrow.smallTargets));
  assert.ok(!narrow.smallTargets.some((d) => d.includes('terms')), 'a link inside a sentence is exempt');
  assert.ok(narrow.smallText.includes('p#fine "fine print" 10px'));
  assert.deepEqual(wide.clipped, []);
  assert.deepEqual(wide.stress.clipped, ['h2#title "Short title Internationalisier"']);
  const text = b('text');
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /Short title\n/, 'the stress texts are removed again');
  assert.doesNotMatch(text.out, /Internationalisierung/);
  ok(b('goto', pathToFileURL(good).href));
  assert.equal(ok(b('layout-check', '--stress')).ok, true, 'long words wrap (overflow-wrap: anywhere)');
  writeFileSync(good, GOOD.replace(';overflow-wrap:anywhere', ''));
  ok(b('goto', pathToFileURL(good).href));
  const nowrap = ok(b('layout-check', '--widths', '390', '--stress')).widths[0];
  assert.deepEqual([nowrap.overflowX, nowrap.offscreen], [0, []], 'fine with its own text');
  assert.ok(nowrap.stress.overflowX > 0 && nowrap.stress.offscreen.some((d) => d.startsWith('h1 "Book a table')), JSON.stringify(nowrap.stress));
  assert.match(b('layout-check', '--widths', '100').err, /usage: mis browse layout-check/);
});
