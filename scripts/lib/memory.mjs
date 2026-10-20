// Memory stores (absorbs OMC notepad / project memory / mode state / shared memory; see THIRD_PARTY_NOTICES.md).
// Per repo under <git-common-dir>/make-it-ship/memory/ (shared across worktrees), never under runs/ or current.
// Outside a git repo it falls back to the per-user home, like the loop state.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateRoot, loadRun, TERMINAL } from './state.mjs';
import { homeDir, readHome } from './home.mjs';
import { readLoop } from './loop.mjs';
import { currentStyle } from './style.mjs';
import { envSession } from './home.mjs';
import { detectConfig } from './setup.mjs';

export function memoryDir(cwd) {
  try { return join(stateRoot(cwd), 'memory'); } catch { return join(homeDir(), 'memory'); }
}

// Names become path segments: no separators, no dot-dot, no leading dot.
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export function checkName(kind, v) {
  if (typeof v !== 'string' || !NAME.test(v) || v.includes('..')) throw new Error(`invalid ${kind} "${v}" (letters, digits, . _ -; max 128)`);
  return v;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export const readMemoryFile = (cwd, rel) => readJson(join(memoryDir(cwd), rel));
// shortcut: read-modify-write without a lock; concurrent writers can lose an entry. Add a lock if hooks and tools collide.
export function writeMemoryFile(cwd, rel, value) {
  const p = join(memoryDir(cwd), rel), tmp = `${p}.${process.pid}.tmp`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, p);
  return value;
}

const text = (kind, v, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${kind} must be a non-empty string`);
  if (v.length > max) throw new Error(`${kind} exceeds ${max} chars`);
  return v.trim();
};

// ---- notepad: priority (replaced, injected at session start), working (7-day), manual (permanent)
export const PRIORITY_MAX = 500, WORKING_DAYS = 7;
export const notepadRead = (cwd) => readMemoryFile(cwd, 'notepad.json');
const notepad = (cwd) => notepadRead(cwd) ?? { priority: null, working: [], manual: [] };
const saveNotepad = (cwd, n) => writeMemoryFile(cwd, 'notepad.json', n);

export function setPriority(cwd, content, now = new Date()) {
  const t = text('content', content, 2000);
  saveNotepad(cwd, { ...notepad(cwd), priority: { text: t, at: now.toISOString() } });
  return { chars: t.length, warning: t.length > PRIORITY_MAX ? `Priority Context exceeds ${PRIORITY_MAX} chars (${t.length}); consider condensing.` : undefined };
}

export function addEntry(cwd, section, content, now = new Date()) {
  const t = text('content', content, 4000);
  const n = notepad(cwd);
  if (n[section].some((e) => e.text === t)) return { section, chars: t.length, duplicate: true };
  n[section] = [...n[section], { at: now.toISOString(), text: t }];
  if (section === 'working') n.working = n.working.filter((e) => new Date(e.at) >= new Date(now - WORKING_DAYS * 864e5));
  saveNotepad(cwd, n);
  return { section, chars: t.length };
}

export function pruneNotepad(cwd, daysOld = WORKING_DAYS, now = new Date()) {
  const n = notepadRead(cwd);
  if (!n) return { pruned: 0, remaining: 0, daysOld };
  const kept = n.working.filter((e) => new Date(e.at) >= new Date(now - daysOld * 864e5));
  if (kept.length !== n.working.length) saveNotepad(cwd, { ...n, working: kept });
  return { pruned: n.working.length - kept.length, remaining: kept.length, daysOld };
}

const stamp = (at) => at.slice(0, 16).replace('T', ' ');
const entries = (list) => list.map((e) => `### ${stamp(e.at)}\n${e.text}`).join('\n\n');
export function formatNotepad(n, section = 'all') {
  const parts = {
    priority: ['Priority Context', n.priority?.text ?? ''],
    working: ['Working Memory', entries(n.working)],
    manual: ['MANUAL', entries(n.manual)],
  };
  const pick = section === 'all' ? Object.keys(parts) : [section];
  return pick.map((k) => `## ${parts[k][0]}\n\n${parts[k][1] || '(empty)'}`).join('\n\n');
}

// ---- project memory: tech stack, commands, notes, user directives
const LANG_MARKERS = [['tsconfig.json', 'TypeScript'], ['package.json', 'JavaScript'], ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'],
  ['Cargo.toml', 'Rust'], ['go.mod', 'Go'], ['Package.swift', 'Swift'], ['pom.xml', 'Java'], ['build.gradle', 'Java'], ['build.gradle.kts', 'Kotlin'], ['CMakeLists.txt', 'C/C++']];

export function detectProject(root, now = new Date()) {
  const languages = [...new Set(LANG_MARKERS.filter(([f]) => existsSync(join(root, f))).map(([, l]) => l))];
  let checks = {};
  try { checks = detectConfig(root).config?.checks ?? {}; } catch { /* no commands detected */ }
  const cmd = (k) => checks[k]?.argv.join(' ') ?? null;
  return {
    version: '1.0.0', lastScanned: now.getTime(), projectRoot: root,
    techStack: { languages },
    build: { buildCommand: cmd('build'), testCommand: cmd('unit'), lintCommand: cmd('lint'), typecheckCommand: cmd('typecheck') },
    conventions: {}, structure: {}, customNotes: [], userDirectives: [],
  };
}

export const projectRead = (cwd) => readMemoryFile(cwd, 'project.json');
export const projectSave = (cwd, m) => writeMemoryFile(cwd, 'project.json', m);
/** Stored memory, or freshly detected basics (saved) when none exists yet. */
export const projectEnsure = (cwd) => projectRead(cwd) ?? projectSave(cwd, detectProject(cwd));

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const ARRAY_KEYS = { customNotes: (n) => `${n.category}::${n.content}`, userDirectives: (d) => String(d.directive).toLowerCase() };
export function mergeMemory(base, inc) {
  const out = { ...base };
  for (const [k, v] of Object.entries(inc)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isObj(base[k]) && isObj(v)) out[k] = mergeMemory(base[k], v);
    else if (Array.isArray(base[k]) && Array.isArray(v)) {
      const key = ARRAY_KEYS[k] ?? JSON.stringify;
      out[k] = [...new Map([...base[k], ...v].map((x) => [key(x), x])).values()];
    } else out[k] = v;
  }
  return out;
}

