// Session tracking for the always-on hooks (M9-F; absorbs OMC subagent-tracker, verify-deliverables, workflow-drift-guard,
// code-simplifier, session-end summary, pre-compact TODOs, project-memory-posttool; see THIRD_PARTY_NOTICES.md).
// Everything here is small and local: no network, no repo scans. Callers fail open.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homeDir } from './home.mjs';

// ---- F1 subagents: one file per running agent, so parallel SubagentStart calls never lose each other.
export const STALE_MS = 5 * 60 * 1000; // OMC subagent-tracker threshold
const ORPHAN_MS = 6 * 60 * 60 * 1000; // a Start without a Stop (crash, killed session) stops counting after this
const safe = (s) => String(s || 'default').replace(/[^\w.-]/g, '_');
const agentsDir = (sid) => join(homeDir(), 'agents', safe(sid));

export function agentStart(sid, agentId, type) {
  if (!agentId) return;
  mkdirSync(agentsDir(sid), { recursive: true });
  writeFileSync(join(agentsDir(sid), safe(agentId)), String(type ?? ''));
}

export function agentStop(sid, agentId) {
  if (agentId) rmSync(join(agentsDir(sid), safe(agentId)), { force: true });
}

/** {running, stale} for a session; files older than ORPHAN_MS are ignored. */
export function agentCounts(sid, now = Date.now()) {
  const d = agentsDir(sid);
  if (!existsSync(d)) return { running: 0, stale: 0 };
  let running = 0, stale = 0;
  for (const f of readdirSync(d)) {
    const age = now - statSync(join(d, f)).mtimeMs;
    if (age > ORPHAN_MS) continue;
    running++;
    if (age > STALE_MS) stale++;
  }
  return { running, stale };
}

/** Running agents of a session for the HUD rows, oldest first: [{type, startedAt}]; orphans and files gone mid-read are skipped. */
export function agentList(sid, now = Date.now()) {
  const d = agentsDir(sid);
  if (!existsSync(d)) return [];
  return readdirSync(d).flatMap((f) => {
    try { return [{ type: readFileSync(join(d, f), 'utf8'), startedAt: statSync(join(d, f)).mtimeMs }]; } catch { return []; }
  }).filter((a) => now - a.startedAt <= ORPHAN_MS).sort((a, b) => a.startedAt - b.startedAt);
}

export const clearAgents = (sid) => rmSync(agentsDir(sid), { recursive: true, force: true });

// ---- todos (TodoWrite input), kept in the session file
export function todosFrom(toolInput) {
  const t = toolInput?.todos;
  return Array.isArray(t) ? t.slice(0, 100).map((x) => ({ content: String(x?.content ?? '').slice(0, 200), status: String(x?.status ?? 'pending') })) : null;
}
export const todoCounts = (todos) => todos?.length ? { done: todos.filter((t) => t.status === 'completed').length, total: todos.length } : null;
export function todoBlock(todos) {
  const open = (todos ?? []).filter((t) => t.status !== 'completed');
  return open.length ? `## Open todos\n${open.map((t) => `- [${t.status === 'in_progress' ? '~' : ' '}] ${t.content}`).join('\n')}` : '';
}

// ---- edited files and read paths (session file; flushed to project memory at SessionEnd)
const MAX_FILES = 50;
export function noteEdit(sess, abs) {
  sess.files = [...new Set([...(sess.files ?? []), abs])].slice(-MAX_FILES);
}
export function noteRead(sess, abs) {
  sess.reads = { ...sess.reads, [abs]: (sess.reads?.[abs] ?? 0) + 1 };
  const keys = Object.keys(sess.reads);
  if (keys.length > 200) for (const k of keys.sort((a, b) => sess.reads[a] - sess.reads[b]).slice(0, keys.length - 200)) delete sess.reads[k];
}
/** Read counts of files inside `root`, keyed relative to it. */
export function readsUnder(reads, root) {
  return Object.fromEntries(Object.entries(reads ?? {}).filter(([p]) => p.startsWith(root + sep)).map(([p, c]) => [relative(root, p), c]));
}
export const HOT_PATHS = 10;
/** Merge session read counts into the project's hot paths; the top N survive. */
export function mergeHotPaths(prev, reads, n = HOT_PATHS) {
  const m = new Map((prev ?? []).map((h) => [h.path, h.count]));
  for (const [p, c] of Object.entries(reads ?? {})) m.set(p, (m.get(p) ?? 0) + c);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([path, count]) => ({ path, count }));
}

