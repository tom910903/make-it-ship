// Data charts (user decision 2026-11-04): mermaid pie / xychart-beta and CSV/JSON rows → self-contained SVG, no dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, chartFromData, chartToSvg, parseCsv } from '../../scripts/lib/chart.mjs';

const safe = (svg) => {
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(svg, /<script/i);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
};

test('chart: mermaid pie with title and showData; percentages sum to ~100', () => {
  const m = parseChart('%% pets\npie showData\n  title Pets adopted\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15.5\n');
  assert.equal(m.kind, 'pie');
  assert.equal(m.title, 'Pets adopted');
  assert.equal(m.showData, true);
  assert.deepEqual(m.slices.map((s) => [s.label, s.value]), [['Dogs', 386], ['Cats', 85], ['Rats', 15.5]]);
  assert.equal(parseChart('pie title Inline\n"A": 1').title, 'Inline');
  const svg = chartToSvg(m);
  safe(svg);
  const pcts = [...svg.matchAll(/\((\d+(?:\.\d+)?)%\)/g)].map((x) => Number(x[1]));
  assert.equal(pcts.length, 3);
  assert.ok(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) < 0.5, String(pcts));
  assert.match(svg, /Dogs/);
  assert.throws(() => parseChart('pie\n"A" : -1'), /positive/);
  assert.match(chartToSvg(parseChart('pie\n"Only" : 3')), /\(100(\.0)?%\)/);
});

test('chart: xychart-beta with categories, y range, bar + line mix', () => {
  const m = parseChart('xychart-beta\n  title "Sales Revenue"\n  x-axis Months [jan, "feb, early", mar]\n  y-axis "Revenue (in $)" 4000 --> 11000\n  bar "2025" [5000, 6000, 7500]\n  line [5200, 6100, 7000.5]\n');
  assert.equal(m.kind, 'xy');
  assert.equal(m.horizontal, false);
  assert.equal(m.title, 'Sales Revenue');
  assert.deepEqual(m.categories, ['jan', 'feb, early', 'mar']);
  assert.equal(m.xLabel, 'Months');
  assert.equal(m.yLabel, 'Revenue (in $)');
  assert.deepEqual(m.yRange, [4000, 11000]);
  assert.deepEqual(m.series.map((s) => [s.type, s.name, s.values]), [['bar', '2025', [5000, 6000, 7500]], ['line', '', [5200, 6100, 7000.5]]]);
  const svg = chartToSvg(m);
  safe(svg);
  assert.match(svg, /<rect[^>]*class="[^"]*\bf0\b/);
  assert.match(svg, /<polyline[^>]*class="[^"]*\bk1\b/);
  assert.match(svg, /<circle/);
  assert.match(svg, /Sales Revenue/);
});

test('chart: horizontal xychart and numeric x-axis range', () => {
  const h = parseChart('xychart-beta horizontal\nx-axis [a, b]\ny-axis score\nbar [1, 2]');
  assert.equal(h.horizontal, true);
  assert.equal(h.yLabel, 'score');
  assert.equal(h.yRange, null);
  safe(chartToSvg(h));
  const n = parseChart('xychart-beta\nx-axis t 0 --> 10\nline [1, 2, 3]');
  assert.deepEqual(n.categories, ['0', '5', '10']);
  assert.equal(n.xLabel, 't');
});

test('chart: anything unsupported or malformed throws instead of drawing something else', () => {
  assert.throws(() => parseChart('xychart-beta\nbar [1, 2]\nstacked [1, 2]'), /cannot parse: stacked \[1, 2\]/);
  assert.throws(() => parseChart('xychart-beta\nbar [1, x]'), /cannot parse: bar \[1, x\]/);
  assert.throws(() => parseChart('pie\nDogs : 3'), /cannot parse: Dogs : 3/);
  assert.throws(() => parseChart('flowchart TD\nA-->B'), /pie.*xychart-beta/);
  assert.throws(() => parseChart('xychart-beta\nx-axis [a, b]\nbar [1, 2, 3]'), /3 values.*2 categories/);
  assert.throws(() => parseChart('xychart-beta\ntitle x'), /no series/);
});

