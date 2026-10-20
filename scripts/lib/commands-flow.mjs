// mis commands of M9-B: the machinery behind planning, review, design, docs, audit, release and memory features that
// the run phases use at the right step (and natural-language requests reach through the existing skills).
// Storage: per-repo private data (contexts, goals, questions, taste) under the state root (shared by worktrees, outside
// the code hash); team-shared append-only ledgers (decisions, health) under docs/make-it-ship/*.jsonl.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { repoRoot, REPORT_DIR } from './tree-hash.mjs';
import { stateRoot, loadRun } from './state.mjs';
import { loadConfig } from './config.mjs';
import { shortcutDebt, renderDebt } from './debt.mjs';
import { scanTree, scanHistory, scanText, describeFindings } from './redact.mjs';
import { bumpVersion, currentVersion, nextVersion, diffScope, repoMode, LEVELS } from './release.mjs';
import { QID, validateQuestionLog, deriveProfile } from './questions.mjs';
import { parseMermaid, toExcalidraw, toSvg } from './diagram.mjs';

const fail = (msg) => { throw new Error(msg); };
function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}
const readArg = (cwd, a) => (a === '-' ? readFileSync(0, 'utf8') : existsSync(resolve(cwd, a)) ? readFileSync(resolve(cwd, a), 'utf8') : a);
function jsonArg(cwd, a) {
  if (!a) fail('missing JSON argument');
  try { return JSON.parse(readArg(cwd, a)); } catch (e) { return fail(`invalid JSON: ${e.message}`); }
}
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const saveJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const appendJsonl = (p, e) => { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(e) + '\n'); };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const gitOut = (cwd, ...a) => { const r = git(cwd, ...a); return r.status === 0 ? r.stdout.trim() : ''; };
const NAME = /^[\w.-]{1,64}$/;
/** Report a failing result on stdout and exit 1 (a scan used as a gate). */
const failWith = (out) => { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return undefined; };

// ---------------------------------------------------------------- B5 audit, secrets, health

function debt(args, cwd) {
  const items = shortcutDebt(repoRoot(cwd));
  return args.includes('--json') ? { items, total: items.length, noTrigger: items.filter((d) => !d.trigger).length } : renderDebt(items);
}

function redact([sub, ...args], cwd) {
  if (sub !== 'scan') fail('usage: mis redact scan [--history]');
  const root = repoRoot(cwd);
  const findings = [...scanTree(root).map((f) => ({ where: 'tree', ...f })), ...(args.includes('--history') ? scanHistory(root).map((f) => ({ where: 'history', ...f })) : [])];
  const out = { clean: !findings.length, scope: args.includes('--history') ? 'working tree + git history' : 'working tree', findings,
    ...(findings.length ? { next: 'Values are not shown. Remove the secret, rotate it (it is compromised once committed), and for history findings rewrite history only with the user\'s approval.' } : {}) };
  return findings.length ? failWith(out) : out;
}

const WEIGHTS = [[/test/i, 30], [/type|tsc|mypy/i, 25], [/lint|eslint|ruff|clippy/i, 20], [/build|compile/i, 15]];
const weightOf = (name) => WEIGHTS.find(([re]) => re.test(name))?.[1] ?? 10;