const CAP = 20;
export function addNote(cwd, category, content, now = new Date()) {
  const m = projectEnsure(cwd);
  m.customNotes = [...(m.customNotes ?? []), { timestamp: now.getTime(), source: 'manual', category: text('category', category, 50), content: text('content', content, 1000) }].slice(-CAP);
  return projectSave(cwd, m);
}

export function addDirective(cwd, { directive, context = '', priority = 'normal' }, now = new Date()) {
  const d = text('directive', directive, 500);
  if (!['high', 'normal'].includes(priority)) throw new Error('priority must be high or normal');
  const m = projectEnsure(cwd);
  const list = m.userDirectives ?? [];
  if (list.some((x) => x.directive.toLowerCase() === d.toLowerCase())) return { added: false, memory: m };
  list.push({ timestamp: now.getTime(), directive: d, context, source: 'explicit', priority });
  // over the cap: keep high priority first, then newest
  m.userDirectives = list.length > CAP ? list.sort((a, b) => (a.priority === b.priority ? b.timestamp - a.timestamp : a.priority === 'high' ? -1 : 1)).slice(0, CAP) : list;
  return { added: true, memory: projectSave(cwd, m) };
}

// ---- mode state: named modes in memory/modes/; Make It Ship's own modes are live and read-only here
export const BUILTIN_MODES = ['run', 'loop', 'style', 'freeze'];
const modeFile = (mode) => `modes/${checkName('mode', mode)}.json`;

