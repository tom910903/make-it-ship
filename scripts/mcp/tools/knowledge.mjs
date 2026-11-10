// Knowledge tools (absorbs OMC wiki_*, session_search, trace_*, deepinit_manifest, merge_readiness_*).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { CATEGORIES, WIKI_DIR, allPages, deletePage, ingest, lint, query, readIndex, readPage, slug } from '../../lib/wiki.mjs';
import { readTrace } from '../../lib/trace.mjs';
import { readTimeline, timelineText } from '../../lib/timeline.mjs';
import { readObservations, searchObservations, sinceMs } from '../../lib/observe.mjs';
import { readMemories } from '../../lib/summarize.mjs';
import { loadRun, readEvents, stateRoot } from '../../lib/state.mjs';
import { repoRoot } from '../../lib/tree-hash.mjs';
import { cancelGate, readGate, recordAnswer, renderGate, setContent, startGate, worktreeKey } from '../../lib/merge-readiness.mjs';

const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const fail = (msg) => { throw new Error(msg); };

// ---------- wiki ----------

const pageSchema = {
  title: str('Page title (becomes the slug)'), content: str('Markdown content; [[Other Page]] links pages'),
  tags: strs('Searchable tags'), category: { type: 'string', enum: CATEGORIES },
};

function renderPage(p) {
  const fm = p.fm;
  return [`## ${fm.title}`, `**Category:** ${fm.category} | **Confidence:** ${fm.confidence} | **Updated:** ${fm.updated}`, `**Tags:** ${fm.tags.join(', ')}`,
    ...(fm.links.length ? [`**Links:** ${fm.links.join(', ')}`] : []), ...(fm.sources.length ? [`**Sources:** ${fm.sources.join(', ')}`] : []), '', p.body].join('\n');
}

