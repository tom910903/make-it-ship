// PermissionRequest auto-allow (M9-F3, absorbs OMC permission-handler; see THIRD_PARTY_NOTICES.md).
// A Bash call is auto-allowed only when it is one plain read-only command by the guard's own shell parser AND the guard
// allows it with and without an active run AND no user `permissions.ask` rule covers it AND every path it names is
// inside the repository (symlinks resolved) and not secret-like (M9 r1 D3). Anything else: no decision.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseShell } from './shell.mjs';
import { classify, realish } from './policy.mjs';

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

// Any path component that names a credential or secret store.
const SECRET = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|keychain(?:-db)?|asc|gpg)|id_[a-z0-9_]+(?:\.pub)?|\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.gcloud|\.netrc|_netrc|\.npmrc|\.pypirc|\.pgpass|\.htpasswd|\.git-credentials|credentials(?:\..*)?|secrets?(?:\..*)?|keychains?|\.password-store)$/i;
const FIND_PATTERNS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-lname', '-ilname']);
const GLOB = /[*?[\]]/;

/** Every path a read-only command names stays inside `root` (real paths) and none is secret-like. */
// shortcut: a recursive grep of an in-repo directory may still read a secret file inside it (rg skips hidden/ignored
// files, grep -r does not); checking every file under the directory would be needed to close that.
function pathsSafe(name, args, cwd, root) {
  const secret = (p) => p.split(/[/:]/).some((c) => SECRET.test(c));
  if (name === 'git') return !args.includes('--no-index') && !args.some(secret); // git itself refuses paths outside the repository
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (name === 'find' && FIND_PATTERNS.has(a)) { i++; continue; } // a name pattern, not a path
    if (a.startsWith('-')) { if (a.includes('=')) words.push(a.slice(a.indexOf('=') + 1)); continue; }
    words.push(a);
  }
  const pattern = ['grep', 'rg'].includes(name) && !args.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a)) ? args.find((x) => !x.startsWith('-')) : undefined;
  return words.every((w) => {
    if (w !== pattern && GLOB.test(w)) return false; // the shell expands it to names we cannot see (cat .e* → .env)
    if (secret(w)) return false;
    const real = realish(resolve(cwd, w.replace(/^~(?=\/|$)/, homedir())));
    return (real + sep).startsWith(root + sep) && !real.split(sep).some((c) => SECRET.test(c));
  });
}

/** Repository root of cwd (real path), or cwd itself outside a repository. */
function rootOf(cwd) {
  try { return realish(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return realish(resolve(cwd)); }
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
  const [name, ...args] = parseShell(cmd).commands[0].argv;
  if (!pathsSafe(name, args, cwd, rootOf(cwd))) return null;
  for (const activeRun of [true, false]) {
    if (classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd }, { repoRoot: cwd, activeRun, currentBranch: null }).decision !== 'allow') return null;
  }
  if (askedByUser(cmd, cwd)) return null;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
}