/** Weighted health score of the project's checks (gstack health). Does not record run evidence. */
function health(args, cwd) {
  const root = repoRoot(cwd);
  const cfg = loadConfig(root);
  if (!cfg.config) fail(cfg.exists ? `.make-it-ship.json invalid: ${cfg.errors.join('; ')}` : 'no .make-it-ship.json (run mis init)');
  const checks = {};
  let total = 0, got = 0;
  for (const [name, def] of Object.entries(cfg.config.checks)) {
    if (name.startsWith('qa-')) continue; // real-use QA needs a running app; health is the static dashboard
    const t0 = Date.now();
    const r = spawnSync(def.argv[0], def.argv.slice(1), { cwd: root, stdio: 'ignore', timeout: def.timeoutSec * 1000, killSignal: 'SIGKILL', env: { CI: '1', ...process.env } });
    const status = r.error ? 'BLOCKED' : r.status === 0 ? 'PASS' : 'FAIL';
    const weight = weightOf(name);
    checks[name] = { status, weight, ms: Date.now() - t0 };
    if (status !== 'BLOCKED') { total += weight; if (status === 'PASS') got += weight; }
  }
  const debtCount = shortcutDebt(root).length;
  const score = total ? Math.round((got / total) * 100) : null;
  const file = join(root, REPORT_DIR, 'health.jsonl');
  const history = readJsonl(file);
  const prev = history.at(-1) ?? null;
  const entry = { at: new Date().toISOString(), score, checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.status])), debt: debtCount };
  if (!args.includes('--no-record')) appendJsonl(file, entry);
  return { score, checks, debt: debtCount, previous: prev?.score ?? null, delta: prev?.score != null && score != null ? score - prev.score : null,
    trend: [...history, entry].slice(-10).map((h) => h.score), history: args.includes('--no-record') ? null : relative(root, file),
    note: score === null ? 'no check could run (all BLOCKED)' : 'BLOCKED checks are left out of the score and listed above' };
}

// ---------------------------------------------------------------- B6 release

function versionBump([level, ...args], cwd) {
  const date = flag(args, '--date') ?? new Date().toISOString().slice(0, 10);
  if (!LEVELS.includes(level)) fail('usage: mis version-bump <patch|minor|major> [--date YYYY-MM-DD]');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must be YYYY-MM-DD');
  return bumpVersion(repoRoot(cwd), level, date);
}

function nextVersionCmd([level], cwd) {
  if (!LEVELS.includes(level)) fail('usage: mis next-version <patch|minor|major>');
  const from = currentVersion(repoRoot(cwd));
  return { from, to: nextVersion(from, level), level };
}

function defaultBase(root, cwd) {
  try { const b = loadRun(cwd)?.state.baseCommit; if (b) return b; } catch { /* no run */ }
  for (const b of ['main', 'master']) if (git(root, 'rev-parse', '--verify', '-q', b).status === 0 && gitOut(root, 'branch', '--show-current') !== b) return gitOut(root, 'merge-base', b, 'HEAD') || b;
  return 'HEAD';
}

function diffScopeCmd(args, cwd) {
  const root = repoRoot(cwd);
  const base = flag(args, '--base') ?? defaultBase(root, cwd);
  const changed = gitOut(root, 'diff', '--name-only', base).split('\n').filter(Boolean);
  const untracked = gitOut(root, 'ls-files', '-o', '--exclude-standard').split('\n').filter(Boolean);
  const files = [...new Set([...changed, ...untracked])].filter((f) => !f.startsWith(`${REPORT_DIR}/`));
  return { base, ...diffScope(files) };
}

function repoModeCmd(args, cwd) {
  const days = Number(flag(args, '--days') ?? 90);
  if (!Number.isInteger(days) || days < 1) fail('--days must be a positive integer');
  return repoMode(repoRoot(cwd), days);
}

// ---------------------------------------------------------------- B7 context, goals, global sessions