function ingestFile(cwd, a) {
  const root = realpathSync(repoRoot(cwd)), given = resolve(cwd, a.path);
  const file = existsSync(given) ? realpathSync(given) : given; // follow symlinks: the real file must be inside the repo
  if (!(file + sep).startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) fail(`path must be an existing file inside the repository: ${a.path}`);
  if (relative(root, file).split(sep).some((p) => p.toLowerCase() === '.git')) fail(`git internals are not wiki material (may hold credentials): ${a.path}`);
  const text = readFileSync(file, 'utf8');
  const title = a.title || text.match(/^#\s+(.+)$/m)?.[1].trim() || relative(root, file);
  return ingest(cwd, { title, content: text.replace(/^#\s+.+\n?/m, '').trim(), tags: a.tags, category: a.category, confidence: a.confidence,
    sources: [...(a.sources ?? []), relative(root, file).split(sep).join('/')] });
}

const wikiTools = [
  {
    name: 'wiki_add',
    description: `Add one page to the project wiki (${WIKI_DIR}, git-ignored by default). Fails if the page exists: use wiki_ingest to merge.`,
    inputSchema: { type: 'object', properties: pageSchema, required: ['title', 'content'] },
    handler: (a, { cwd }) => {
      if (readPage(cwd, slug(a.title))) fail(`page "${slug(a.title)}" already exists: use wiki_ingest to merge, or wiki_delete first`);
      const r = ingest(cwd, { title: a.title, content: a.content, tags: a.tags, category: a.category });
      return `Wiki page created: ${r.created[0]} (${WIKI_DIR}/${r.created[0]}.md)`;
    },
  },
  {
    name: 'wiki_ingest',
    description: 'Turn knowledge into wiki pages: give `path` (a file in the repo) to make a page from it, or `title` + `content`. Merges into an existing page by appending (never replaces).',
    inputSchema: { type: 'object', properties: { ...pageSchema, path: str('Repository file to turn into a page (title defaults to its first # heading)'),
      sources: strs('Source identifiers'), confidence: { type: 'string', enum: ['high', 'medium', 'low'] } } },
    handler: (a, { cwd }) => {
      if (a.path) return ingestFile(cwd, a);
      if (!a.title || !a.content) fail('give either path, or title and content');
      return ingest(cwd, a);
    },
  },
  {
    name: 'wiki_read',
    description: 'Read one wiki page by slug (".md" optional).',
    inputSchema: { type: 'object', properties: { page: str('Page slug, e.g. auth-architecture') }, required: ['page'] },
    handler: (a, { cwd }) => renderPage(readPage(cwd, a.page) ?? fail(`wiki page not found: ${a.page}`)),
  },
  {
    name: 'wiki_list',
    description: 'List wiki pages by category (the auto-maintained index).',
    inputSchema: { type: 'object', properties: {} },
    handler: (_a, { cwd }) => readIndex(cwd) ?? (allPages(cwd).pages.length ? allPages(cwd).pages.map((p) => `- ${p.name}`).join('\n') : 'Wiki is empty. Use wiki_add or wiki_ingest to create pages.'),
  },
  {
    name: 'wiki_query',
    description: 'Keyword and tag search over wiki pages (no embeddings; CJK-aware). Returns ranked pages with snippets; you synthesize the answer and cite pages.',
    inputSchema: { type: 'object', properties: { query: str('Search text'), tags: strs('Boost pages with these tags'), category: { type: 'string', enum: CATEGORIES },
      limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] },
    handler: (a, { cwd }) => query(cwd, a.query, a),
  },
  {
    name: 'wiki_delete',
    description: 'Delete one wiki page by slug.',
    inputSchema: { type: 'object', properties: { page: str('Page slug') }, required: ['page'] },
    handler: (a, { cwd }) => (deletePage(cwd, a.page) ? `Deleted wiki page: ${a.page}` : fail(`wiki page not found: ${a.page}`)),
  },
  {
    name: 'wiki_lint',
    description: 'Wiki health check: unparseable pages, broken [[links]], orphans, stale, low-confidence and oversized pages.',
    inputSchema: { type: 'object', properties: {} },
    handler: (_a, { cwd }) => lint(cwd),
  },
];

// ---------- session_search ----------

function projectsDir() {
  if (process.env.MIS_CLAUDE_PROJECTS_DIR) return process.env.MIS_CLAUDE_PROJECTS_DIR;
  const c = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(!c ? join(homedir(), '.claude') : c === '~' ? homedir() : c.startsWith('~/') ? join(homedir(), c.slice(2)) : c, 'projects');
}

function jsonlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? jsonlFiles(join(dir, e.name)) : e.name.endsWith('.jsonl') ? [join(dir, e.name)] : []);
}

const leaves = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
};

function texts(entry) {
  const c = entry.message?.content;
  if (typeof c === 'string') return [c];
  if (!Array.isArray(c)) return [];
  return c.flatMap((b) => b?.type === 'tool_result' ? leaves(b.content) : b?.type === 'tool_use' ? [`${b.name} ${leaves(b.input).join(' ')}`]
    : typeof b?.text === 'string' ? [b.text] : typeof b?.thinking === 'string' ? [b.thinking] : []);
}

const since = sinceMs;

