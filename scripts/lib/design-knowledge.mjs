// Design knowledge for building UI on any platform: the ui-ux-pro-max data (vendor/ui-ux-pro-max, MIT, unmodified CSV)
// searched with BM25 like the original's search.py, in Node without dependencies. Product types → style, palette, type and
// UX rules; per-stack rules for web, mobile, desktop and three.js. Read-only.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = fileURLToPath(new URL('../../vendor/ui-ux-pro-max/data', import.meta.url));

// domain → file, the columns searched and the columns shown (the original's CSV_CONFIG, shown columns trimmed to what a
// design decision needs; --full shows every column)
export const DOMAINS = {
  product: { file: 'products.csv', search: ['Product Type', 'Keywords', 'Primary Style Recommendation', 'Key Considerations'],
    show: ['Product Type', 'Primary Style Recommendation', 'Secondary Styles', 'Landing Page Pattern', 'Dashboard Style (if applicable)', 'Color Palette Focus', 'Key Considerations'] },
  reasoning: { file: 'ui-reasoning.csv', search: ['UI_Category', 'Recommended_Pattern', 'Style_Priority', 'Decision_Rules'],
    show: ['UI_Category', 'Recommended_Pattern', 'Style_Priority', 'Color_Mood', 'Typography_Mood', 'Key_Effects', 'Decision_Rules', 'Anti_Patterns'] },
  style: { file: 'styles.csv', search: ['Style ID', 'Style Category', 'Aliases', 'Keywords', 'Best For', 'Type', 'AI Prompt Keywords'],
    show: ['Style Category', 'Type', 'Keywords', 'Primary Colors', 'Effects & Animation', 'Best For', 'Do Not Use For', 'Performance', 'Accessibility', 'Implementation Checklist'] },
  color: { file: 'colors.csv', search: ['Product Type', 'Notes'],
    show: ['Product Type', 'Primary', 'On Primary', 'Secondary', 'Accent', 'Background', 'Foreground', 'Card', 'Muted', 'Muted Foreground', 'Border', 'Destructive', 'Ring', 'Notes'] },
  typography: { file: 'typography.csv', search: ['Font Pairing Name', 'Category', 'Mood/Style Keywords', 'Best For', 'Heading Font', 'Body Font'],
    show: ['Font Pairing Name', 'Heading Font', 'Body Font', 'Mood/Style Keywords', 'Best For', 'Google Fonts URL', 'Notes'] },
  ux: { file: 'ux-guidelines.csv', search: ['Category', 'Issue', 'Description', 'Platform'],
    show: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Severity'] },
  app: { file: 'app-interface.csv', search: ['Category', 'Issue', 'Keywords', 'Description'],
    show: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Severity'] },
  motion: { file: 'motion.csv', search: ['Category', 'Intensity Tier', 'Keywords', 'Trigger'],
    show: ['Category', 'Intensity Tier', 'Trigger', 'Duration', 'Easing', 'Do', "Don't", 'Performance Notes'] },
  chart: { file: 'charts.csv', search: ['Data Type', 'Keywords', 'Best Chart Type', 'When to Use', 'When NOT to Use', 'Accessibility Notes'],
    show: ['Data Type', 'Best Chart Type', 'Secondary Options', 'When to Use', 'When NOT to Use', 'Color Guidance', 'Accessibility Notes', 'A11y Fallback'] },
  landing: { file: 'landing.csv', search: ['Pattern ID', 'Pattern Name', 'Aliases', 'Keywords', 'Conversion Optimization', 'Section Order'],
    show: ['Pattern Name', 'Section Order', 'Primary CTA Placement', 'Color Strategy', 'Conversion Optimization'] },
  icons: { file: 'icons.csv', search: ['Category', 'Icon Name', 'Keywords', 'Best For', 'Library'],
    show: ['Icon Name', 'Library', 'Import Code', 'Usage', 'Best For', 'Semantic Role'] },
  'react-perf': { file: 'react-performance.csv', search: ['Category', 'Issue', 'Keywords', 'Description'],
    show: ['Category', 'Issue', 'Description', 'Do', "Don't", 'Severity'] },
};
const STACK = { search: ['Category', 'Guideline', 'Description', 'Do', "Don't", 'Code Good', 'Code Bad'],
  show: ['Category', 'Guideline', 'Description', 'Do', "Don't", 'Code Good', 'Code Bad', 'Severity', 'Docs URL'] };
/** what a search without --domain returns: enough for a first design brief */
export const BRIEF = ['product', 'reasoning', 'style', 'color', 'typography', 'ux'];

export const stacks = () => readdirSync(join(DATA, 'stacks')).filter((f) => f.endsWith('.csv')).map((f) => f.slice(0, -4)).sort();

/** RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes. Returns rows as objects keyed by the header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const STOP = new Set(['to', 'in', 'on', 'at', 'is', 'of', 'by', 'or', 'an', 'if', 'no', 'so', 'do', 'be', 'we', 'it', 'as', 'the', 'and', 'for', 'are', 'was', 'with', 'app']);
export const tokenize = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));

/** BM25 (k1 1.5, b 0.75) over the docs; returns [index, score] for the docs that share a term, best first. */
export function bm25(docs, query, { k1 = 1.5, b = 0.75 } = {}) {
  const corpus = docs.map(tokenize), N = corpus.length, avg = corpus.reduce((n, d) => n + d.length, 0) / (N || 1) || 1;
  const df = new Map();
  for (const d of corpus) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  return corpus.map((d, i) => {
    let score = 0;
    for (const w of q) {
      const f = d.filter((x) => x === w).length;
      if (!f) continue;
      const idf = Math.log((N - df.get(w) + 0.5) / (df.get(w) + 0.5) + 1);
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg));
    }
    return [i, score];
  }).filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]);
}

const cache = new Map();
const load = (file) => { if (!cache.has(file)) cache.set(file, parseCsv(readFileSync(join(DATA, file), 'utf8'))); return cache.get(file); };
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => row[c]).map((c) => [c, row[c]]));

/** Rows of one domain (or one stack's rules) that match the query, best first, with the columns that matter. */
export function search(query, { domain, stack, limit = 3, full = false } = {}) {
  if (!String(query ?? '').trim()) throw new Error('usage: mis design search <query> [--domain d] [--stack s] [--limit n]');
  let file, cfg;
  if (stack) {
    if (!stacks().includes(stack)) throw new Error(`unknown stack "${stack}"; stacks: ${stacks().join(', ')}`);
    file = `stacks/${stack}.csv`; cfg = STACK;
  } else {
    cfg = DOMAINS[domain];
    if (!cfg) throw new Error(`unknown domain "${domain}"; domains: ${Object.keys(DOMAINS).join(', ')}`);
    file = cfg.file;
  }
  const rows = load(file);
  return bm25(rows.map((r) => cfg.search.map((c) => r[c] ?? '').join(' ')), query).slice(0, limit)
    .map(([i, score]) => ({ score: Math.round(score * 100) / 100, ...(full ? rows[i] : pick(rows[i], cfg.show)) }));
}

/** A first design brief: the best rows of each BRIEF domain for the query (what the product is, for whom, on which platform). */
export function brief(query, { limit = 2 } = {}) {
  return Object.fromEntries(BRIEF.map((d) => [d, search(query, { domain: d, limit })]));
}
