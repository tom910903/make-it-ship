// mis chart (user decision 2026-11-04): CSV/JSON/mermaid → <name>.svg + <name>.html inside the repository, never outside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };

test('mis chart: CSV → svg + html with defaults (bar, first column on x, numeric columns as series)', () => {
  const dir = makeRepo();
  write(dir, { 'data/sales.csv': 'month,sales,"cost, total"\njan,10,4\nfeb,12.5,6\n' });
  const r = ok(mis(dir, ['chart', 'data/sales.csv', '--title', 'Sales <2025>', '--out', 'design']));
  assert.deepEqual(r.files, ['design/sales.svg', 'design/sales.html']);
  assert.deepEqual([r.type, r.series, r.points], ['bar', 2, 2]);
  assert.match(r.png, /mis browse screenshot.*BLOCKED/);
  const svg = readFileSync(join(dir, 'design/sales.svg'), 'utf8');
  assert.match(svg, /^<svg/);
  assert.match(svg, /Sales &lt;2025&gt;/);
  assert.match(svg, /cost, total/);
  const html = readFileSync(join(dir, 'design/sales.html'), 'utf8');
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Sales &lt;2025&gt;<\/title>/);
  assert.ok(html.includes(svg.trim()));
  const line = ok(mis(dir, ['chart', 'data/sales.csv', '--type', 'line', '--x', 'month', '--y', 'sales']));
  assert.deepEqual([line.type, line.series, line.files], ['line', 1, ['data/sales.svg', 'data/sales.html']]);
});

test('mis chart: JSON rows and a mermaid pie', () => {
  const dir = makeRepo();
  write(dir, { 'pets.json': [{ pet: 'dogs', n: 3 }, { pet: 'cats', n: 1 }], 'design/share.mmd': 'pie title Share\n  "A" : 3\n  "B" : 1\n' });
  const j = ok(mis(dir, ['chart', 'pets.json', '--type', 'pie']));
  assert.deepEqual([j.type, j.series, j.points], ['pie', 1, 2]);
  const p = ok(mis(dir, ['chart', 'design/share.mmd']));
  assert.deepEqual([p.type, p.points, p.files], ['pie', 2, ['design/share.svg', 'design/share.html']]);
  assert.match(readFileSync(join(dir, 'design/share.svg'), 'utf8'), /\(75(\.0)?%\)/);
});

test('mis chart: refuses --out or input outside the repository, unknown columns, other mermaid diagrams', () => {
  const dir = makeRepo();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'mis-chart-out-')));
  write(dir, { 'd.csv': 'k,v\na,1\n', 'flow.mmd': 'flowchart TD\nA-->B\n', 'bad.csv': 'k,v\na,x\n' });
  const out = mis(dir, ['chart', 'd.csv', '--out', outside]);
  assert.equal(out.code, 1);
  assert.match(out.err, /outside the repository/);
  assert.ok(!existsSync(join(outside, 'd.svg')));
  const rel = mis(dir, ['chart', 'd.csv', '--out', '../escape']);
  assert.equal(rel.code, 1);
  assert.match(rel.err, /outside the repository/);
  write(outside, { 'x.csv': 'k,v\na,1\n' });
  assert.match(mis(dir, ['chart', join(outside, 'x.csv')]).err, /outside the repository/);
  const col = mis(dir, ['chart', 'd.csv', '--y', 'nope']);
  assert.equal(col.code, 1);
  assert.match(col.err, /unknown column "nope"/);
  assert.match(mis(dir, ['chart', 'bad.csv']).err, /no numeric columns|not a number/);
  assert.match(mis(dir, ['chart', 'bad.csv', '--y', 'v']).err, /row 1 column "v": not a number: x/);
  assert.match(mis(dir, ['chart', 'flow.mmd']).err, /pie.*xychart-beta/);
  assert.match(mis(dir, ['chart', 'notes.txt']).err, /usage: mis chart/);
});