function searchSessions(cwd, a) {
  const q = String(a.query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) fail('query cannot be empty');
  const norm = (s) => (a.caseSensitive ? s : s.toLowerCase()).replace(/\s+/g, ' ');
  const needle = norm(q), terms = needle.split(' '), ctx = Math.max(20, a.contextChars ?? 120), from = since(a.since);
  const scope = !a.project || a.project === 'current' ? 'current' : a.project === 'all' ? 'all' : 'project';
  let roots = [cwd];
  try { const top = repoRoot(cwd); roots = [...new Set([cwd, top, dirname(resolve(top, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: top, encoding: 'utf8' }).trim()))])]; } catch { /* not a git repo */ }
  const base = projectsDir();
  const files = scope === 'current' ? [...new Set(roots.flatMap((r) => jsonlFiles(join(base, r.replace(/[^a-zA-Z0-9]/g, '-')))))] : jsonlFiles(base);
  const within = (p) => typeof p === 'string' && roots.some((r) => p === r || p.startsWith(r + '/'));
  const results = [];
  // shortcut: reads each transcript whole; switch to a line stream if transcripts grow past tens of MB.
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
      let e; try { e = raw.trim() && JSON.parse(raw); } catch { return; }
      const sid = e?.sessionId ?? e?.session_id;
      if (!sid || (a.sessionId && sid !== a.sessionId)) return;
      if (scope === 'current' && !within(e.cwd)) return;
      if (scope === 'project' && !String(e.cwd ?? '').toLowerCase().includes(a.project.toLowerCase())) return;
      if (from && Date.parse(e.timestamp ?? 0) < from) return;
      for (const t of texts(e)) {
        const h = norm(t);
        let at = h.indexOf(needle);
        if (at < 0 && terms.every((x) => h.includes(x))) at = h.indexOf(terms[0]);
        if (at < 0) continue;
        const flat = t.replace(/\s+/g, ' ');
        const s = Math.max(0, at - ctx), end = Math.min(flat.length, at + ctx);
        results.push({ sessionId: sid, timestamp: e.timestamp, role: e.message?.role, sourcePath: file, line: i + 1,
          excerpt: (s ? '…' : '') + flat.slice(s, end).trim() + (end < flat.length ? '…' : '') });
        break;
      }
    });
  }
  results.sort((x, y) => (Date.parse(y.timestamp ?? 0) || 0) - (Date.parse(x.timestamp ?? 0) || 0) || x.sourcePath.localeCompare(y.sourcePath));
  return { query: q, scope: { mode: scope, project: a.project, projectsDir: base }, searchedFiles: files.length, totalMatches: results.length, results: results.slice(0, Math.max(1, a.limit ?? 10)) };
}

// ---------- trace ----------

function traceData(cwd, a) {
  const run = loadRun(cwd, a.runId);
  if (a.runId && !run) fail(`no run ${a.runId}`);
  let root = cwd; try { root = repoRoot(cwd); } catch { /* not a repo */ }
  const startMs = run ? Date.parse(run.state.startedAt) : 0;
  const hooks = readTrace().filter((t) => typeof t.cwd === 'string' && (t.cwd === root || t.cwd.startsWith(root + '/')) && Date.parse(t.at) >= startMs);
  const timeline = readTimeline(cwd).filter((t) => Date.parse(t.at) >= startMs);
  return { run, events: run ? readEvents(run) : [], hooks, timeline };
}

const detail = (e) => {
  const { at, type, ...rest } = e;
  if (type === 'check') return `check ${e.check} ${e.status}${e.exitCode !== undefined ? ` (exit ${e.exitCode})` : ''}`;
  const kv = Object.entries(rest).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(' ');
  return `${type}${kv ? ` ${kv}` : ''}`;
};

