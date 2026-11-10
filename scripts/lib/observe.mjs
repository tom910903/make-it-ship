// Observations (user decision 2026-11-10, absorbs claude-mem's per-tool-use capture and search): the PostToolUse and
// PostToolUseFailure hooks append one rule-based record per tool use to <git-common-dir>/make-it-ship/observations.jsonl
// (per-user home outside a repo). Local only, secrets masked, nothing sent anywhere; `mis memory` and memory_search read it.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { stateRoot } from './state.mjs';
import { homeDir } from './home.mjs';
import { maskSecrets } from './mask.mjs';
import { isTestCommand } from './posttool.mjs';
import { tokenize } from './wiki.mjs';

export const OBS_MAX_BYTES = 2 * 1024 * 1024;
// Command-line forms maskSecrets (log values) does not cover (verifier r1): secret-looking env names, -u user:pass, -p<pw>,
// --password/--token values, any Authorization scheme, "password is x" in prose.
const CMD_SECRETS = [
  [/\b(\w*(?:SECRET|PASS|PWD|TOKEN|KEY|CRED|AUTH(?!OR))\w*=)("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  [/((?:authorization|cookie)\s*[:=]\s*)[^"'\n]+/gi, '$1***'],
  [/((?:^|\s)(?:-u\s*|--user[=\s]+)[^\s:]+:)\S+/g, '$1***'],
  [/((?:^|\s)-p)(?=\S)\S+/g, '$1***'],
  // a spaced -p takes a password only in these tools (elsewhere: mkdir -p, docker run -p 8080:80, git log -p)
  [/(\b(?:mysql|mariadb|mysqldump|mysqladmin|docker\s+login|podman\s+login|sshpass)\b[^\n;|&]*?\s-p\s+)\S+/gi, '$1***'],
  [/((?:^|\s)--?[\w-]*(?:password|passwd|pass|token|secret|api[-_]?key|apikey|auth(?!or)|key|credential)[\w-]*(?:=|\s+))\S+/gi, '$1***'],
  [/\b(pass:)\S+/g, '$1***'],
  [/\b((?:password|passwd|비밀번호|암호)\s*(?:is|=|:|는|은)?\s+)\S+/gi, '$1***'],
];
export const mask = (s) => CMD_SECRETS.reduce((t, [re, to]) => t.replace(re, to), maskSecrets(String(s ?? '')));
const cut = (s, n) => { const t = mask(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// git [-C dir] commit … -m "msg" (escaped quotes allowed), or Claude Code's -m "$(cat <<'EOF'\nmsg\n…" form: first line of the message
const COMMIT_MSG = /\bgit\b[^\n]*?\scommit\b[^\n]*?\s-\w*m\s*(?:"\$\(cat\s*<<-?\s*['"]?\w+['"]?\s*\n([^\n]*)|(["'])((?:\\.|(?!\2).)*)\2)/;
// the file itself, resolved through symlinks when it exists (a symlinked cwd still yields repository-relative paths)
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

export function obsFile(cwd) {
  let dir;
  try { dir = stateRoot(cwd); } catch { return join(homeDir(), 'observations', `${createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 16)}.jsonl`); } // one file per non-git folder
  return join(dir, 'observations.jsonl');
}

/** One hook input → { type, title, files?, cmd?, error? }, or null for tools not worth remembering. Pure. */
export function observation(input, root) {
  const ti = input.tool_input ?? {}, tool = input.tool_name;
  const path = (f) => { const abs = real(resolve(input.cwd || root || '.', String(f))), rel = root ? relative(root, abs) : abs; return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs; };
  let o = null;
  if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(tool) && (ti.file_path ?? ti.notebook_path)) {
    const f = path(ti.file_path ?? ti.notebook_path);
    o = { type: 'change', title: `${tool === 'Write' ? 'Wrote' : 'Edited'} ${f}`, files: [f] };
  } else if (tool === 'Read' && ti.file_path) {
    const f = path(ti.file_path);
    o = { type: 'read', title: `Read ${f}`, files: [f] };
  } else if (tool === 'Bash' && ti.command) {
    const cmd = String(ti.command), m = cmd.match(COMMIT_MSG), msg = m && (m[1] ?? m[3]), first = cmd.split('\n')[0];
    // only the first line is kept: a heredoc body (file content, keys) never reaches the store
    o = { type: msg ? 'commit' : isTestCommand(cmd) ? 'test' : 'command', title: cut(msg ?? ti.description ?? first, 160), cmd: cut(first + (cmd.includes('\n') ? ' …' : ''), 300) };
  } else if (['Agent', 'Task'].includes(tool)) {
    o = { type: 'agent', title: cut(`Agent${ti.subagent_type ? ` (${ti.subagent_type})` : ''}: ${ti.description ?? ''}`, 160) };
  } else if (tool === 'Skill' && ti.skill) {
    o = { type: 'skill', title: `Skill ${cut(ti.skill, 100)}` };
  }
  if (input.hook_event_name !== 'PostToolUseFailure' && input.error == null) return o;
  const f = { ...(o ?? {}), type: 'failure', title: `Failed: ${o?.title ?? cut(tool, 60)}` };
  if (input.error != null) f.error = cut(String(input.error).split('\n')[0], 200);
  return f;
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

/** BM25 over title, subtitle, narrative, facts, concepts, command, files and error (wiki tokenizer: words plus CJK chars and bigrams); ties go to the newer record. */
export function searchObservations(recs, query, { type, since, limit = 20 } = {}) {
  const from = sinceMs(since), terms = tokenize(String(query ?? ''));
  const docs = recs.filter((r) => (!type || r.type === type) && (!from || Date.parse(r.at) >= from))
    .map((r) => ({ r, toks: new Set(tokenize([r.title, r.subtitle, r.narrative, r.cmd, ...(r.facts ?? []), ...(r.concepts ?? []), ...(r.files ?? []), r.error].filter(Boolean).join(' '))) }));
  if (!terms.length || !docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.toks.size, 0) / docs.length, k1 = 1.2, b = 0.75;
  const idf = Object.fromEntries(terms.map((t) => { const n = docs.filter((d) => d.toks.has(t)).length; return [t, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))]; }));
  return docs.map(({ r, toks }) => ({ ...r, score: +terms.reduce((s, t) => s + (toks.has(t) ? idf[t] * (k1 + 1) / (1 + k1 * (1 - b + b * toks.size / avg)) : 0), 0).toFixed(3) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || String(y.at).localeCompare(String(x.at)))
    .slice(0, limit);
}