function context([sub, ...args], cwd) {
  const root = repoRoot(cwd);
  const dir = join(stateRoot(cwd), 'contexts');
  const branch = () => gitOut(root, 'branch', '--show-current') || null;
  if (sub === 'save') {
    const note = flag(args, '--note');
    const name = args[0] ?? `ctx-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    if (!NAME.test(name)) fail('context name: letters, digits, . _ - (max 64)');
    const rec = { name, branch: branch(), head: gitOut(root, 'rev-parse', 'HEAD') || null, worktree: root,
      status: gitOut(root, 'status', '--porcelain').split('\n').filter(Boolean).slice(0, 200),
      note: note === '-' ? readFileSync(0, 'utf8') : note ?? null, at: new Date().toISOString() };
    saveJson(join(dir, `${name}.json`), rec);
    return { saved: name, branch: rec.branch, changedFiles: rec.status.length };
  }
  const all = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean)
    .sort((a, b) => b.at.localeCompare(a.at)) : []);
  if (sub === 'list') return { contexts: all().map(({ name, branch: b, at, note }) => ({ name, branch: b, at, note: note?.split('\n')[0] ?? null })) };
  if (sub === 'restore') {
    const rec = args[0] ? readJson(join(dir, `${NAME.test(args[0]) ? args[0] : '_'}.json`)) : all()[0];
    if (!rec) fail(args[0] ? `no saved context "${args[0]}" (mis context list)` : 'no saved context (mis context save <name>)');
    const warnings = [];
    const now = branch();
    if (rec.branch !== now) warnings.push(`branch mismatch: saved on ${rec.branch ?? 'detached HEAD'}, now on ${now ?? 'detached HEAD'} — switch branches (git switch ${rec.branch}) or confirm you mean to continue here`);
    const head = gitOut(root, 'rev-parse', 'HEAD');
    if (rec.head && head && rec.head !== head) {
      const n = gitOut(root, 'rev-list', '--count', `${rec.head}..HEAD`);
      warnings.push(n ? `${n} commit(s) since the save: review git log ${rec.head.slice(0, 12)}..HEAD` : `HEAD moved from ${rec.head.slice(0, 12)} (not an ancestor)`);
    }
    return { ...rec, warnings };
  }
  if (sub === 'sessions') return globalSessions(Number(flag(args, '--limit') ?? 30));
  return fail('usage: mis context save [<name>] [--note <text>|-] | restore [<name>] | list | sessions [--limit N]');
}

/** Claude Code sessions of every project on this machine (gstack global-discover; Codex/Gemini sessions are other hosts). */
export function globalSessions(limit = 30) {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  if (!existsSync(base)) return { projects: [], base };
  const projects = [];
  for (const d of readdirSync(base)) {
    const p = join(base, d);
    if (!statSync(p).isDirectory()) continue;
    const files = readdirSync(p).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, m: statSync(join(p, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    if (!files.length) continue;
    let cwd = null;
    for (const l of readFileSync(join(p, files[0].f), 'utf8').split('\n', 50)) { try { cwd = JSON.parse(l).cwd ?? cwd; } catch { /* partial line */ } if (cwd) break; }
    projects.push({ project: cwd ?? d, sessions: files.length, lastActive: new Date(files[0].m).toISOString(), latestSession: basename(files[0].f, '.jsonl') });
  }
  projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
  return { base, projects: projects.slice(0, limit) };
}

function handoff(g) {
  if (!g) return 'All goals are done.';
  return `/goal ${g.id}: ${g.title}.${g.criteria.length ? ` Done when: ${g.criteria.join('; ')}.` : ''} Verify with mis check / mis verdict, then record it: mis goal done ${g.id} --evidence "<check id or verdict>".`;
}

/** Durable multi-goal ledger (OMC ultragoal): goals survive sessions; the handoff text starts the next one. */
function goal([sub, ...args], cwd) {
  const file = join(stateRoot(cwd), 'goals.json');
  const led = readJson(file, { goals: [] });
  const open = () => led.goals.find((g) => g.status === 'open');
  if (sub === 'add') {
    const criteria = (flag(args, '--criteria') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    const title = args.join(' ').trim();
    if (!title) fail('usage: mis goal add <title> [--criteria "a; b"]');
    const g = { id: `G${led.goals.length + 1}`, title, criteria, status: 'open', evidence: null, addedAt: new Date().toISOString() };
    led.goals.push(g);
    saveJson(file, led);
    return { added: g, handoff: handoff(open()) };
  }
  if (sub === 'done') {
    const evidence = flag(args, '--evidence');
    const g = led.goals.find((x) => x.id === args[0]) ?? fail(`no goal ${args[0]} (mis goal list)`);
    if (!evidence) fail('--evidence is required (the mis check id or verdict that proves the goal)');
    if (g.status === 'done') fail(`goal ${g.id} is already done`);
    Object.assign(g, { status: 'done', evidence, doneAt: new Date().toISOString() });
    saveJson(file, led);
    return { done: g.id, remaining: led.goals.filter((x) => x.status === 'open').length, handoff: handoff(open()) };
  }
  if (sub === 'list' || sub === undefined) return { goals: led.goals, handoff: handoff(open()) };
  if (sub === 'handoff') return handoff(open());
  return fail('usage: mis goal add <title> [--criteria "a; b"] | list | done <id> --evidence <text> | handoff');
}

// ---------------------------------------------------------------- B3 plan-tune

const qPaths = (cwd) => ({ log: join(stateRoot(cwd), 'questions.jsonl'), prefs: join(stateRoot(cwd), 'question-prefs.json') });
export const questionPrefs = (cwd) => readJson(qPaths(cwd).prefs, {});

function question([sub, ...args], cwd) {
  const p = qPaths(cwd);
  if (sub === 'log') {
    const e = jsonArg(cwd, args[0]);
    const errs = validateQuestionLog(e);
    if (errs.length) fail(`question entry invalid: ${errs.join('; ')}`);
    appendJsonl(p.log, { ...e, at: new Date().toISOString() });
    return { logged: e.qid, total: readJsonl(p.log).length };
  }
  if (sub === 'pref') {
    const [action, qid, value] = args;
    const prefs = questionPrefs(cwd);
    if (action === 'list' || action === undefined) return { prefs };
    if (!QID.test(qid ?? '')) fail('usage: mis question pref set <qid> skip|ask | clear <qid> | list');
    if (action === 'set') {
      if (!['skip', 'ask'].includes(value)) fail('preference must be skip or ask');
      prefs[qid] = value;
    } else if (action === 'clear') delete prefs[qid];
    else fail('usage: mis question pref set <qid> skip|ask | clear <qid> | list');
    saveJson(p.prefs, prefs);
    return { prefs, note: 'skip never applies to HIGH-impact questions (security, data loss, irreversible): those are always asked' };
  }
  if (sub === 'list') return { entries: readJsonl(p.log) };
  return fail('usage: mis question log <json|-> | pref set <qid> skip|ask | pref clear <qid> | pref list | list');
}

const profile = (args, cwd) => deriveProfile(readJsonl(qPaths(cwd).log), questionPrefs(cwd));

// ---------------------------------------------------------------- B4 design

function taste([sub, ...args], cwd) {
  const file = join(stateRoot(cwd), 'taste.json');
  const t = readJson(file, { tags: {}, sessions: [] });
  if (sub === 'show' || sub === undefined) {
    const ranked = Object.entries(t.tags).map(([tag, c]) => ({ tag, ...c, score: c.approved - c.rejected })).sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
    return { prefer: ranked.filter((r) => r.score > 0).map((r) => r.tag), avoid: ranked.filter((r) => r.score < 0).map((r) => r.tag), tags: ranked, sessions: t.sessions.length };
  }
  if (!['approve', 'reject'].includes(sub)) fail('usage: mis taste approve|reject <variant> --tags a,b [--reason text] | show');
  const tags = (flag(args, '--tags') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const reason = flag(args, '--reason') ?? null;
  if (!args[0] || !tags.length) fail('usage: mis taste approve|reject <variant> --tags a,b (fonts, colors, layout, aesthetic words)');
  for (const tag of tags) { t.tags[tag] ??= { approved: 0, rejected: 0 }; t.tags[tag][sub === 'approve' ? 'approved' : 'rejected']++; }
  t.sessions = [...t.sessions, { variant: args[0], action: sub, tags, reason, at: new Date().toISOString() }].slice(-50);
  saveJson(file, t);
  return { recorded: sub, variant: args[0], tags };
}

/** Comparison board for design variants: each variant framed with a data-choice button the companion records. */
function designBoard([d = 'design', ...args], cwd) {
  const dir = resolve(cwd, d);
  if (!existsSync(dir)) fail(`no directory ${d}`);
  const out = flag(args, '--out') ?? 'board.html';
  const variants = readdirSync(dir).filter((f) => /\.html?$/i.test(f) && f !== out && f !== 'index.html').sort();
  if (variants.length < 2) fail(`a board needs at least 2 HTML variants in ${d} (found ${variants.length})`);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cards = variants.map((v) => `<figure><iframe src="${encodeURI(v)}" title="${esc(v)}" loading="lazy"></iframe>
<figcaption>${esc(v)} <button type="button" data-choice="${esc(v)}">Choose ${esc(v)}</button></figcaption></figure>`).join('\n');
  writeFileSync(join(dir, out), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design variants</title><style>body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa;color:#111}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden}
iframe{width:100%;height:480px;border:0}figcaption{display:flex;justify-content:space-between;align-items:center;padding:8px 12px}button{font:inherit;padding:6px 12px}</style></head>
<body><h1>Design variants (${variants.length})</h1><p>Click "Choose" on the one you prefer, then answer in the terminal (you may combine variants).</p>
<main>
${cards}
</main></body></html>
`);
  return { board: relative(cwd, join(dir, out)), variants, next: `mis companion start ${d} → open the printed URL at /${out}; clicks appear in mis companion status` };
}

