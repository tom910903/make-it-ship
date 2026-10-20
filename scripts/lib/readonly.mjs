// PermissionRequest auto-allow (M9-F3, absorbs OMC permission-handler; see THIRD_PARTY_NOTICES.md).
// A Bash call is auto-allowed only when it is one plain read-only command by the guard's own shell parser AND the guard
// allows it with and without an active run AND no user `permissions.ask` rule covers it. Anything else: no decision.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseShell } from './shell.mjs';
import { classify } from './policy.mjs';

// Any shell metacharacter (pipes, lists, redirects, substitutions, variables, escapes, groups, newlines) → no decision.
const META = /[;&|<>`$\\\n\r(){}]/;
const PLAIN = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'stat', 'which', 'grep', 'rg', 'find', 'du', 'df', 'whoami', 'uname', 'echo', 'basename', 'dirname', 'realpath', 'readlink']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'branch']);
const GIT_BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes', '--verbose']);
const FIND_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);

/** One read-only command with no shell metacharacters, wrappers, assignments, redirects or heredocs. */
export function readOnlyCommand(cmd) {
  const src = String(cmd ?? '').trim();
  if (!src || META.test(src)) return false;
  const { commands } = parseShell(src);
  if (commands.length !== 1) return false;
  const [c] = commands;
  if (c.redirects?.length || c.heredoc !== undefined) return false;
  const [name, ...args] = c.argv;
  if (!name || name.includes('/') || name.includes('=')) return false;
  if (name === 'git') {
    const [sub, ...rest] = args;
    if (!GIT_READ.has(sub)) return false; // also rejects git -c/-C/--exec-path… before the subcommand
    if (rest.some((a) => /^--(output|ext-diff|textconv)/.test(a))) return false;
    return sub !== 'branch' || rest.every((a) => GIT_BRANCH_FLAGS.has(a));
  }
  if (!PLAIN.has(name)) return false;
  if (name === 'find' && args.some((a) => FIND_ACTIONS.has(a))) return false;
  if (name === 'rg' && args.some((a) => a.startsWith('--pre'))) return false;
  return true;
}

/** User `permissions.ask` rules for Bash (user, project, local settings). A matching rule keeps the prompt. */
function askedByUser(cmd, cwd) {
  const dirs = [process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')];
  const files = [join(dirs[0], 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')];
  for (const f of files) {
    let rules = [];
    try { rules = JSON.parse(readFileSync(f, 'utf8'))?.permissions?.ask ?? []; } catch { continue; }
    for (const r of rules) {
      if (r === 'Bash') return true;
      const m = String(r).match(/^Bash\((.*)\)$/);
      if (!m) continue;
      const p = m[1].replace(/:\*$|\*$/, '');
      if (m[1] === cmd || (p !== m[1] && cmd.startsWith(p))) return true;
    }
  }
  return false;
}

/** PermissionRequest hook output, or null (no decision: the normal permission prompt). */
export function permissionDecision(input) {
  if (input?.tool_name !== 'Bash') return null;
  const cmd = String(input.tool_input?.command ?? '').trim();
  const cwd = input.cwd || process.cwd();
  if (!readOnlyCommand(cmd)) return null;
  for (const activeRun of [true, false]) {
    if (classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd }, { repoRoot: cwd, activeRun, currentBranch: null }).decision !== 'allow') return null;
  }
  if (askedByUser(cmd, cwd)) return null;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
}