const traceTools = [
  {
    name: 'trace_timeline',
    description: 'Chronological timeline of Make It Ship activity for a run (default: current run; without a run, everything): run events (checks, reviews, verdicts, state changes) merged with hook trace entries and project timeline events (sessions with their kind, subagents, skills) for this repository.',
    inputSchema: { type: 'object', properties: { runId: str('Run id (default: current run)'), filter: { type: 'string', enum: ['all', 'run', 'checks', 'hooks', 'timeline'] },
      last: { type: 'integer', minimum: 1, description: 'Only the last N entries' } } },
    handler: (a, { cwd }) => {
      const { run, events, hooks, timeline } = traceData(cwd, a);
      const f = a.filter ?? 'all';
      let rows = [
        ...(f === 'hooks' ? [] : events.filter((e) => f !== 'checks' || e.type === 'check').map((e) => ({ at: e.at, kind: 'RUN', text: detail(e) }))),
        ...(f === 'all' || f === 'hooks' ? hooks.map((h) => ({ at: h.at, kind: 'HOOK', text: [h.hook, h.tool, h.decision, h.reason].filter(Boolean).join(' ') })) : []),
        ...(f === 'all' || f === 'timeline' ? timeline.map((t) => ({ at: t.at, kind: 'TL', text: timelineText(t) })) : []),
      ].sort((x, y) => x.at.localeCompare(y.at));
      if (a.last) rows = rows.slice(-a.last);
      const head = run ? `## Trace: run ${run.state.runId} (${run.state.state})` : '## Trace: no run found for this repository (hook traces only)';
      return [head, `Entries: ${rows.length}${f !== 'all' ? ` | filter: ${f}` : ''}`, '', ...rows.map((r) => `${r.at}  ${r.kind.padEnd(4)}  ${r.text}`)].join('\n');
    },
  },
  {
    name: 'trace_summary',
    description: 'Summary of a run (default: current): state, duration, event counts, check pass/fail, latest verdict, reviews, and hook trace counts for this repository.',
    inputSchema: { type: 'object', properties: { runId: str('Run id (default: current run)') } },
    handler: (a, { cwd }) => {
      const { run, events, hooks } = traceData(cwd, a);
      const count = (xs, key) => Object.entries(xs.reduce((m, x) => ({ ...m, [key(x)]: (m[key(x)] ?? 0) + 1 }), {})).map(([k, n]) => `- ${k}: ${n}`);
      const out = [];
      if (run) {
        const s = run.state, checks = events.filter((e) => e.type === 'check'), v = events.filter((e) => e.type === 'verdict').at(-1);
        const mins = events.length ? ((Date.parse(events.at(-1).at) - Date.parse(s.startedAt)) / 60000).toFixed(1) : '0.0';
        out.push(`## Trace Summary: run ${s.runId}`, '', `State: ${s.state} | Mode: ${s.mode ?? 'unset'} | Duration: ${mins} min | Events: ${events.length}`,
          `Checks: ${checks.filter((c) => c.status === 'PASS').length} PASS, ${checks.filter((c) => c.status === 'FAIL').length} FAIL${checks.length ? ` (${[...new Set(checks.map((c) => c.check))].join(', ')})` : ''}`,
          `Latest verdict: ${v?.verdict ?? 'none'}`, `Reviews: ${(s.reviews ?? []).map((r) => `${r.kind} (${r.blocking ?? 0} blocking)`).join(', ') || 'none'}`, '',
          '### Events by type', ...count(events, (e) => e.type), '');
      } else out.push('## Trace Summary: no run found for this repository', '');
      out.push('### Hooks', ...(hooks.length ? count(hooks, (h) => h.hook ?? 'unknown') : ['- none recorded']));
      return out.join('\n');
    },
  },
];

// ---------- deepinit_manifest ----------

const EXCLUDED = new Set(['node_modules', 'dist', 'build', '__pycache__', 'coverage', '.next', '.nuxt', 'vendor', 'target']);
const KEY_FILES = /^(readme(\..+)?|agents\.md|claude\.md|package\.json|tsconfig\.json|cargo\.toml|go\.mod|pyproject\.toml|setup\.py|requirements\.txt|gemfile|pom\.xml|build\.gradle(\.kts)?|makefile|dockerfile|index\.[a-z]+|main\.[a-z]+|mod\.rs|lib\.rs|__init__\.py)$/i;
const LANGS = { '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python',
  '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++',
  '.hpp': 'C++', '.cs': 'C#', '.scala': 'Scala', '.sh': 'Shell', '.md': 'Markdown', '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte', '.sql': 'SQL' };