function builtin(cwd, mode) {
  if (mode === 'run') {
    let run = null; try { run = loadRun(cwd); } catch { /* not a git repo */ }
    return run ? { id: run.state.runId, state: run.state.state, runMode: run.state.mode, active: !TERMINAL.includes(run.state.state) } : { active: false };
  }
  if (mode === 'loop') return readLoop(cwd);
  if (mode === 'style') { const level = currentStyle(envSession()); return { level, active: level !== 'off' }; }
  const f = readHome('freeze.json');
  return f?.dir ? { ...f, active: true } : { active: false };
}

export function modeRead(cwd, mode) {
  if (BUILTIN_MODES.includes(mode)) return builtin(cwd, mode);
  return readMemoryFile(cwd, modeFile(mode));
}

const readOnly = (mode) => { if (BUILTIN_MODES.includes(mode)) throw new Error(`"${mode}" is Make It Ship's own state and is read-only here (use mis ${mode === 'run' ? 'cancel/status' : mode})`); };

export function modeWrite(cwd, mode, state, now = new Date()) {
  readOnly(mode);
  return writeMemoryFile(cwd, modeFile(mode), { ...state, _meta: { mode, updatedAt: now.toISOString(), updatedBy: 'state_write' } });
}

export function modeClear(cwd, mode) {
  readOnly(mode);
  const p = join(memoryDir(cwd), modeFile(mode));
  const had = existsSync(p);
  rmSync(p, { force: true });
  return had;
}

export function modeList(cwd) {
  const d = join(memoryDir(cwd), 'modes');
  const custom = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  return [...BUILTIN_MODES.map((mode) => ({ ...builtin(cwd, mode), mode, builtin: true })),
    ...custom.map((mode) => ({ ...modeRead(cwd, mode), mode, builtin: false }))];
}

// ---- shared memory: namespace/key → value with optional TTL
const entryFile = (ns, key) => `shared/${checkName('namespace', ns)}/${checkName('key', key)}.json`;
const expired = (e, now) => e.expiresAt && new Date(e.expiresAt) <= now;

export function sharedWrite(cwd, ns, key, value, ttl, now = new Date()) {
  if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 1 || ttl > 604800)) throw new Error('ttl must be an integer 1..604800 seconds');
  if (value === undefined) throw new Error('value is required');
  const prev = readMemoryFile(cwd, entryFile(ns, key));
  const at = now.toISOString();
  return writeMemoryFile(cwd, entryFile(ns, key), { namespace: ns, key, value, createdAt: prev?.createdAt ?? at, updatedAt: at,
    ...(ttl ? { ttl, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() } : {}) });
}

export function sharedRead(cwd, ns, key, now = new Date()) {
  const e = readMemoryFile(cwd, entryFile(ns, key));
  if (!e || expired(e, now)) { if (e) sharedDelete(cwd, ns, key); return null; }
  return e;
}

export function sharedDelete(cwd, ns, key) {
  const p = join(memoryDir(cwd), entryFile(ns, key));
  const had = existsSync(p);
  rmSync(p, { force: true });
  return had;
}

const sharedRoot = (cwd) => join(memoryDir(cwd), 'shared');
const dirs = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
const nsEntries = (cwd, ns) => {
  const d = join(sharedRoot(cwd), checkName('namespace', ns));
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(join(d, f))).filter(Boolean) : [];
};

export const sharedNamespaces = (cwd) => dirs(sharedRoot(cwd));
export const sharedList = (cwd, ns, now = new Date()) => nsEntries(cwd, ns).filter((e) => !expired(e, now))
  .map(({ key, updatedAt, expiresAt }) => ({ key, updatedAt, expiresAt })).sort((a, b) => a.key.localeCompare(b.key));

export function sharedCleanup(cwd, ns, now = new Date()) {
  let removed = 0; const namespaces = [];
  for (const n of ns ? [checkName('namespace', ns)] : sharedNamespaces(cwd)) {
    const gone = nsEntries(cwd, n).filter((e) => expired(e, now) && sharedDelete(cwd, n, e.key)).length;
    if (gone) { removed += gone; namespaces.push(n); }
  }
  return { removed, namespaces };
}

// ---- hook helpers (fail open: callers inject '' / skip on any problem)
const directiveLines = (m) => (m?.userDirectives ?? []).map((d) => `- ${d.priority === 'high' ? '[high] ' : ''}${d.directive}`);

