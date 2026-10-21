// Project wiki (absorbs OMC wiki_*: Karpathy-style markdown knowledge base that compounds across sessions).
// Location: <repo>/.make-it-ship/wiki/*.md, like OMC's .omc/wiki/: in the working tree so pages are plain files any
// tool can read, but git-ignored by default (a `*` .gitignore inside the dir, written before the first page), so wiki
// writes never show up as changes or make run evidence stale. Delete that .gitignore to commit the wiki.
// Pages: JSON-valued frontmatter (title, tags, category, confidence, links, sources, created, updated) + markdown.
// Links: [[Page Title]] → slug. index.md (catalog) and log.md (append-only operations) are reserved.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { repoRoot } from './tree-hash.mjs';

export const WIKI_DIR = '.make-it-ship/wiki';
export const CATEGORIES = ['architecture', 'decision', 'pattern', 'debugging', 'environment', 'session-log', 'reference', 'convention'];
const RESERVED = new Set(['index', 'log']);
const STALE_DAYS = 30, MAX_PAGE_BYTES = 10_240;

export const wikiDir = (cwd) => join(repoRoot(cwd), WIKI_DIR);

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n');
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Title → slug (OMC rule; non-ASCII-only titles get a stable hash name). */
export function slug(title) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return base || `page-${createHash('sha256').update(title).digest('hex').slice(0, 8)}`;
}

/** Page name from user input; null if unsafe (path separators, traversal) or reserved. */
export function pageName(input) {
  const n = String(input ?? '').replace(/\.md$/, '');
  return !n || /[/\\]|\.\./.test(n) || RESERVED.has(n) ? null : n;
}

const linksIn = (text) => [...new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => slug(m[1].trim())))];

function parse(raw) {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const v = line.slice(i + 1).trim();
    try { fm[line.slice(0, i).trim()] = JSON.parse(v); } catch { fm[line.slice(0, i).trim()] = v; }
  }
  if (typeof fm.title !== 'string' || !fm.title) return null;
  const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
  return {
    fm: { title: fm.title, tags: arr(fm.tags), category: fm.category || 'reference', confidence: fm.confidence || 'medium',
      links: arr(fm.links), sources: arr(fm.sources), created: String(fm.created ?? ''), updated: String(fm.updated ?? '') },
    body: m[2],
  };
}

const serialize = ({ fm, body }) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`;

export function readPage(cwd, name) {
  const n = pageName(name);
  const f = n && join(wikiDir(cwd), `${n}.md`);
  if (!f || !existsSync(f)) return null;
  const p = parse(readFileSync(f, 'utf8'));
  return p && { name: n, ...p };
}

/** @returns {{pages: object[], unparseable: string[]}} */
export function allPages(cwd) {
  const dir = wikiDir(cwd);
  if (!existsSync(dir)) return { pages: [], unparseable: [] };
  const pages = [], unparseable = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const name = f.slice(0, -3);
    if (RESERVED.has(name)) continue;
    const p = parse(readFileSync(join(dir, f), 'utf8'));
    if (p) pages.push({ name, ...p }); else unparseable.push(name);
  }
  return { pages, unparseable };
}

function log(dir, op, pages, summary) {
  const f = join(dir, 'log.md');
  if (!existsSync(f)) writeFileSync(f, '# Wiki Log\n\n');
  appendFileSync(f, `## [${new Date().toISOString()}] ${op}\n- Pages: ${pages.join(', ') || 'none'}\n- Summary: ${summary}\n\n`);
}

const firstLine = (body) => (body.split('\n').find((l) => l.trim() && !l.startsWith('# ')) ?? '').trim();

function reindex(cwd) {
  const { pages } = allPages(cwd);
  const lines = ['# Wiki Index', '', `> ${pages.length} pages`, ''];
  for (const cat of [...new Set(pages.map((p) => p.fm.category))].sort()) {
    lines.push(`## ${cat}`, '');
    for (const p of pages.filter((x) => x.fm.category === cat)) {
      const s = firstLine(p.body);
      lines.push(`- [${p.fm.title}](${p.name}.md) — ${s.length > 80 ? s.slice(0, 77) + '...' : s}`);
    }
    lines.push('');
  }
  atomicWrite(join(wikiDir(cwd), 'index.md'), lines.join('\n'));
}