/** Directory → sorted file names, from git (tracked + untracked, .gitignore respected); hidden and build dirs skipped. */
function scanDirs(root) {
  const out = {};
  for (const f of execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean)) {
    const d = posix.dirname(f);
    if (d !== '.' && d.split('/').some((s) => s.startsWith('.') || EXCLUDED.has(s))) continue;
    if (!existsSync(join(root, f))) continue; // deleted but still tracked
    (out[d] ??= []).push(posix.basename(f));
  }
  for (const d of Object.keys(out)) out[d].sort();
  return out;
}

function diffDirs(prev, cur) {
  const entries = new Map();
  for (const [p, files] of Object.entries(cur)) {
    if (!prev) { entries.set(p, { path: p, status: 'added', reason: 'first run (no manifest)' }); continue; }
    const old = prev[p]?.files;
    if (!old) { entries.set(p, { path: p, status: 'added', reason: 'new directory' }); continue; }
    const add = files.filter((f) => !old.includes(f)), del = old.filter((f) => !files.includes(f));
    entries.set(p, add.length || del.length
      ? { path: p, status: 'modified', reason: [add.length && `files added: ${add.join(', ')}`, del.length && `files removed: ${del.join(', ')}`].filter(Boolean).join('; ') }
      : { path: p, status: 'unchanged' });
  }
  for (const p of Object.keys(prev ?? {})) if (!(p in cur)) entries.set(p, { path: p, status: 'deleted', reason: 'directory no longer exists' });
  // A child added/deleted changes the parent's subdirectory table.
  for (const e of [...entries.values()].filter((x) => x.status === 'added' || x.status === 'deleted')) {
    const parts = e.path === '.' ? [] : e.path.split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      const anc = i ? parts.slice(0, i).join('/') : '.';
      if (entries.get(anc)?.status === 'unchanged') entries.set(anc, { path: anc, status: 'modified', reason: `child directory ${e.status}: ${e.path}` });
    }
  }
  const list = [...entries.values()].sort((x, y) => x.path.localeCompare(y.path));
  const summary = { total: list.length };
  for (const k of ['added', 'deleted', 'modified', 'unchanged']) summary[k] = list.filter((x) => x.status === k).length;
  return { entries: list, summary };
}

const deepinitTool = {
  name: 'deepinit_manifest',
  description: 'Directory manifest for writing hierarchical AGENTS.md docs. scan: per-directory file count, key files, languages. diff: directories changed since the saved manifest (file lists, not contents; mode full = all added). save: persist current state (dryRun to preview). check: whether a valid manifest exists.',
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['scan', 'diff', 'save', 'check'] }, mode: { type: 'string', enum: ['incremental', 'full'] }, dryRun: { type: 'boolean' } }, required: ['action'] },
  handler: (a, { cwd }) => {
    if (a.mode && a.action !== 'diff') fail(`mode is only valid with action=diff (got ${a.action})`);
    if (a.dryRun && a.action !== 'save') fail(`dryRun is only valid with action=save (got ${a.action})`);
    const root = repoRoot(cwd), file = join(stateRoot(cwd), 'deepinit', `${worktreeKey(cwd)}.json`);
    let saved = null;
    try { const m = JSON.parse(readFileSync(file, 'utf8')); if (m.version === 1 && m.directories) saved = m; } catch { /* missing or invalid */ }
    if (a.action === 'check') return { exists: existsSync(file), valid: !!saved, directoryCount: saved ? Object.keys(saved.directories).length : 0, generatedAt: saved?.generatedAt ?? null };
    const dirs = scanDirs(root);
    if (a.action === 'scan') {
      return { root, directories: Object.entries(dirs).sort(([x], [y]) => x.localeCompare(y)).map(([path, files]) => ({
        path, fileCount: files.length, keyFiles: files.filter((f) => KEY_FILES.test(f)),
        languages: files.reduce((m, f) => (LANGS[extname(f).toLowerCase()] ? { ...m, [LANGS[extname(f).toLowerCase()]]: (m[LANGS[extname(f).toLowerCase()]] ?? 0) + 1 } : m), {}),
        subdirs: Object.keys(dirs).filter((d) => d !== path && posix.dirname(d) === path).length,
      })) };
    }
    if (a.action === 'diff') return { mode: a.mode ?? 'incremental', manifestExists: !!saved, ...diffDirs(a.mode === 'full' ? null : saved?.directories ?? null, dirs) };
    const manifest = { version: 1, generatedAt: new Date().toISOString(), directories: Object.fromEntries(Object.entries(dirs).map(([p, files]) => [p, { files }])) };
    if (a.dryRun) return { dryRun: true, ...manifest };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(manifest, null, 2));
    renameSync(`${file}.tmp`, file);
    return `Manifest saved: ${Object.keys(dirs).length} directories at ${manifest.generatedAt}`;
  },
};