function projectBlock(m) {
  const langs = m?.techStack?.languages ?? [];
  const cmds = Object.entries(m?.build ?? {}).filter(([, v]) => v).map(([k, v]) => `${k.replace(/Command$/, '')}: \`${v}\``);
  const hot = (m?.hotPaths ?? []).slice(0, 5).map((h) => h.path);
  return langs.length || cmds.length || hot.length ? `## Project\n${[langs.length ? `languages: ${langs.join(', ')}` : '', ...cmds, hot.length ? `often read: ${hot.join(', ')}` : ''].filter(Boolean).join('\n')}` : '';
}

/** The project facts block alone ('' when unknown). */
export function projectContext(cwd) { try { return projectBlock(projectRead(cwd)); } catch { return ''; } }

/** SessionStart: priority notepad + project memory directives and summary; '' when nothing is stored. */
export function memorySessionContext(cwd) {
  try {
    const out = [];
    const p = notepadRead(cwd)?.priority?.text;
    if (p) out.push(`## Priority notes\n${p}`);
    const m = projectRead(cwd);
    const dl = directiveLines(m);
    if (dl.length) out.push(`## User directives (follow these)\n${dl.join('\n')}`);
    const pb = projectBlock(m);
    if (pb) out.push(pb);
    return out.length ? `# Project memory (Make It Ship)\n\n${out.join('\n\n')}` : '';
  } catch { return ''; }
}

/** Save <remember priority>…</remember> (priority, replaces) and <remember>…</remember> (working, 7 days). Returns how many were saved. */
export function extractRemember(text, cwd) {
  if (typeof text !== 'string' || !text.includes('<')) return 0;
  let n = 0;
  try {
    for (const [, c] of text.matchAll(/<remember\s+priority>([\s\S]*?)<\/remember>/gi)) if (c.trim()) { setPriority(cwd, c.trim().slice(0, 2000)); n++; }
    for (const [, c] of text.matchAll(/<remember>([\s\S]*?)<\/remember>/gi)) if (c.trim()) { addEntry(cwd, 'working', c.trim().slice(0, 4000)); n++; }
  } catch { /* fail open */ }
  return n;
}

/** PreCompact: what must survive compaction (priority notes, directives, active run, active loop); '' when nothing. */
export function preCompactContext(cwd) {
  try {
    const out = [];
    const p = notepadRead(cwd)?.priority?.text;
    if (p) out.push(`## Priority notes\n${p}`);
    const dl = directiveLines(projectRead(cwd));
    if (dl.length) out.push(`## User directives (follow these)\n${dl.join('\n')}`);
    const run = builtin(cwd, 'run');
    if (run.active) out.push(`## Active run\nrun ${run.id} is ${run.state}${run.runMode ? ` (mode ${run.runMode})` : ''}; continue with \`mis status\` / \`mis resume\`.`);
    const loop = readLoop(cwd);
    if (loop.active) out.push(`## Active loop\nloop on "${loop.task}", iteration ${loop.iteration}/${loop.max}.`);
    return out.length ? `# Make It Ship context (preserved across compaction)\n\n${out.join('\n\n')}` : '';
  } catch { return ''; }
}

const WHOLE_SUITE = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|node\s+--test|pytest|python3?\s+-m\s+pytest|go\s+test\s+\.\/\.\.\.|cargo\s+test|make\s+(?:test|check)|npx\s+(?:vitest\s+run|jest)|swift\s+test|mvn\s+test|\.\/gradlew\s+test)$/;

/** PostToolUse: remember a test command that just succeeded, if the project has none recorded yet. */
export function learnTestCommand(cwd, command) {
  const m = projectEnsure(cwd);
  const cmd = String(command ?? '').trim();
  // only a plain whole-suite command: no paths, filters, pipes or redirections
  if (!WHOLE_SUITE.test(cmd) || m.build?.testCommand) return false;
  projectSave(cwd, { ...m, build: { ...m.build, testCommand: cmd } });
  return true;
}
