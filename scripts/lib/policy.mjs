// Guard policy (Spec §7): pure classification of a PreToolUse call.
// Threat model: careless/habitual mistakes, not an adversarial model (obfuscation is out of scope).
import { resolve, sep, dirname, basename, join } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';

const R = 'make-it-ship';
const allow = { decision: 'allow' };
const ask = (reason) => ({ decision: 'ask', reason: `${R}: ${reason}` });
const deny = (reason) => ({ decision: 'deny', reason: `${R}: ${reason}` });

const STATE_PATH = /\.git\/(?:.*\/)?make-it-ship\/(?:runs\/|current$)/;
// Any mention of the state dir in a shell command is denied: mis.mjs never takes state paths as arguments.
const BASH_STATE = /make-it-ship\/(?:runs|current)\b/; // §7: state paths; `cd` into the state dir is checked separately
const MCP_WRITE = /create|update|delete|send|push|merge|upload|transition|edit|write/i;
const CONFIG = '.make-it-ship.json';

/** Real path of a possibly not-yet-existing file: resolve symlinks of the nearest existing ancestor. */
function realish(abs) {
  let base = abs, rest = '';
  while (!existsSync(base) && dirname(base) !== base) { rest = rest ? join(basename(base), rest) : basename(base); base = dirname(base); }
  try { return rest ? join(realpathSync(base), rest) : realpathSync(base); } catch { return abs; }
}
const outsideFreeze = (abs, dir) => !(realish(abs) + sep).startsWith(dir + sep);

import { commandsOf } from './shell.mjs';

const branchName = (ref) => ref.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '');

function gitSub(ws) {
  // git [-C dir | -c k=v | --flag]... <sub>
  if (ws[0] !== 'git') return null;
  let i = 1;
  while (i < ws.length && ws[i].startsWith('-')) i += ws[i] === '-C' || ws[i] === '-c' ? 2 : 1;
  return { sub: ws[i], rest: ws.slice(i + 1) };
}

function classifyPush(rest, ctx) {
  const force = rest.some((w) => /^(-f|--force|--force-with-lease)(=|$)/.test(w) || /^-[a-z]*f/.test(w));
  const refs = rest.filter((w) => !w.startsWith('-'));
  const targets = refs.slice(1).map(branchName).map((b) => (b === 'HEAD' ? ctx.currentBranch : b));
  const plusMain = refs.slice(1).some((r) => r.startsWith('+') && ['main', 'master'].includes(branchName(r)));
  const onMain = targets.some((t) => t === 'main' || t === 'master') || (!targets.length && ['main', 'master'].includes(ctx.currentBranch));
  if ((force && onMain) || plusMain) return deny('force push to the default branch is not allowed');
  if (force) return ask('force push rewrites remote history; other people may lose work');
  return ask('remote write (git push) needs your approval');
}