// ---------- merge_readiness ----------

const sid = { session_id: str('Gate session id (default: "default"); one gate per session per worktree') };

const mergeTools = [
  {
    name: 'merge_readiness_start',
    description: 'Start a merge-readiness gate for the current change (after tests/review). Profile from the summary: --quick | --deep (default standard); source: --from-diff | --from-artifacts (artifacts = Make It Ship run checks/reviews). Refuses to overwrite a pending attempt.',
    inputSchema: { type: 'object', properties: { summary: str('Change summary, optionally with --quick/--deep/--from-diff/--from-artifacts'), baseRef: str('Base ref for committed changes (default: upstream or origin/HEAD)'), ...sid }, required: ['summary'] },
    handler: (a, { cwd }) => {
      if (a.baseRef && (!/^[A-Za-z0-9._/@{}~^:-]+$/.test(a.baseRef) || a.baseRef.startsWith('-'))) fail('baseRef must be a valid git ref');
      const s = startGate(cwd, String(a.summary).slice(0, 2000), { sessionId: a.session_id, baseRef: a.baseRef });
      if (s.result === 'blocked') fail(`blocked: ${s.validation_errors.join(' ')} Missing: ${s.evidence.missingEvidence.join(' ')}`);
      return `Merge-readiness started (profile: ${s.profile}, threshold: ${s.threshold}, max rounds: ${s.max_rounds}, required: ${s.required_dimensions.join(', ')}). ${s.evidence.run ? `Run ${s.evidence.run.runId} verdict: ${s.evidence.run.verdict}. ` : ''}Next: merge_readiness_set_content.`;
    },
  },
  {
    name: 'merge_readiness_set_content',
    description: 'Submit the five-section explanation (why, whatChanged, tradeoffs, risksConsidered, teamUnderstanding) and the multiple-choice questions (each with correctOptionId) covering every required dimension. Then ask the human one question per round.',
    inputSchema: { type: 'object', properties: {
      why: str('Why the change exists'), whatChanged: str('What changed'), tradeoffs: str('Tradeoffs'), risksConsidered: str('Risks considered'), teamUnderstanding: str('What the team should understand'),
      questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, dimension: { type: 'string', enum: ['why', 'change', 'tradeoff', 'risk', 'team'] }, stem: { type: 'string' },
        options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } }, correctOptionId: { type: 'string' }, rationale: { type: 'string' } },
        required: ['id', 'dimension', 'stem', 'options', 'correctOptionId'] } }, ...sid },
      required: ['why', 'whatChanged', 'tradeoffs', 'risksConsidered', 'teamUnderstanding', 'questions'] },
    handler: (a, { cwd }) => {
      const { state, errors } = setContent(cwd, a, { sessionId: a.session_id });
      if (errors.length) fail(`content rejected: ${errors.join(' ')}`);
      const q = state.pending_question;
      return { accepted: true, next: { id: q.id, dimension: q.dimension, stem: q.stem, options: q.options } };
    },
  },
  {
    name: 'merge_readiness_record_answer',
    description: 'Record the option the human chose for the pending question. Returns the next question, or the result (pass / paused) with the readiness score.',
    inputSchema: { type: 'object', properties: { questionId: str('Pending question id'), optionId: str('Chosen option id'), ...sid }, required: ['questionId', 'optionId'] },
    handler: (a, { cwd }) => {
      const s = recordAnswer(cwd, a.questionId, a.optionId, { sessionId: a.session_id });
      if (!s) fail('answer rejected: no active gate in the questioning phase, or questionId/optionId does not match the pending question');
      if (s.result === 'pass') return `Merge-readiness pass. Readiness score: ${s.readiness_score}. The change may proceed to human merge approval (this does not approve it).`;
      if (s.result === 'paused') return `Merge-readiness paused. Readiness score: ${s.readiness_score} (threshold ${s.threshold}). Reread the report (merge_readiness_report) and run merge_readiness_start again.`;
      const q = s.pending_question;
      return { recorded: true, answered: `${s.answers.length}/${Math.min(s.questions.length, s.max_rounds)}`, next: { id: q.id, dimension: q.dimension, stem: q.stem, options: q.options } };
    },
  },
  {
    name: 'merge_readiness_report',
    description: 'Render the merge-readiness gate as a Markdown report (read-only): explanation, evidence incl. the Make It Ship run verdict, quiz progress, result, merge boundary. Answer keys stay hidden until the attempt completes.',
    inputSchema: { type: 'object', properties: { ...sid } },
    handler: (a, { cwd }) => renderGate(readGate(cwd, a.session_id) ?? fail('no merge-readiness gate found: call merge_readiness_start')),
  },
  {
    name: 'merge_readiness_cancel',
    description: 'Cancel the active merge-readiness gate; the terminal state is kept as the audit record.',
    inputSchema: { type: 'object', properties: { ...sid } },
    handler: (a, { cwd }) => (cancelGate(cwd, { sessionId: a.session_id }) ? 'Merge-readiness cancelled. Terminal state kept as the audit record.' : fail('no active gate to cancel')),
  },
];