const RANK = { low: 1, medium: 2, high: 3 };

/** Create a page or append-merge into the existing one (never replaces content). */
export function ingest(cwd, { title, content, tags = [], category = 'reference', sources = [], confidence = 'medium' }) {
  const dir = wikiDir(cwd);
  ensureDir(dir);
  const name = slug(title), now = new Date().toISOString();
  if (RESERVED.has(name)) throw new Error(`"${title}" maps to the reserved page ${name}.md: choose another title`);
  const old = readPage(cwd, name);
  const page = old
    ? { fm: { ...old.fm, tags: [...new Set([...old.fm.tags, ...tags])], sources: [...new Set([...old.fm.sources, ...sources])],
        links: [...new Set([...old.fm.links, ...linksIn(content)])], updated: now,
        confidence: RANK[confidence] >= (RANK[old.fm.confidence] ?? 2) ? confidence : old.fm.confidence },
      body: `${old.body.trimEnd()}\n\n---\n\n## Update (${now})\n\n${content}\n` }
    : { fm: { title, tags: [...new Set(tags)], category, confidence, links: linksIn(content), sources, created: now, updated: now },
      body: `\n# ${title}\n\n${content}\n` };
  atomicWrite(join(dir, `${name}.md`), serialize(page));
  reindex(cwd);
  log(dir, 'ingest', [name], old ? `Updated "${title}"` : `Created "${title}"`);
  return old ? { created: [], updated: [name] } : { created: [name], updated: [] };
}

export function deletePage(cwd, name) {
  const n = pageName(name), dir = wikiDir(cwd);
  if (!n || !existsSync(join(dir, `${n}.md`))) return false;
  rmSync(join(dir, `${n}.md`));
  reindex(cwd);
  log(dir, 'delete', [n], `Deleted "${n}"`);
  return true;
}

