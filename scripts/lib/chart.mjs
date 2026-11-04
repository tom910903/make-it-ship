// Data charts (user decision 2026-11-04): mermaid `pie` / `xychart-beta` or CSV/JSON rows → one self-contained SVG.
// Pure Node: marketplace installs never run npm install. Unsupported mermaid lines throw rather than draw something else.
// shortcut: no stacked bars, log scales, label rotation or overlap avoidance; long or many labels may collide, use a charting tool then.
import { esc } from './diagram.mjs';

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const RANGE = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+))\\s*-->\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+))';
const unq = (s = '') => s.trim().replace(/^"(.*)"$/, '$1');
const list = (s) => [...s.matchAll(/\s*(?:"([^"]*)"|([^,]+))/g)].map((x) => x[1] ?? x[2].trim());
const fmt = (n) => String(Number(n.toPrecision(12))); // 0.1+0.2 prints as 0.3
const cannot = (line) => new Error(`cannot parse: ${line}`);

export function parseChart(src) {
  const lines = String(src).split('\n').map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  const head = lines.shift() ?? '';
  let m;
  if ((m = head.match(/^pie(\s+showData)?(?:\s+title\s+(.+))?$/))) return parsePie(lines, !!m[1], m[2]?.trim() ?? '');
  if ((m = head.match(/^xychart-beta(?:\s+(horizontal|vertical))?$/))) return parseXy(lines, m[1] === 'horizontal');
  throw new Error('chart must start with "pie" or "xychart-beta" (flowcharts: mis diagram)');
}

function parsePie(lines, showData, title) {
  const slices = [];
  for (const line of lines) {
    let r;
    if ((r = line.match(/^title\s+(.+)$/))) title = r[1].trim();
    else if (/^acc(?:Title|Descr)\s*:/.test(line)) continue; // accessibility text, not drawn
    else if ((r = line.match(/^"([^"]*)"\s*:\s*(\S+)$/)) && NUM.test(r[2])) {
      if (!(Number(r[2]) > 0)) throw new Error(`pie values must be positive: ${line}`); // mermaid rejects them too
      slices.push({ label: r[1], value: Number(r[2]) });
    } else throw cannot(line);
  }
  if (!slices.length) throw new Error('pie has no slices');
  return { kind: 'pie', title, showData, slices };
}

function parseXy(lines, horizontal) {
  const m = { kind: 'xy', title: '', horizontal, categories: null, xLabel: '', yLabel: '', yRange: null, series: [] };
  let xRange = null;
  for (const line of lines) {
    let r;
    const nums = (s) => { const v = list(s); if (!v.length || !v.every((x) => NUM.test(x))) throw cannot(line); return v.map(Number); };
    if ((r = line.match(/^title\s+(.+)$/))) m.title = unq(r[1]);
    else if ((r = line.match(/^x-axis(?:\s+(.*?))?\s*\[(.*)\]$/))) { m.xLabel = unq(r[1]); m.categories = list(r[2]); }
    else if ((r = line.match(new RegExp(`^x-axis(?:\\s+(.*?))?\\s+${RANGE}$`)))) { m.xLabel = unq(r[1]); xRange = [Number(r[2]), Number(r[3])]; }
    else if ((r = line.match(/^x-axis\s+(.+)$/))) m.xLabel = unq(r[1]);
    else if ((r = line.match(new RegExp(`^y-axis(?:\\s+(.*?))?\\s+${RANGE}$`)))) { m.yLabel = unq(r[1]); m.yRange = [Number(r[2]), Number(r[3])]; }
    else if ((r = line.match(/^y-axis\s+(.+)$/))) m.yLabel = unq(r[1]);
    else if ((r = line.match(/^(bar|line)(?:\s+("[^"]*"|[^\s"[]+))?\s*\[(.*)\]$/))) m.series.push({ type: r[1], name: unq(r[2]), values: nums(r[3]) });
    else if (!/^acc(?:Title|Descr)\s*:/.test(line)) throw cannot(line);
  }
  if (!m.series.length) throw new Error('xychart has no series (bar [...] or line [...])');
  const n = m.categories?.length ?? m.series[0].values.length;
  for (const s of m.series) if (s.values.length !== n) throw new Error(`${s.type} ${s.name || 'series'} has ${s.values.length} values but ${m.categories ? `x-axis has ${n} categories` : `the first series has ${n}`}`);
  // a numeric x-axis spreads the points evenly over its range, as mermaid does
  m.categories ??= Array.from({ length: n }, (_, i) => (xRange ? fmt(xRange[0] + (n > 1 ? (i * (xRange[1] - xRange[0])) / (n - 1) : 0)) : String(i + 1)));
  if (m.yRange && !(m.yRange[1] > m.yRange[0])) throw new Error(`y-axis range must go up: ${m.yRange.join(' --> ')}`);
  return m;
}