export const tools = [...wikiTools, { name: 'session_search', description: 'Search past Claude Code session transcripts of this project (read-only): ~/.claude/projects/<encoded path>/*.jsonl, honoring CLAUDE_CONFIG_DIR. Returns matches with session id, timestamp and excerpt, newest first.',
  inputSchema: { type: 'object', properties: { query: str('Text to find (exact phrase, else all words)'), limit: { type: 'integer', minimum: 1 }, sessionId: str('Only this session'),
    since: str('Relative (7d, 24h, 30m, 2w) or absolute date'), project: str('"current" (default), "all", or a substring of the project path'), caseSensitive: { type: 'boolean' },
    contextChars: { type: 'integer', minimum: 20 } }, required: ['query'] },
  handler: (a, { cwd }) => searchSessions(cwd, a) },
{ name: 'memory_search', description: 'Search this project\'s memory: raw observations (one per tool use: edits, reads, commands, tests, commits, agents, skills, failures) and the summarized records made from them each turn (bugfix, feature, refactor, change, discovery, decision; numeric ids). BM25 over title, command, files and error; returns records with id, time, type and score, best first.',
  inputSchema: { type: 'object', properties: { query: str('Words to find (Korean, Japanese and Chinese work too)'), type: { type: 'string', enum: ['bugfix', 'feature', 'refactor', 'change', 'discovery', 'decision', 'read', 'test', 'commit', 'command', 'agent', 'skill', 'failure'] },
    since: str('Relative (7d, 24h, 30m, 2w) or absolute date'), limit: { type: 'integer', minimum: 1 } }, required: ['query'] },
  handler: (a, { cwd }) => (String(a.query ?? '').trim() ? searchObservations([...readObservations(cwd), ...readMemories(cwd)], a.query, a) : fail('query is empty')) }, ...traceTools, deepinitTool, ...mergeTools];