export const readIndex = (cwd) => { const f = join(wikiDir(cwd), 'index.md'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };

/** Latin words + CJK single chars and bigrams (OMC rule; Korean/Japanese/Chinese have no spaces to split on). */
export function tokenize(text) {
  const lower = text.toLowerCase(), out = lower.match(/[a-z0-9À-ɏ]+/g) ?? [];
  for (const seg of lower.match(/[぀-ヿ一-鿿가-힯]+/g) ?? []) {
    for (let i = 0; i < seg.length; i++) out.push(seg[i]);
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  return [...new Set(out)];
}

/** Keyword/tag relevance search (no embeddings): tag filter 3, term-in-tag 2, title 5 (or 2 per term), content 1 per term. */
export function query(cwd, text, { tags = [], category, limit = 20 } = {}) {
  const terms = tokenize(text), ql = text.toLowerCase();
  const hits = [];
  for (const p of allPages(cwd).pages) {
    if (category && p.fm.category !== category) continue;
    const ptags = p.fm.tags.map((t) => t.toLowerCase());
    let score = tags.filter((t) => ptags.includes(t.toLowerCase())).length * 3;
    for (const t of terms) if (ptags.some((pt) => pt.includes(t))) score += 2;
    const title = p.fm.title.toLowerCase();
    score += title.includes(ql) ? 5 : terms.filter((t) => title.includes(t)).length * 2;
    const body = p.body.toLowerCase();
    let snippet = '';
    for (const t of terms) {
      const i = body.indexOf(t);
      if (i < 0) continue;
      score++;
      if (!snippet) {
        const a = Math.max(0, i - 40), b = Math.min(body.length, i + t.length + 80);
        snippet = (a ? '...' : '') + p.body.slice(a, b).replace(/\n+/g, ' ').trim() + (b < body.length ? '...' : '');
      }
    }
    if (score > 0) hits.push({ page: p.name, title: p.fm.title, category: p.fm.category, confidence: p.fm.confidence, tags: p.fm.tags, score, snippet: snippet || firstLine(p.body).slice(0, 120) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Health checks: format (unparseable frontmatter), broken links, orphans, stale, low confidence, oversized. */
export function lint(cwd, now = Date.now()) {
  const { pages, unparseable } = allPages(cwd);
  const names = new Set(pages.map((p) => p.name));
  const incoming = new Set(pages.flatMap((p) => p.fm.links.filter((l) => l !== p.name)));
  const issues = unparseable.map((page) => ({ page, severity: 'error', type: 'format', message: `"${page}.md" has no valid frontmatter (needs --- block with a title)` }));
  for (const p of pages) {
    const t = p.fm.title;
    for (const l of p.fm.links) if (!names.has(l)) issues.push({ page: p.name, severity: 'error', type: 'broken-ref', message: `"${t}" links to missing page "${l}"` });
    if (!incoming.has(p.name)) issues.push({ page: p.name, severity: 'info', type: 'orphan', message: `No other page links to "${t}"` });
    const days = Math.floor((now - Date.parse(p.fm.updated)) / 86_400_000);
    if (days > STALE_DAYS) issues.push({ page: p.name, severity: 'warning', type: 'stale', message: `"${t}" not updated in ${days} days` });
    if (p.fm.confidence === 'low') issues.push({ page: p.name, severity: 'info', type: 'low-confidence', message: `"${t}" has low confidence: verify or remove` });
    if (Buffer.byteLength(p.body) > MAX_PAGE_BYTES) issues.push({ page: p.name, severity: 'warning', type: 'oversized', message: `"${t}" is over ${MAX_PAGE_BYTES / 1024}KB: consider splitting` });
  }
  const stats = { totalPages: pages.length + unparseable.length };
  for (const i of issues) stats[i.type] = (stats[i.type] ?? 0) + 1;
  return { issues, stats };
}

// Hook libraries: fail-open, never create a wiki that does not exist yet.

/** SessionStart: short wiki index ('' when there is no wiki). */
export function wikiSessionContext(cwd) {
  try {
    const { pages } = allPages(cwd);
    if (!pages.length) return '';
    if (!readIndex(cwd)) reindex(cwd);
    return [`[Project wiki: ${pages.length} pages at ${WIKI_DIR}/] Use wiki_query to search, wiki_list to browse, wiki_read to open a page.`, '',
      ...readIndex(cwd).split('\n').slice(0, 30)].join('\n');
  } catch { return ''; }
}

/** PreCompact: one-line wiki summary that survives compaction ('' when there is no wiki). */
export function wikiPreCompact(cwd) {
  try {
    const { pages } = allPages(cwd);
    if (!pages.length) return '';
    const latest = pages.map((p) => p.fm.updated).sort().at(-1);
    return `[Project wiki: ${pages.length} pages | categories: ${[...new Set(pages.map((p) => p.fm.category))].join(', ')} | last updated: ${latest}]`;
  } catch { return ''; }
}

/** SessionEnd: record a session-log page once per session id, only when the wiki already exists. */
export function wikiSessionEnd(cwd, meta = {}) {
  try {
    const dir = wikiDir(cwd);
    const id = meta.sessionId ?? meta.session_id; // accepts the raw SessionEnd hook payload too
    if (!existsSync(dir) || !id) return;
    const name = `session-log-${createHash('sha256').update(String(id)).digest('hex').slice(0, 12)}`;
    if (existsSync(join(dir, `${name}.md`))) return;
    const now = new Date().toISOString();
    atomicWrite(join(dir, `${name}.md`), serialize({
      fm: { title: `Session Log ${now.slice(0, 10)} ${String(id).slice(0, 8)}`, tags: ['session-log', 'auto-captured'], category: 'session-log',
        confidence: 'medium', links: [], sources: [String(id)], created: now, updated: now },
      body: `\n# Session Log\n\nSession ID: ${id}${meta.reason ? `\nEnd reason: ${meta.reason}` : ''}\n\nPromote significant findings to curated pages with wiki_ingest.\n`,
    }));
    reindex(cwd);
    log(dir, 'ingest', [name], `Auto-captured session log for ${id}`);
  } catch { /* fail-open */ }
}