function dangerousRmTarget(t, cwd, repoRoot) {
  if (t === '/' || t.startsWith('~') || /\$\{?HOME\b/.test(t)) return true;
  const abs = resolve(cwd, t);
  if (abs === resolve(homedir())) return true;
  return abs === repoRoot || !(abs + sep).startsWith(repoRoot + sep);
}

/** mis subcommand of a command, if it invokes mis.mjs (node <path>/mis.mjs, the script directly, or a shell function wrapping it). */
const NODE_VALUE_FLAGS = ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--env-file', '--title'];
function misSub(ws, functions) {
  if (ws[0] === 'node') {
    let k = 1;
    while (ws[k]?.startsWith('-')) {
      if (['-e', '-p', '--eval', '--print'].includes(ws[k])) return null;
      k += NODE_VALUE_FLAGS.includes(ws[k]) || /^\d+$/.test(ws[k + 1] ?? '') ? 2 : 1;
    }
    if (/(^|\/)mis\.mjs$/.test(ws[k] ?? '')) return ws.slice(k + 1);
    if (/^\$\{?\w+\}?$/.test(ws[k] ?? '')) return ws.slice(k + 1); // unresolved variable: could be mis.mjs
    return null;
  }
  if (/(^|\/)mis\.mjs$/.test(ws[0])) return ws.slice(1);
  if (functions.has(ws[0]) && /mis\.mjs/.test(functions.get(ws[0]))) return ws.slice(1);
  return null;
}

function classifyBash(cmd, ctx, cwd) {
  const { commands, text, functions } = commandsOf(cmd);
  // Heredoc bodies are data (plans, reviews) and are excluded from `text`.
  if (BASH_STATE.test(text)) return deny('run state is written only by mis.mjs; use `mis status` to read it');
  for (const c of commands) if (c.redirects.some((t) => BASH_STATE.test(t))) return deny('run state is written only by mis.mjs');
  let dir = cwd;
  for (const c of commands) {
    if (['rm', 'mv', 'cp', 'rsync', 'ln'].includes(c.argv[0]) && c.argv.slice(1).some((a) => /(^|\/)\.git\/(?:[^/]+\/)*make-it-ship\/?$|(^|\/)\.git\/(?:[^/]+\/)*make-it-ship\//.test(a))) {
      return deny('run state is managed only by mis.mjs (deleting or moving it destroys the run history)');
    }
    if (c.argv[0] === 'cd' && c.argv[1] && /\.git(\/|$)/.test(c.argv[1]) && /make-it-ship/.test(resolve(dir, c.argv[1]))) {
      return deny('run state is written only by mis.mjs');
    }
  }
  // Careful rules (M6-07, absorbs gstack careful) apply with or without a run; the rest only while a run is active.
  if (ctx.activeRun && (commands.some((c) => c.redirects.some((t) => t.endsWith(CONFIG))) ||
      (text.includes(CONFIG) && /\b(sed\s+-i|tee|mv|cp|rm)\b/.test(text)))) {
    return ask('changing .make-it-ship.json invalidates existing evidence');
  }
  let verdict = allow;
  for (const { argv: ws } of commands) {
    if (ws[0] === 'cd' && ws[1]) { dir = resolve(dir, ws[1].replace(/^~/, homedir())); continue; }
    let r = careful(ws, ctx, dir);
    if (r.decision === 'allow' && ctx.activeRun) r = runOnly(ws, ctx, functions);
    if (r.decision === 'deny') return r;
    if (r.decision === 'ask' && verdict.decision === 'allow') verdict = r;
  }
  return verdict;
}

const SQL_CLIENTS = /^(psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|clickhouse-client|cockroach|snowsql|bq|mongosh)$/;
const DESTRUCTIVE = [
  [/\bdrop\s+(table|database|schema)\b/i, 'SQL DROP permanently deletes database objects'],
  [/\btruncate\s+(table\s+)?[a-z_]\w*/i, 'SQL TRUNCATE deletes all rows of a table'],
];

function careful(ws, ctx, dir) {
  const g = gitSub(ws);
  if (g?.sub === 'push') {
    const r = classifyPush(g.rest, ctx);
    return r.decision === 'deny' || /force/.test(r.reason) ? r : allow;
  }
  if (g?.sub === 'reset' && g.rest.includes('--hard')) return ask('git reset --hard discards local changes');
  if (g?.sub === 'clean' && g.rest.some((w) => /^-[a-z]*f/.test(w) || w === '--force')) return ask('git clean -f deletes untracked files');
  const unstageOnly = g?.sub === 'restore' && g.rest.some((w) => w === '--staged' || w === '-S') && !g.rest.some((w) => w === '--worktree' || w === '-W');
  if ((g?.sub === 'checkout' || g?.sub === 'restore') && !unstageOnly && g.rest.filter((w) => w !== '--').some((w) => w === '.' || w === ':/')) return ask(`git ${g.sub} . discards all uncommitted changes`);
  if (isOtherModel(ws)) return ask('sends repository content to an external model service (second opinion) — needs your approval');
  if (ws[0] === 'kubectl' && ws[1] === 'delete') return ask('kubectl delete removes cluster resources');
  if (ws[0] === 'docker' && ((ws[1] === 'rm' && ws.includes('-f')) || (ws[1] === 'system' && ws[2] === 'prune'))) return ask(`docker ${ws[1]} ${ws[2] ?? ''} removes containers or images`);
  if (SQL_CLIENTS.test(ws[0] ?? '')) {
    const sql = ws.slice(1).join(' ');
    for (const [re, why] of DESTRUCTIVE) if (re.test(sql)) return ask(why);
  }
  if (ws[0] === 'rm') {
    const flags = ws.slice(1).filter((w) => w.startsWith('-'));
    const recursive = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f));
    const targets = ws.slice(1).filter((w) => !w.startsWith('-'));
    if (recursive && targets.some((t) => dangerousRmTarget(t, dir, ctx.repoRoot))) return ask('recursive delete outside the repository');
  }
  return allow;
}