function diagram([file, ...args], cwd) {
  if (!file || !/\.mmd$/.test(file)) fail('usage: mis diagram <file.mmd> [--out <dir>]');
  const outDir = resolve(cwd, flag(args, '--out') ?? dirname(file));
  const g = parseMermaid(readFileSync(resolve(cwd, file), 'utf8'));
  const name = basename(file, '.mmd');
  mkdirSync(outDir, { recursive: true });
  const ex = join(outDir, `${name}.excalidraw`), svg = join(outDir, `${name}.svg`), html = join(outDir, `${name}.html`);
  const s = toSvg(g);
  writeFileSync(ex, JSON.stringify(toExcalidraw(g), null, 2) + '\n');
  writeFileSync(svg, s + '\n');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>body{margin:0;background:#fff}</style></head><body>${s}</body></html>\n`);
  return { nodes: g.nodes.length, edges: g.edges.length, files: [file, relative(cwd, ex), relative(cwd, svg), relative(cwd, html)],
    png: `PNG: mis browse goto file://${html} then mis browse screenshot ${relative(cwd, join(outDir, `${name}.png`))} (no Chrome → the PNG is BLOCKED; the .svg and .excalidraw stand)` };
}

// ---------------------------------------------------------------- B8 decisions, JSONL merge driver

const decisionsFile = (cwd) => join(repoRoot(cwd), REPORT_DIR, 'decisions.jsonl');

export function activeDecisions(events) {
  const superseded = new Set(events.filter((e) => e.type === 'supersede').map((e) => e.id));
  return events.filter((e) => e.type === 'decide').map((d) => ({ ...d, active: !superseded.has(d.id), supersededBy: events.find((e) => e.type === 'supersede' && e.id === d.id)?.by ?? null }));
}

function newDecision(cwd, raw) {
  const d = jsonArg(cwd, raw);
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('decision must be an object');
  for (const k of Object.keys(d)) if (!['decision', 'rationale', 'scope', 'source', 'files'].includes(k)) fail(`unknown key: ${k}`);
  if (typeof d.decision !== 'string' || !d.decision.trim()) fail('decision must be a non-empty string');
  if (typeof d.rationale !== 'string' || !d.rationale.trim()) fail('rationale must be a non-empty string');
  const secrets = scanText(`${d.decision}\n${d.rationale}`, 'decision');
  if (secrets.length) fail(`decision text contains a secret (${secrets.map((s) => s.kind).join(', ')}); nothing was recorded`);
  const date = new Date().toISOString();
  return { type: 'decide', id: `D-${date.slice(0, 10).replace(/-/g, '')}-${randomBytes(2).toString('hex')}`, ...d, at: date };
}

function decision([sub, ...args], cwd) {
  const file = decisionsFile(cwd);
  if (sub === 'add') {
    const d = newDecision(cwd, args[0]);
    appendJsonl(file, d);
    return { recorded: d };
  }
  if (sub === 'supersede') {
    const [id, raw] = args;
    const cur = activeDecisions(readJsonl(file)).find((x) => x.id === id) ?? fail(`no decision ${id}`);
    if (!cur.active) fail(`decision ${id} is already superseded by ${cur.supersededBy}`);
    const d = newDecision(cwd, raw);
    appendJsonl(file, d);
    appendJsonl(file, { type: 'supersede', id, by: d.id, at: d.at });
    return { recorded: d, superseded: id };
  }
  if (sub === 'search' || sub === 'list') {
    const all = args.includes('--all');
    const q = args.filter((a) => a !== '--all').join(' ').toLowerCase();
    const hits = activeDecisions(readJsonl(file)).filter((d) => (all || d.active) && (!q || `${d.decision} ${d.rationale} ${d.scope ?? ''}`.toLowerCase().includes(q)));
    return { decisions: hits };
  }
  return fail('usage: mis decision add <json|-> | supersede <id> <json|-> | search [<text>] [--all]');
}

/** Union merge of append-only JSONL (gstack jsonl-merge): ours in order, then theirs' new lines; exact duplicates once. */
export function mergeJsonl(ours, theirs) {
  const lines = (t) => t.split('\n').filter((l) => l.trim());
  const seen = new Set(lines(ours));
  const out = [...lines(ours)];
  for (const l of lines(theirs)) if (!seen.has(l)) { seen.add(l); out.push(l); }
  return out.length ? out.join('\n') + '\n' : '';
}

function jsonlMerge(args, cwd) {
  if (args[0] === 'install') {
    const root = repoRoot(cwd);
    // shortcut: the driver stores this plugin's absolute path; re-run install after moving or upgrading the plugin.
    const cli = fileURLToPath(new URL('../mis.mjs', import.meta.url));
    git(root, 'config', 'merge.mis-jsonl.name', 'Make It Ship append-only JSONL union merge');
    git(root, 'config', 'merge.mis-jsonl.driver', `"${process.execPath}" "${cli}" jsonl-merge %O %A %B`);
    const attrs = join(resolve(root, gitOut(root, 'rev-parse', '--git-common-dir')), 'info', 'attributes');
    const line = `${REPORT_DIR}/*.jsonl merge=mis-jsonl`;
    const cur = existsSync(attrs) ? readFileSync(attrs, 'utf8') : '';
    if (!cur.split('\n').includes(line)) { mkdirSync(dirname(attrs), { recursive: true }); appendFileSync(attrs, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n'); }
    return { installed: true, attributes: line, where: 'local git config and .git/info/attributes (no tracked file changes)' };
  }
  const [base, ours, theirs] = args;
  if (!base || !ours || !theirs) fail('usage: mis jsonl-merge install | <base> <ours> <theirs> (called by git)');
  writeFileSync(ours, mergeJsonl(readFileSync(ours, 'utf8'), readFileSync(theirs, 'utf8')));
  return undefined;
}

export const flowCommands = { debt, redact, health, 'version-bump': versionBump, 'next-version': nextVersionCmd, 'diff-scope': diffScopeCmd,
  'repo-mode': repoModeCmd, context, goal, question, profile, taste, 'design-board': designBoard, diagram, decision, 'jsonl-merge': jsonlMerge };