// ---- F2 deliverables: paths a finishing subagent says it created/wrote, that are not there
const CLAIM = /\b(?:created|wrote|written|saved|added|generated|new file)\b[^\n]*/gi;
// backticked paths, or bare paths with a directory part (a bare `Node.js` or `socket.io` is a name, not a file)
const PATHLIKE = /`([^`\s]+\.[A-Za-z0-9]{1,8})`|(?:^|[\s(])((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,8})(?=[\s),:;]|\.?$)/gm;
export function missingDeliverables(text, cwd, root) {
  const out = new Set();
  for (const [line] of String(text ?? '').matchAll(CLAIM)) {
    for (const m of line.matchAll(PATHLIKE)) {
      const p = (m[1] ?? m[2]).replace(/[.:,]+$/, '');
      if (/^https?:|^\d+(\.\d+)+$/.test(p)) continue;
      const abs = isAbsolute(p) ? p : resolve(cwd, p);
      if (!(abs + sep).startsWith(root + sep)) continue; // only paths inside the repository are checked
      if (!existsSync(abs)) out.add(relative(root, abs));
    }
  }
  return [...out].slice(0, 10);
}

// ---- F5 drift / F6 simplifier (Stop). Precedence lives in hooks.mjs Stop: loop > drift > simplifier > context warning.
export const DRIFT_MAX = 2;
/** Block a stop while a run is EXECUTING, has required checks, and no evidence matches the current tree. */
export function driftDecision(run, ctx, sess) {
  if (run?.state.state !== 'EXECUTING' || !ctx?.required?.length) return null;
  const current = (run.state.evidence ?? []).some((e) => e.treeHash === ctx.treeHash && e.configHash === ctx.configHash);
  if (current) return { reset: true };
  const n = sess.drift?.runId === run.state.runId ? sess.drift.n : 0;
  if (n >= DRIFT_MAX) return null;
  return {
    save: { runId: run.state.runId, n: n + 1 },
    reason: `[MAKE IT SHIP] Run ${run.state.runId} is EXECUTING and no check has run on the current code (required: ${ctx.required.join(', ')}). Run mis check (and read the output) before stopping, or tell the user why the checks cannot run. (${n + 1}/${DRIFT_MAX}; after that this reminder stops.)`,
  };
}

const SIMPLIFY_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|sh)$/;
/** Opt-in (config simplifier.enabled === true): once per set of edited source files, ask for a simplify pass. */
export function simplifyDecision(cfg, sess) {
  if (cfg?.simplifier?.enabled !== true) return null;
  const files = (sess.files ?? []).filter((f) => SIMPLIFY_EXT.test(f)).slice(-(cfg.simplifier.maxFiles ?? 10));
  if (!files.length) return null;
  const key = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
  if (sess.simplified === key) return null;
  return {
    key,
    reason: `[MAKE IT SHIP SIMPLIFY] You edited these files this session:\n${files.map((f) => `- ${f}`).join('\n')}\nHand them to the make-it-ship:code-simplifier agent (same behavior, less code, tests before and after), then stop. This runs once per set of edited files; turn it off with mis config set simplifier.enabled false.`,
  };
}

// ---- F11 directive candidates in a user prompt (suggested, never saved automatically)
const DIRECTIVE = [/\b(?:always|never)\s+(?:use|check|include|run|modify|touch|change|edit|commit|push)\b.{3,}/i, /\bdon'?t\s+(?:ever\s+)?(?:use|modify|touch|change|edit)\b.{3,}/i,
  /\b(?:from now on|going forward)\b.{3,}/i, /\b(?:must|should)\s+(?:always|never)\b.{3,}/i, /(?:항상|절대(?!\s*경로)|앞으로는?|반드시)\s*\S.*(?:줘|주세요|하세요|마|마세요|할 것|하라)[.!]?$/];
export function directiveCandidates(prompt) {
  const out = [];
  for (const s of String(prompt ?? '').split(/(?<=[.!?。])\s+|\n+/)) {
    const t = s.trim();
    if (t.length < 8 || t.length > 200 || t.endsWith('?') || /`/.test(t)) continue;
    if (DIRECTIVE.some((re) => re.test(t))) out.push(t);
  }
  return out.slice(0, 3);
}

// ---- F7 session summary (markdown under the repo state root, never in the work tree)
export function sessionSummary({ id, reason, at = new Date().toISOString(), sess, run, root }) {
  const rel = (f) => (root && f.startsWith(root + sep) ? relative(root, f) : f);
  const c = todoCounts(sess.todos);
  const lines = [`# Session ${id}`, '', `Ended: ${at}${reason ? ` (${reason})` : ''}`];
  if (run) lines.push(`Run: ${run.state.runId} (${run.state.state})`);
  lines.push(`Files edited: ${(sess.files ?? []).length}`, ...(sess.files ?? []).map((f) => `- ${rel(f)}`));
  if (c) lines.push(`Todos: ${c.done}/${c.total} done`, ...(sess.todos ?? []).filter((t) => t.status !== 'completed').map((t) => `- [ ] ${t.content}`));
  if (sess.agentsStarted) lines.push(`Subagents started: ${sess.agentsStarted}`);
  if (sess.skills?.length) lines.push(`Skills used: ${sess.skills.join(', ')}`);
  const hot = mergeHotPaths([], sess.reads, 5);
  if (hot.length) lines.push(`Most read: ${hot.map((h) => `${h.path} (${h.count})`).join(', ')}`);
  return lines.join('\n') + '\n';
}