/** Model from CSV/JSON rows: x defaults to the first column, y to every other column whose values are all numbers. */
export function chartFromData(rows, { type = 'bar', x, y, title = '' } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('no rows to chart (expected a non-empty array of row objects)');
  if (!['bar', 'line', 'pie'].includes(type)) throw new Error(`--type must be bar, line or pie (got ${type})`);
  const cols = Object.keys(rows[0] ?? {});
  for (const c of [x, ...(y ?? [])]) if (c !== undefined && !cols.includes(c)) throw new Error(`unknown column "${c}" (columns: ${cols.join(', ')})`);
  const num = (v) => (typeof v === 'number' ? Number.isFinite(v) : NUM.test(String(v ?? '').trim()));
  x ??= cols[0];
  y ??= cols.filter((c) => c !== x && rows.every((r) => num(r[c])));
  if (!y.length) throw new Error(`no numeric columns to chart besides "${x}"; name them with --y`);
  const values = (c) => rows.map((r, i) => {
    if (!num(r[c])) throw new Error(`row ${i + 1} column "${c}": not a number: ${r[c]}`);
    return Number(typeof r[c] === 'number' ? r[c] : String(r[c]).trim());
  });
  const categories = rows.map((r) => String(r[x] ?? ''));
  if (type === 'pie') {
    if (y.length !== 1) throw new Error(`a pie chart takes exactly one --y column (got ${y.join(', ')})`);
    const slices = values(y[0]).map((value, i) => { if (!(value > 0)) throw new Error(`row ${i + 1} column "${y[0]}": pie values must be positive: ${value}`); return { label: categories[i], value }; });
    return { kind: 'pie', title, showData: false, slices };
  }
  return { kind: 'xy', title, horizontal: false, categories, xLabel: x, yLabel: y.length === 1 ? y[0] : '', yRange: null, series: y.map((c) => ({ type, name: c, values: values(c) })) };
}