function runOnly(ws, ctx, functions) {
  const g = gitSub(ws);
  const mis = misSub(ws, functions);
  if (mis?.[0] === 'approve') return ask('approval is recorded only when you confirm this command');
  if (mis?.[0] === 'init' && mis.includes('--write')) return ask('writing .make-it-ship.json changes verification rules');
  if (g?.sub === 'push') return classifyPush(g.rest, ctx);
  if (ws[0] === 'gh' && ((ws[1] === 'pr' && ['create', 'merge'].includes(ws[2])) || ws[1] === 'release')) return ask(`remote write (gh ${ws[1]} ${ws[2] ?? ''}) needs your approval`);
  if (isInstall(ws)) return ask('package install needs your approval (supply chain)');
  return allow;
}

function isOtherModel(ws) {
  if (ws[0] === 'codex' || ws[0] === 'gemini') return !ws.slice(1).every((w) => ['--version', '-V', '--help', '-h'].includes(w));
  return ws[0] === 'omc' && ws[1] === 'ask';
}

const PM_VALUE_FLAGS = ['--prefix', '-C', '--dir', '--filter', '-F', '--cwd', '-w', '--workspace', '--global-folder', '--registry', '--cache'];
function isInstall(argv) {
  const ws = [argv[0]];
  for (let k = 1; k < argv.length; k++) {
    if (argv[k].startsWith('-') && ws.length === 1 && ['npm', 'pnpm', 'yarn', 'pip', 'pip3'].includes(argv[0])) { if (PM_VALUE_FLAGS.includes(argv[k])) k++; continue; }
    ws.push(argv[k]);
  }
  const [a, b] = ws;
  if (['npm', 'pnpm'].includes(a) && ['i', 'install', 'add'].includes(b)) return true;
  if (a === 'yarn' && b === 'add') return true;
  if (/^pip3?$/.test(a) && b === 'install') return true;
  if (/^python3?$/.test(a) && b === '-m' && /^pip3?$/.test(ws[2]) && ws[3] === 'install') return true;
  if (a === 'brew' && b === 'install') return true;
  if (a === 'cargo' && b === 'add') return true;
  return false;
}

/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param input PreToolUse hook input {tool_name, tool_input, cwd}
 * @param ctx {repoRoot, activeRun, currentBranch, plannedFiles?: string[]|null, freezeDir?: string|null}
 * @returns {{decision:'allow'|'ask'|'deny', reason?:string}}
 */
export function classify(input, ctx) {
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  const cwd = input.cwd ?? ctx.repoRoot;
  if (tool === 'Bash') return classifyBash(String(ti.command ?? ''), ctx, cwd);
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = ti.file_path ?? ti.notebook_path;
    if (!p) return allow;
    const abs = resolve(cwd, p);
    if (STATE_PATH.test(abs)) return deny('run state is written only by mis.mjs');
    if (ctx.freezeDir && outsideFreeze(abs, ctx.freezeDir)) return deny(`edits are frozen to ${ctx.freezeDir} (run mis unfreeze to lift)`);
    if (!ctx.activeRun) return allow;
    if (abs.endsWith(sep + CONFIG)) return ask('changing .make-it-ship.json invalidates existing evidence');
    const inRepo = (abs + sep).startsWith(ctx.repoRoot + sep);
    if (inRepo && ctx.plannedFiles?.length) {
      const rel = abs.slice(ctx.repoRoot.length + 1);
      if (!ctx.plannedFiles.some((g) => globToRegExp(g).test(rel))) return ask(`${rel} is outside the approved plan's files; editing it widens the scope`);
    }
    return allow;
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__');
    if (ctx.activeRun && MCP_WRITE.test(name)) return ask(`external write via MCP (${tool}) needs your approval`);
  }
  return allow;
}
