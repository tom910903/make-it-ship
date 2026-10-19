// Guard policy (Spec §7): pure classification of a PreToolUse call.
// Threat model: careless/habitual mistakes, not an adversarial model (obfuscation is out of scope).
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const R = 'make-it-ship';
const allow = { decision: 'allow' };
const ask = (reason) => ({ decision: 'ask', reason: `${R}: ${reason}` });
const deny = (reason) => ({ decision: 'deny', reason: `${R}: ${reason}` });

const STATE_PATH = /\.git\/(?:.*\/)?make-it-ship\/(?:runs\/|current$)/;
// Any mention of the state dir in a shell command is denied: mis.mjs never takes state paths as arguments.
const BASH_STATE = /make-it-ship\/(?:runs|current)\b|\.git\/(?:[^\s'"]*\/)?make-it-ship\b/;
const MCP_WRITE = /create|update|delete|send|push|merge|upload|transition|edit|write/i;
const CONFIG = '.make-it-ship.json';

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
  const targets = refs.slice(1).map(branchName);
  const plusMain = refs.slice(1).some((r) => r.startsWith('+') && ['main', 'master'].includes(branchName(r)));
  const onMain = targets.some((t) => t === 'main' || t === 'master') || (!targets.length && ['main', 'master'].includes(ctx.currentBranch));
  if ((force && onMain) || plusMain) return deny('force push to the default branch is not allowed');
  return ask('remote write (git push) needs your approval');
}

function dangerousRmTarget(t, cwd, repoRoot) {
  if (t === '/' || t.startsWith('~') || /\$\{?HOME\b/.test(t)) return true;
  const abs = resolve(cwd, t);
  if (abs === resolve(homedir())) return true;
  return abs === repoRoot || !(abs + sep).startsWith(repoRoot + sep);
}

/** mis subcommand of a command, if it invokes mis.mjs (node <path>/mis.mjs, the script directly, or a shell function wrapping it). */
function misSub(ws, functions) {
  if (ws[0] === 'node' && /(^|\/)mis\.mjs$/.test(ws[1] ?? '')) return ws.slice(2);
  if (ws[0] === 'node' && /^\$\{?\w+\}?$/.test(ws[1] ?? '')) return ws.slice(2); // unresolved variable: could be mis.mjs
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
    if (c.argv[0] === 'cd' && c.argv[1] && /\.git(\/|$)/.test(c.argv[1]) && /make-it-ship/.test(resolve(dir, c.argv[1]))) {
      return deny('run state is written only by mis.mjs');
    }
  }
  if (!ctx.activeRun) return allow;
  if (commands.some((c) => c.redirects.some((t) => t.endsWith(CONFIG))) ||
      (text.includes(CONFIG) && /\b(sed\s+-i|tee|mv|cp|rm)\b/.test(text))) {
    return ask('changing .make-it-ship.json invalidates existing evidence');
  }
  let verdict = allow;
  for (const { argv: ws } of commands) {
    if (ws[0] === 'cd' && ws[1]) { dir = resolve(dir, ws[1].replace(/^~/, homedir())); continue; }
    const g = gitSub(ws);
    const mis = misSub(ws, functions);
    let r = allow;
    if (mis?.[0] === 'approve') r = ask('approval is recorded only when you confirm this command');
    else if (mis?.[0] === 'init' && mis.includes('--write')) r = ask('writing .make-it-ship.json changes verification rules');
    else if (g?.sub === 'push') r = classifyPush(g.rest, ctx);
    else if (g?.sub === 'reset' && g.rest.includes('--hard')) r = ask('git reset --hard discards local changes');
    else if (g?.sub === 'clean' && g.rest.some((w) => /^-[a-z]*f/.test(w) || w === '--force')) r = ask('git clean -f deletes untracked files');
    else if (ws[0] === 'gh' && ((ws[1] === 'pr' && ['create', 'merge'].includes(ws[2])) || ws[1] === 'release')) r = ask(`remote write (gh ${ws[1]} ${ws[2] ?? ''}) needs your approval`);
    else if (isInstall(ws)) r = ask('package install needs your approval (supply chain)');
    else if (ws[0] === 'rm') {
      const flags = ws.slice(1).filter((w) => w.startsWith('-'));
      const recursive = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f));
      const targets = ws.slice(1).filter((w) => !w.startsWith('-'));
      if (recursive && targets.some((t) => dangerousRmTarget(t, dir, ctx.repoRoot))) r = ask('recursive delete outside the repository');
    }
    if (r.decision === 'deny') return r;
    if (r.decision === 'ask' && verdict.decision === 'allow') verdict = r;
  }
  return verdict;
}

function isInstall(ws) {
  const [a, b] = ws;
  if (['npm', 'pnpm'].includes(a) && ['i', 'install', 'add'].includes(b)) return true;
  if (a === 'yarn' && b === 'add') return true;
  if (/^pip3?$/.test(a) && b === 'install') return true;
  if (/^python3?$/.test(a) && b === '-m' && /^pip3?$/.test(ws[2]) && ws[3] === 'install') return true;
  if (a === 'brew' && b === 'install') return true;
  if (a === 'cargo' && b === 'add') return true;
  return false;
}

/**
 * @param input PreToolUse hook input {tool_name, tool_input, cwd}
 * @param ctx {repoRoot, activeRun, currentBranch}
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
    if (!ctx.activeRun) return allow;
    if (abs.endsWith(sep + CONFIG)) return ask('changing .make-it-ship.json invalidates existing evidence');
    return allow;
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__');
    if (ctx.activeRun && MCP_WRITE.test(name)) return ask(`external write via MCP (${tool}) needs your approval`);
  }
  return allow;
}
