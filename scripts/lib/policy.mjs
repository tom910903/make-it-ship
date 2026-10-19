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

const segments = (cmd) => cmd.split(/&&|\|\||[;|&\n]/).map((s) => s.trim()).filter(Boolean);
const PREFIX = ['time', 'nohup', 'sudo', 'env', 'command', 'exec', 'nice'];
/** Words of one segment, normalized: strip quotes and subshell/brace chars, drop VAR=val and wrapper prefixes, basename the program. */
function words(seg) {
  const ws = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((w) => w.replace(/^[({]+|[)}]+$/g, '').replace(/^["']|["']$/g, '')).filter(Boolean);
  while (ws.length && (PREFIX.includes(ws[0]) || /^[A-Za-z_]\w*=/.test(ws[0]))) ws.shift();
  if (ws[0]?.includes('/') && !ws[0].endsWith('.mjs')) ws[0] = ws[0].split('/').pop();
  return ws;
}
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

function classifyBash(cmd, ctx, cwd) {
  if (BASH_STATE.test(cmd)) return deny('run state is written only by mis.mjs; use `mis status` to read it');
  if (!ctx.activeRun) return allow;
  // Any approve through mis — direct, via a variable, or a shell function — needs the user's confirmation.
  if (/\bapprove\b/.test(cmd) && /\bmis\b|mis\.mjs/.test(cmd)) return ask('approval is recorded only when you confirm this command');
  if (/mis\.mjs["']?\s+init\b.*--write/.test(cmd)) return ask('writing .make-it-ship.json changes verification rules');
  if (cmd.includes(CONFIG) && (new RegExp(`>\\s*\\S*${CONFIG.replace('.', '\\.')}`).test(cmd) || /\b(sed\s+-i|tee|mv|cp|rm)\b/.test(cmd))) {
    return ask('changing .make-it-ship.json invalidates existing evidence');
  }
  let dir = cwd;
  let verdict = allow;
  for (const seg of segments(cmd)) {
    const ws = words(seg);
    if (ws[0] === 'cd' && ws[1]) { dir = resolve(dir, ws[1].replace(/^~/, homedir())); continue; }
    const g = gitSub(ws);
    let r = allow;
    if (/^(ba|z|da)?sh$/.test(ws[0]) && ws[1] === '-c' && ws[2]) r = classifyBash(ws[2], ctx, dir);
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