/** RFC 4180-ish CSV: header row, quoted fields with "" escapes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, ''), recs = [];
  let rec = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c !== '"') field += c; else if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
    else if (c === '"' && field === '') q = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; rec.push(field); recs.push(rec); rec = []; field = ''; }
    else field += c;
  }
  if (q) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || rec.length) { rec.push(field); recs.push(rec); }
  const [head, ...body] = recs.filter((r) => r.length > 1 || r[0] !== '');
  if (!head) throw new Error('CSV is empty');
  return body.map((r, i) => {
    if (r.length !== head.length) throw new Error(`CSV row ${i + 1} has ${r.length} field(s), the header has ${head.length}`);
    return Object.fromEntries(head.map((h, j) => [h, r[j]]));
  });
}

// Colors live in classes so one @media block can switch the whole chart to dark.
const LIGHT = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const DARK = ['#60a5fa', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#a3e635'];
const css = (p, bg, fg, mute, grid) => `.bg{fill:${bg}}.fg{fill:${fg}}.mu{fill:${mute}}.ax{stroke:${mute}}.gr{stroke:${grid}}.sl{stroke:${bg}}.in{fill:${bg}}`
  + p.map((c, i) => `.f${i}{fill:${c}}.k${i}{stroke:${c};fill:none}`).join('');
const STYLE = `<style>${css(LIGHT, '#ffffff', '#1f2328', '#57606a', '#d0d7de')}@media (prefers-color-scheme: dark){${css(DARK, '#0d1117', '#e6edf3', '#8b949e', '#30363d')}}</style>`;
const W = 720, H = 420;
const r1 = (n) => Math.round(n * 10) / 10;

function niceTicks(min, max) {
  if (max <= min) max = min + 1;
  const raw = (max - min) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find((f) => f * mag >= raw) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { lo, hi, ticks };
}

function legend(items, x, y) {
  return items.map(([label, ci], i) => `<rect x="${x}" y="${y + i * 22}" width="12" height="12" rx="2" class="f${ci % 8}"/><text x="${x + 18}" y="${y + i * 22 + 11}" class="fg">${esc(label)}</text>`);
}

export function chartToSvg(m) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12" role="img" aria-label="${esc(m.title || 'chart')}">`,
    STYLE, '<rect class="bg" width="100%" height="100%"/>'];
  if (m.title) parts.push(`<text x="${W / 2}" y="28" text-anchor="middle" font-size="16" font-weight="600" class="fg">${esc(m.title)}</text>`);
  const top = m.title ? 48 : 20;
  parts.push(...(m.kind === 'pie' ? pie(m, top) : xy(m, top)), '</svg>');
  return parts.join('\n');
}

function pie(m, top) {
  const total = m.slices.reduce((a, s) => a + s.value, 0), r = (H - top - 20) / 2, cx = 24 + r, cy = top + r, out = [];
  let a = -Math.PI / 2;
  const at = (ang, k = r) => `${r1(cx + k * Math.cos(ang))} ${r1(cy + k * Math.sin(ang))}`;
  m.slices.forEach((s, i) => {
    const f = s.value / total, b = a + f * 2 * Math.PI;
    out.push(f > 0.9999 ? `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" class="f${i % 8} sl"/>` // one whole slice: an arc cannot close on itself
      : `<path d="M${r1(cx)} ${r1(cy)} L${at(a)} A${r1(r)} ${r1(r)} 0 ${f > 0.5 ? 1 : 0} 1 ${at(b)} Z" class="f${i % 8} sl" stroke-width="2"/>`);
    if (f >= 0.05) { const [tx, ty] = at((a + b) / 2, r * 0.65).split(' '); out.push(`<text x="${tx}" y="${ty}" text-anchor="middle" class="in">${(f * 100).toFixed(1)}%</text>`); }
    a = b;
  });
  return [...out, ...legend(m.slices.map((s, i) => [`${s.label}${m.showData ? `: ${fmt(s.value)}` : ''} (${((s.value / total) * 100).toFixed(1)}%)`, i]), cx + r + 32, top + 10)];
}

function xy(m, top) {
  const many = m.series.length > 1, left = 72, right = many ? 180 : 24, bottom = 64, pw = W - left - right, ph = H - top - bottom, out = [];
  const all = m.series.flatMap((s) => s.values);
  const nt = m.yRange ? niceTicks(...m.yRange) : niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const [lo, hi] = m.yRange ?? [nt.lo, nt.hi], ticks = nt.ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  const hz = m.horizontal, catLen = hz ? ph : pw, valLen = hz ? pw : ph, n = m.categories.length, band = catLen / n;
  const v = (x) => ((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * valLen; // out-of-range values clip at the axis, as in mermaid
  const pt = (c, d) => (hz ? [r1(left + d), r1(top + c)] : [r1(left + c), r1(top + ph - d)]); // c along categories, d along values
  for (const t of ticks) {
    const [x1, y1] = pt(0, v(t)), [x2, y2] = pt(catLen, v(t));
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="gr"/>`,
      hz ? `<text x="${x1}" y="${top + ph + 18}" text-anchor="middle" class="mu">${fmt(t)}</text>` : `<text x="${left - 8}" y="${y1 + 4}" text-anchor="end" class="mu">${fmt(t)}</text>`);
  }
  const [ox, oy] = pt(0, 0), [cx, cy] = pt(catLen, 0), [vx, vy] = pt(0, valLen);
  out.push(`<line x1="${ox}" y1="${oy}" x2="${cx}" y2="${cy}" class="ax"/>`, `<line x1="${ox}" y1="${oy}" x2="${vx}" y2="${vy}" class="ax"/>`);
  m.categories.forEach((c, i) => {
    const [x, y] = pt((i + 0.5) * band, 0);
    out.push(hz ? `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="mu">${esc(c)}</text>` : `<text x="${x}" y="${top + ph + 18}" text-anchor="middle" class="mu">${esc(c)}</text>`);
  });
  const bottomTitle = hz ? m.yLabel : m.xLabel, sideTitle = hz ? m.xLabel : m.yLabel;
  if (bottomTitle) out.push(`<text x="${left + pw / 2}" y="${H - 16}" text-anchor="middle" class="fg">${esc(bottomTitle)}</text>`);
  if (sideTitle) out.push(`<text transform="translate(16 ${top + ph / 2}) rotate(-90)" text-anchor="middle" class="fg">${esc(sideTitle)}</text>`);
  const bars = m.series.filter((s) => s.type === 'bar'), bw = (band * 0.8) / (bars.length || 1), base = v(Math.min(hi, Math.max(lo, 0)));
  m.series.forEach((s, si) => {
    const k = si % 8;
    if (s.type === 'bar') {
      const j = bars.indexOf(s);
      s.values.forEach((val, i) => {
        const c0 = i * band + band * 0.1 + j * bw, [x1, y1] = pt(c0, base), [x2, y2] = pt(c0 + bw, v(val));
        out.push(`<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${r1(Math.abs(x2 - x1))}" height="${r1(Math.abs(y2 - y1))}" class="f${k}"/>`);
      });
    } else {
      const ps = s.values.map((val, i) => pt((i + 0.5) * band, v(val)));
      out.push(`<polyline points="${ps.map((p) => p.join(',')).join(' ')}" class="k${k}" stroke-width="2"/>`, ...ps.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" class="f${k}"/>`));
    }
  });
  if (many) out.push(...legend(m.series.map((s, i) => [s.name || `${s.type} ${i + 1}`, i]), W - right + 16, top));
  return out;
}