test('chart: CSV parser handles quotes, escaped quotes, commas and newlines in fields, CRLF', () => {
  const rows = parseCsv('name,"note, long",n\r\n"a ""q""","x,\ny",1\r\nb,,2\r\n');
  assert.deepEqual(rows, [{ name: 'a "q"', 'note, long': 'x,\ny', n: '1' }, { name: 'b', 'note, long': '', n: '2' }]);
  assert.throws(() => parseCsv('a,b\n1\n'), /row 1.*1 field.*2/);
});

test('chart: chartFromData defaults (x = first column, y = numeric columns) and strict numbers', () => {
  const rows = [{ month: 'jan', sales: '10', cost: 4, note: 'x' }, { month: 'feb', sales: '12.5', cost: '-3', note: 'y' }];
  const m = chartFromData(rows, {});
  assert.equal(m.kind, 'xy');
  assert.deepEqual(m.categories, ['jan', 'feb']);
  assert.deepEqual(m.series.map((s) => [s.name, s.type, s.values]), [['sales', 'bar', [10, 12.5]], ['cost', 'bar', [4, -3]]]);
  const line = chartFromData(rows, { type: 'line', y: ['sales'], title: 'T' });
  assert.deepEqual([line.title, line.series.length, line.series[0].type], ['T', 1, 'line']);
  safe(chartToSvg(line));
  safe(chartToSvg(m));
  const pie = chartFromData(rows, { type: 'pie', y: ['sales'] });
  assert.deepEqual(pie.slices.map((s) => [s.label, s.value]), [['jan', 10], ['feb', 12.5]]);
  assert.throws(() => chartFromData(rows, { y: ['note'] }), /row 1 column "note": not a number: x/);
  assert.throws(() => chartFromData([{ a: '1', b: '1e' }], { y: ['b'] }), /row 1 column "b": not a number: 1e/);
  assert.throws(() => chartFromData(rows, { y: ['nope'] }), /unknown column "nope"/);
  assert.throws(() => chartFromData(rows, { type: 'pie' }), /pie.*one/);
  assert.throws(() => chartFromData(rows, { type: 'area' }), /--type/);
  assert.throws(() => chartFromData([], {}), /no rows/);
});

test('chart: a legend lists named series only (unnamed mermaid series get none, as on GitHub)', () => {
  const legendTexts = (svg) => [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="12" height="12"[^>]*\/><text[^>]*>([^<]*)</g)].map((m) => m[1]);
  const unnamed = chartToSvg(parseChart('xychart-beta\nx-axis [a, b]\nbar [1, 2]\nline [2, 3]'));
  assert.deepEqual(legendTexts(unnamed), []);
  assert.doesNotMatch(unnamed, /bar 1|line 2/);
  assert.deepEqual(legendTexts(chartToSvg(parseChart('xychart-beta\nx-axis [a, b]\nbar "Sales" [1, 2]\nline [2, 3]'))), ['Sales']);
  assert.deepEqual(legendTexts(chartToSvg(chartFromData([{ m: 'a', x: 1, y: 2 }], {}))), ['x', 'y']);
});

test('chart: --type hbar draws horizontal bars from rows', () => {
  const m = chartFromData([{ k: 'a', v: 1 }, { k: 'b', v: 3 }], { type: 'hbar' });
  assert.deepEqual([m.kind, m.horizontal, m.series.map((s) => s.type)], ['xy', true, ['bar']]);
  const bars = [...chartToSvg(m).matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" class="f0"/g)].map((r) => r.slice(1).map(Number));
  assert.equal(bars.length, 2);
  assert.ok(bars[1][2] > bars[0][2] && bars[0][3] === bars[1][3], 'value along the width');
});

test('chart: every label is escaped, so a label cannot inject markup', () => {
  const evil = '<script>alert(1)</script>';
  const svg = chartToSvg(chartFromData([{ k: evil, v: '1' }, { k: 'b', v: '2' }], { title: evil, y: ['v'] }));
  assert.doesNotMatch(svg, /<script/i);
  assert.match(svg, /&lt;script&gt;/);
  safe(svg);
  const pie = chartToSvg(parseChart(`pie title ${evil}\n"${evil}" : 1\n"b" : 2`));
  assert.doesNotMatch(pie, /<script/i);
});
