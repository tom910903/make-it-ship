// Observations (user decision 2026-11-10, absorbs claude-mem's per-tool-use capture and search): the PostToolUse and
// PostToolUseFailure hooks append one rule-based record per tool use to <git-common-dir>/make-it-ship/observations.jsonl
// (per-user home outside a repo). Local only, secrets masked, nothing sent anywhere; `mis memory` and memory_search read it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { stateRoot } from './state.mjs';
import { homeDir } from './home.mjs';
import { maskSecrets } from './mask.mjs';
import { isTestCommand } from './posttool.mjs';
import { tokenize } from './wiki.mjs';

export const OBS_MAX_BYTES = 2 * 1024 * 1024;
const cut = (s, n) => { const t = maskSecrets(String(s ?? '')).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const COMMIT_MSG = /\bgit\s+commit\b[^\n]*?\s-\w*m\s*(["'])(.*?)\1/;

export function obsFile(cwd) {
  let dir;
  try { dir = stateRoot(cwd); } catch { dir = homeDir(); }
  return join(dir, 'observations.jsonl');
}

/** One hook input → { type, title, files?, cmd?, error? }, or null for tools not worth remembering. Pure. */
export function observation(input, root) {
  const ti = input.tool_input ?? {}, tool = input.tool_name;
  const path = (f) => { const abs = resolve(input.cwd || root || '.', String(f)), rel = root ? relative(root, abs) : abs; return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs; };
  let o = null;
  if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) || tool === 'Write') {
    const f = path(ti.file_path ?? ti.notebook_path);
    o = { type: 'change', title: `${tool === 'Write' ? 'Wrote' : 'Edited'} ${f}`, files: [f] };
  } else if (tool === 'Read' && ti.file_path) {
    const f = path(ti.file_path);
    o = { type: 'read', title: `Read ${f}`, files: [f] };
  } else if (tool === 'Bash' && ti.command) {
    const cmd = String(ti.command), msg = cmd.match(COMMIT_MSG)?.[2];
    o = { type: msg ? 'commit' : isTestCommand(cmd) ? 'test' : 'command', title: cut(msg ?? ti.description ?? cmd.split('\n')[0], 160), cmd: cut(cmd, 300) };
  } else if (['Agent', 'Task'].includes(tool)) {
    o = { type: 'agent', title: cut(`Agent${ti.subagent_type ? ` (${ti.subagent_type})` : ''}: ${ti.description ?? ''}`, 160) };
  } else if (tool === 'Skill' && ti.skill) {
    o = { type: 'skill', title: `Skill ${cut(ti.skill, 100)}` };
  }
  if (input.error === undefined) return o;
  return { ...(o ?? {}), type: 'failure', title: `Failed: ${o?.title ?? cut(tool, 60)}`, error: cut(String(input.error).split('\n')[0], 200) };
}

/** Append one record; past the size cap keep the newer half (whole lines). Never throws. */
export function recordObservation(cwd, rec) {
  try {
    const f = obsFile(cwd);
    mkdirSync(join(f, '..'), { recursive: true });
    appendFileSync(f, JSON.stringify({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), ...rec }) + '\n');
    if (statSync(f).size > OBS_MAX_BYTES) {
      // shortcut: a record appended by a parallel hook between this read and the rename is lost; fine for a size trim, add a lock if it matters
      const text = readFileSync(f, 'utf8'), keep = text.slice(text.indexOf('\n', text.length - OBS_MAX_BYTES / 2) + 1);
      writeFileSync(`${f}.tmp`, keep);
      renameSync(`${f}.tmp`, f);
    }
  } catch { /* fail-open: memory is best effort */ }
}

export function readObservations(cwd) {
  try {
    const f = obsFile(cwd);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });
  } catch { return []; }
}

/** 7d / 24h / 30m / 2w or a date → epoch ms (0 when empty). */
export function sinceMs(spec) {
  if (!spec) return 0;
  const m = String(spec).trim().match(/^(\d+)\s*([mhdw])$/i);
  if (m) return Date.now() - m[1] * { m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()];
  const t = Date.parse(spec);
  if (Number.isNaN(t)) throw new Error(`unrecognized since: ${spec}`);
  return t;
}

/** BM25 over title, command, files and error (wiki tokenizer: words plus CJK chars and bigrams); ties go to the newer record. */
export function searchObservations(recs, query, { type, since, limit = 20 } = {}) {
  const from = sinceMs(since), terms = tokenize(String(query ?? ''));
  const docs = recs.filter((r) => (!type || r.type === type) && (!from || Date.parse(r.at) >= from))
    .map((r) => ({ r, toks: new Set(tokenize([r.title, r.cmd, ...(r.files ?? []), r.error].filter(Boolean).join(' '))) }));
  if (!terms.length || !docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.toks.size, 0) / docs.length, k1 = 1.2, b = 0.75;
  const idf = Object.fromEntries(terms.map((t) => { const n = docs.filter((d) => d.toks.has(t)).length; return [t, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))]; }));
  return docs.map(({ r, toks }) => ({ ...r, score: +terms.reduce((s, t) => s + (toks.has(t) ? idf[t] * (k1 + 1) / (1 + k1 * (1 - b + b * toks.size / avg)) : 0), 0).toFixed(3) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || String(y.at).localeCompare(String(x.at)))
    .slice(0, limit);
}
