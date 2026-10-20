// Guard policy (Spec §7): pure classification of a PreToolUse call.
// Threat model: careless/habitual mistakes, not an adversarial model (obfuscation is out of scope).
import { resolve, sep, dirname, basename, join } from 'node:path';
import { existsSync, lstatSync, readlinkSync, realpathSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
// The plugin's own MCP server (M7): its memory/state/wiki writes are local, not external; file rewriters are checked.
const OWN_MCP = 'mcp__plugin_make-it-ship_mis__';
const FILE_WRITERS = ['ast_grep_replace', 'lsp_rename', 'lsp_code_action_resolve'];

/** Real path of a possibly not-yet-existing file: resolve symlinks of the nearest existing ancestor. */
export function realish(abs, depth = 0) {
  let base = abs, rest = '';
  while (!existsSync(base) && dirname(base) !== base) {
    // a dangling symlink still decides where a write lands
    try { if (depth < 8 && lstatSync(base).isSymbolicLink()) return realish(join(resolve(dirname(base), readlinkSync(base)), rest), depth + 1); } catch { /* not a link */ }
    rest = rest ? join(basename(base), rest) : basename(base); base = dirname(base);
  }
  try { return rest ? join(realpathSync(base), rest) : realpathSync(base); } catch { return abs; }
}
const outsideFreeze = (abs, dir) => !(realish(abs) + sep).startsWith(dir + sep);
// M9-F8 debug scope: entries are real paths of files or directories.
const outsideScope = (abs, paths) => { const r = realish(abs); return !paths.some((p) => r === p || (r + sep).startsWith(p + sep)); };

import { commandsOf } from './shell.mjs';
import { describeFindings } from './redact.mjs';
import { BROWSE_ALWAYS_ASK, alwaysAskIn } from './browse/util.mjs';
import { maskSecrets } from './mask.mjs';
import { claudeDir, homeDir } from './home.mjs';
import { ingestCandidates } from './commands-gbrain.mjs';

// M9 fix1 D1/D6: files holding commands or changes that mis runs or applies later. Writing one is asked like running it
// (a stored command is a Bash command run later), with or without a run, through any tool.
const STORED_FILE = /(?:^|\/)\.make-it-ship\/(?:autoresearch\/[^/]+\/evaluator\.json|deploy\.json|self-improve\/proposals\/[^/]+\/(?:change\.patch|proposal\.json))$/;
const FILE_WRITER = /^(sed|perl|tee|mv|cp|ln|rsync|dd|install|truncate|patch)$/;
const READ_MCP = /(^|_)(read|get|list|search|query|find|view|stat|info|tree)(_|$)/i;
/** Masked, one-line, truncated: stored commands and endpoints shown in an ask (and kept in the trace log). */
const show = (s, n = 300) => { const t = maskSecrets(String(s)).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const list = (xs, n = 10) => `${xs.slice(0, n).map((x) => show(x, 160)).join(', ')}${xs.length > n ? `, … (${xs.length} in all)` : ''}`;
const storedWrite = (p, content) => ask(`${p} holds commands or changes that mis runs later (autoresearch evaluator, deploy steps, self-improve proposal); writing it is checked like running them${content ? ` — new content: ${show(content)}` : ''} — needs your approval`);
/** Repository of a directory: the nearest ancestor with .git (a dir, or a file in a linked worktree). */
function repoOf(dir) { for (let d = resolve(dir); ; d = dirname(d)) { if (existsSync(join(d, '.git'))) return d; if (dirname(d) === d) return null; } }
const readJsonAt = (f) => { try { return f ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; } };
const inRepo = (dir, ...p) => { const r = repoOf(dir); return r ? join(r, ...p) : null; };
const mcpPaths = (ti) => Object.entries(ti).filter(([k]) => /path|destination|file|target/i.test(k)).flatMap(([, v]) => [].concat(v)).filter((v) => typeof v === 'string');

const branchName = (ref) => ref.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '');

function gitSub(ws) {
  // git [-C dir | -c k=v | --flag]... <sub>
  if (ws[0] !== 'git') return null;
  let i = 1;
  while (i < ws.length && ws[i].startsWith('-')) i += ws[i] === '-C' || ws[i] === '-c' ? 2 : 1;
  return { sub: ws[i], rest: ws.slice(i + 1) };
}

/** Pre-push secret scan result (computed by guard.mjs, M9-B): shown in every push ask; never shows secret values. */
function scanNote(ctx) {
  const s = ctx.pushScan;
  if (!s) return '';
  if (s.error) return ` [secret scan unavailable: ${s.error}]`;
  if (!s.findings.length) return ` [secret scan: clean, ${s.commits} unpushed commit(s)]`;
  return ` [SECRET SCAN: ${s.findings.length} possible secret(s) in unpushed commits: ${describeFindings(s.findings)} — remove and rotate them before pushing]`;
}

function classifyPush(rest, ctx) {
  const force = rest.some((w) => /^(-f|--force|--force-with-lease)(=|$)/.test(w) || /^-[a-z]*f/.test(w));
  const refs = rest.filter((w) => !w.startsWith('-'));
  const targets = refs.slice(1).map(branchName).map((b) => (b === 'HEAD' ? ctx.currentBranch : b));
  const plusMain = refs.slice(1).some((r) => r.startsWith('+') && ['main', 'master'].includes(branchName(r)));
  const onMain = targets.some((t) => t === 'main' || t === 'master') || (!targets.length && ['main', 'master'].includes(ctx.currentBranch));
  if ((force && onMain) || plusMain) return deny('force push to the default branch is not allowed');
  if (force) return ask(`force push rewrites remote history; other people may lose work${scanNote(ctx)}`);
  return ask(`remote write (git push) needs your approval${scanNote(ctx)}`);
}

function dangerousRmTarget(t, cwd, repoRoot) {
  if (t === '/' || t.startsWith('~') || /\$\{?HOME\b/.test(t)) return true;
  const abs = realish(resolve(cwd, t));
  if (abs === realish(resolve(homedir()))) return true;
  return abs === repoRoot || !(abs + sep).startsWith(repoRoot + sep);
}

/** mis subcommand of a command, if it invokes mis.mjs (node <path>/mis.mjs, the script directly, or a shell function wrapping it). */
const NODE_VALUE_FLAGS = ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--env-file', '--title'];
function misSub(ws, functions) {
  if (['node', 'nodejs', 'bun', 'deno'].includes(ws[0])) {
    let k = ws[0].startsWith('node') || ws[1] !== 'run' ? 1 : 2; // bun|deno run <file>
    while (ws[k]?.startsWith('-')) {
      if (['-e', '-p', '--eval', '--print'].includes(ws[k])) return null;
      k += NODE_VALUE_FLAGS.includes(ws[k]) || /^\d+$/.test(ws[k + 1] ?? '') ? 2 : 1;
    }
    if (/(^|\/)mis\.mjs$/.test(ws[k] ?? '')) return ws.slice(k + 1);
    if (/^\$\{?\w+\}?$/.test(ws[k] ?? '')) return ws.slice(k + 1); // unresolved variable: could be mis.mjs
    return null;
  }
  if (/(^|\/)mis\.mjs$/.test(ws[0])) return ws.slice(1);
  if (ws[0] === 'mis') return ws.slice(1); // the skills' shorthand, possibly defined in the user's shell profile
  if (functions.has(ws[0]) && /mis\.mjs/.test(functions.get(ws[0]))) return ws.slice(1);
  return null;
}

function classifyBash(cmd, ctx, cwd) {
  // stored commands can name each other (an evaluator that runs mis autoresearch eval): fail closed past a few levels
  if ((ctx.depth ?? 0) > 3) return ask(`stored commands nest too deeply to check (${show(cmd, 120)}) — needs your approval`);
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
  for (const { argv: ws, redirects } of commands) {
    if (ws[0] === 'cd' && ws[1]) { dir = resolve(dir, ws[1].replace(/^~/, homedir())); continue; }
    const written = [...(redirects ?? []), ...(FILE_WRITER.test(ws[0] ?? '') ? ws.slice(1).filter((w) => !w.startsWith('-')) : [])];
    const stored = written.map((t) => resolve(dir, t.replace(/^~/, homedir()))).find((t) => STORED_FILE.test(t));
    let r = stored ? storedWrite(stored) : careful(ws, ctx, dir, functions);
    if (r.decision === 'allow') r = otherModelTeam(misSub(ws, functions), text);
    if (r.decision === 'allow') r = misInner(misSub(ws, functions), text, ctx, dir);
    if (r.decision === 'allow') r = storedMis(misSub(ws, functions), ctx, dir, text);
    if (r.decision === 'allow') r = externalMis(misSub(ws, functions), dir, text);
    if (r.decision === 'allow') r = outsideRepoMis(misSub(ws, functions));
    if (r.decision === 'allow') r = lastingChange(ws, misSub(ws, functions), text, redirects, dir, ctx);
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

function careful(ws, ctx, dir, functions) {
  const browse = misSub(ws, functions);
  if (browse?.[0] === 'browse') {
    // M8: the browser daemon refuses storage/js/eval/upload on non-local pages without --remote, and cdp inside chain
    if (browse[1] === 'cdp') return ask('raw Chrome DevTools Protocol (mis browse cdp) can read cookies and storage of any site in the browser');
    // M9-E: credentials, the user's Chrome, saved state and downloads ask every time (ADR-0003), wherever they appear
    const hit = alwaysAskIn(browse.slice(1))[0];
    if (hit) return ask(`mis browse ${hit} ${BROWSE_ALWAYS_ASK.get(hit)} — credential access needs your approval every time`);
    if (browse.includes('--remote')) {
      const sub = browse.find((w) => !w.startsWith('-') && w !== 'browse') ?? '';
      if (sub === 'upload' || (sub === 'chain' && /upload/.test(browse.join(' ')))) {
        return ask(`mis browse ${sub} --remote uploads local files to a non-local site: data leaves this machine (internal data must not go to outside services)`);
      }
      return ask(`mis browse ${sub} --remote reads or changes cookies/storage, runs JavaScript, or browses with imported credentials (logged-in cookies) on a non-local site`);
    }
  }
  if (browse?.[0] === 'setup' && browse[1] === 'routing' && browse.includes('--write')) return ask('mis setup routing --write changes the project CLAUDE.md; check the dry-run diff first — needs your approval');
  const g = gitSub(ws);
  if (g?.sub === 'push') {
    const r = classifyPush(g.rest, ctx);
    // Outside a run a plain push is allowed, unless the pre-push scan found secrets: then the user decides (never a silent block).
    return r.decision === 'deny' || /force/.test(r.reason) || ctx.pushScan?.findings?.length ? r : allow;
  }
  if (g?.sub === 'tag' && g.rest.some((w) => !w.startsWith('-')) && !g.rest.some((w) => ['-l', '--list', '-v', '--verify', '--contains', '--no-contains', '--points-at', '--merged', '--no-merged'].includes(w))) {
    return ask('creating or deleting a git tag marks a release; confirm the tag');
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
  if ((mis?.[0] === 'init' || (mis?.[0] === 'setup' && mis[1] === 'team')) && mis.includes('--write')) return ask('writing .make-it-ship.json changes verification rules');
  if (g?.sub === 'push') return classifyPush(g.rest, ctx);
  if (ws[0] === 'gh' && ((ws[1] === 'pr' && ['create', 'merge'].includes(ws[2])) || ws[1] === 'release')) return ask(`remote write (gh ${ws[1]} ${ws[2] ?? ''}) needs your approval`);
  if (isInstall(ws)) return ask('package install needs your approval (supply chain)');
  return allow;
}

/** M8: `mis team start --worker codex|gemini` (or a worker command override) launches another model in tmux panes. */
// M9 D0: mis subcommands that send data outside the company boundary always ask, with or without a run.
// Each entry: [mis argv prefix, reason, {when?: flag that must be present, unless?: flag that exempts}].
// Groups adding an external command register it here as a literal (guard.mjs loads only this file) and test it.
const OTHER_MODEL = 'sends your prompt and repository content to another model service (codex/gemini/claude CLI); company policy may forbid it';
export const EXTERNAL_MIS = [
  [['browse', 'download'], "mis browse download requests a remote URL with the browser's cookies"],
  [['browse', 'scrape'], "mis browse scrape requests every media URL of the page with the browser's cookies"],
  [['ask'], `mis ask ${OTHER_MODEL}`],
  [['ccg'], `mis ccg ${OTHER_MODEL}`],
  [['benchmark-models'], `mis benchmark-models ${OTHER_MODEL}`],
  [['interop'], `mis interop starts a Codex pane that ${OTHER_MODEL}`],
  [['telemetry', 'sync'], 'mis telemetry sync uploads local usage events to the configured endpoint'],
  [['telemetry', 'dashboard'], 'mis telemetry dashboard queries an external aggregate endpoint'],
  ...['init', 'import', 'sync', 'query', 'restore', 'artifacts-init'].map((s) => [['gbrain', s], `mis gbrain ${s} talks to gbrain (its engine, MCP or git remote may be outside this machine)`]),
  [['gbrain', 'ingest'], 'mis gbrain ingest writes session and artifact text into gbrain', { unless: '--probe' }],
  ...['generate', 'variants', 'iterate', 'evolve'].map((s) => [['design', s], `mis design ${s} sends your design brief (and images) to the OpenAI image API`]),
  [['pair-agent', 'start'], 'mis pair-agent start lets another AI agent drive your browser (and opens a public tunnel unless --local)'],
  [['ios', 'daemon', 'start'], 'mis ios daemon start --tailnet exposes the iOS QA relay on your tailnet', { when: '--tailnet' }],
  [['ios', 'mint'], 'mis ios mint grants a remote agent a token for the iOS QA relay on your tailnet'],
];
// M9-D: local actions that change the project or touch a deployment only after the user confirms (never silently).
export const APPROVAL_MIS = [
  [['approve', 'proposal'], 'mis approve proposal applies a self-improve change to process or skill files'],
  [['deploy', 'setup'], 'mis deploy setup --write saves the deploy configuration (commands that land-and-deploy will run)', { when: '--write' }],
  [['deploy', 'run'], 'mis deploy run --auto-revert merges and deploys, and if the health check fails it rolls back (the configured rollback command, or git revert of the merge and a redeploy)', { when: '--auto-revert', unless: '--dry-run' }],
  [['deploy', 'run'], 'mis deploy run merges and deploys (runs the configured deploy commands)', { unless: '--dry-run' }],
  [['canary'], 'mis canary loads your deployed site repeatedly in the browser'],
  [['redact', 'file'], 'mis redact file --apply rewrites the file with personal data and secrets replaced', { when: '--apply' }],
  [['ios', 'sync'], 'mis ios sync --apply overwrites the debug bridge files in this project', { when: '--apply' }],
];
const hit = (mis) => ([prefix, , o = {}]) => prefix.every((w, i) => mis[i] === w) && (!o.when || mis.includes(o.when)) && (!o.unless || !mis.includes(o.unless));
function externalMis(mis, dir = '.', text = '') {
  if (!mis) return allow;
  const e = EXTERNAL_MIS.find(hit(mis));
  if (e) return ask(`${e[1]}${detail(mis, dir, text)} — data leaves this machine; needs your approval`);
  const l = APPROVAL_MIS.find(hit(mis));
  return l ? ask(`${l[1]}${detail(mis, dir, text)} — needs your approval`) : allow;
}

const DEPLOY_STEPS = [['mergeCmd', 'merge'], ['deployCmd', 'deploy'], ['statusCmd', 'status'], ['ciCmd', 'CI'], ['rollbackCmd', 'rollback']];
const DEPLOY_FLAGS = { '--merge-cmd': 'mergeCmd', '--deploy-cmd': 'deployCmd', '--status-cmd': 'statusCmd', '--ci-cmd': 'ciCmd', '--rollback-cmd': 'rollbackCmd', '--health': 'healthUrl' };
const flagOf = (mis, f) => { const i = mis.findIndex((w) => w === f || w.startsWith(`${f}=`)); return i < 0 ? undefined : mis[i].startsWith(`${f}=`) ? mis[i].slice(f.length + 1) : mis[i + 1]; };
const deploySteps = (c) => DEPLOY_STEPS.filter(([k]) => c[k]).map(([k, n]) => `${n}: \`${show(c[k], 160)}\``).concat(c.healthUrl ? [`health check: ${show(c.healthUrl, 160)}`] : []).join('; ');

/** M9 fix1 D6: where the data goes and exactly what is sent or run, read from the same files mis will read. */
function detail(mis, dir, text) {
  try {
    const [a, b] = mis;
    if (a === 'telemetry') {
      const ep = readJsonAt(join(homeDir(), 'config.json'))?.telemetry?.endpoint;
      return ep ? ` [destination: ${show(ep)}]` : ' [no endpoint configured: nothing would be sent]';
    }
    if (a === 'gbrain') {
      const g = readJsonAt(join(homeDir(), 'gbrain.json')) ?? {}, root = repoOf(dir);
      const files = b === 'sync' ? (g.queue ?? []).map((x) => (typeof x === 'string' ? x : x.path))
        : b === 'ingest' && root ? ingestCandidates(root) : b === 'import' ? [resolve(dir, mis[2] ?? '.')] : [];
      const remote = ['restore', 'artifacts-init'].includes(b) ? mis[2] : g.artifactsRemote;
      return ` [git remote: ${remote ? show(remote) : 'none'}; gbrain engine: as configured in ~/.gbrain/config.json${['sync', 'ingest', 'import'].includes(b) ? `; files (${files.length}): ${files.length ? list(files) : 'none'}` : ''}]`;
    }
    if (a === 'design') return ` [destination: ${show(/\bMIS_OPENAI_BASE_URL=(\S+)/.exec(text)?.[1] ?? process.env.MIS_OPENAI_BASE_URL ?? 'https://api.openai.com')}]`;
    if (a === 'ask' && b) return ` [to: the ${show(b, 40)} CLI]`;
    if (a === 'pair-agent') return mis.includes('--local') ? ' [no tunnel: 127.0.0.1 only]' : ` [tunnel command: ${show(process.env.MIS_PAIR_TUNNEL_CMD ?? 'ngrok http <port>')}]`;
    if (a === 'canary') {
      const url = mis.slice(1).find((w, i, xs) => /^https?:\/\//.test(w) && !['--pages', '--interval', '--checks', '--max-pages'].includes(xs[i - 1]));
      const pages = String(flagOf(mis, '--pages') ?? (mis.includes('--discover') ? '' : '/')).split(',').filter(Boolean);
      return url ? ` [targets: ${list(pages.map((p) => { try { return new URL(p, url).href; } catch { return p; } }))}${mis.includes('--discover') ? `, plus same-origin pages of ${show(url)} found in its sitemap and links` : ''}]` : '';
    }
    if (a === 'deploy') {
      const c = readJsonAt(inRepo(dir, '.make-it-ship', 'deploy.json')) ?? {};
      if (b === 'setup') for (const [f, k] of Object.entries(DEPLOY_FLAGS)) { const v = flagOf(mis, f); if (v !== undefined) c[k] = v; }
      return ` [${b === 'setup' ? 'saves' : 'runs'}: ${deploySteps(c) || 'no commands configured'}]`;
    }
    if (a === 'approve' && b === 'proposal' && /^[\w.-]+$/.test(mis[2] ?? '')) {
      const p = readJsonAt(inRepo(dir, '.make-it-ship', 'self-improve', 'proposals', mis[2], 'proposal.json'));
      return p?.paths ? ` [changes: ${list(p.paths)}]` : '';
    }
  } catch { /* no detail: the registry reason still asks */ }
  return '';
}

/** M9 fix1 D1: mis subcommands that run a command stored in a file (evaluator, checks, deploy steps): classified like that Bash command. */
function storedCommands(mis, dir) {
  const [a, b] = mis;
  if (a === 'autoresearch' && b === 'eval' && /^[a-z0-9][a-z0-9-]*$/.test(mis[2] ?? '')) {
    const e = readJsonAt(inRepo(dir, '.make-it-ship', 'autoresearch', mis[2], 'evaluator.json'));
    return typeof e?.command === 'string' ? [['autoresearch evaluator', e.command]] : [];
  }
  // mis session create runs the quick checks in the new worktree as a baseline (unless --no-baseline)
  if (['check', 'bench', 'health'].includes(a) || (a === 'session' && b === 'create' && !mis.includes('--no-baseline'))) {
    const cfg = readJsonAt(inRepo(dir, '.make-it-ship.json')), checks = cfg?.checks ?? {};
    const names = a === 'health' ? Object.keys(checks).filter((n) => !n.startsWith('qa-')) : a === 'session' ? cfg?.required?.quick ?? Object.keys(checks) : [b];
    const q = (w) => `'${String(w).replace(/'/g, `'\\''`)}'`;
    return names.filter((n) => Array.isArray(checks[n]?.argv)).map((n) => [`check "${n}"`, checks[n].argv.map(q).join(' ')]);
  }
  if (a === 'deploy' && b === 'run' && !mis.includes('--dry-run')) {
    const c = readJsonAt(inRepo(dir, '.make-it-ship', 'deploy.json')) ?? {};
    return DEPLOY_STEPS.filter(([k]) => typeof c[k] === 'string').map(([k, n]) => [`deploy ${n}`, c[k]]);
  }
  return [];
}
function storedMis(mis, ctx, dir, text) {
  if (!mis) return allow;
  for (const [what, cmd] of storedCommands(mis, dir)) {
    const r = classifyBash(cmd, { ...ctx, depth: (ctx.depth ?? 0) + 1 }, dir);
    if (r.decision === 'allow') continue;
    const why = `mis ${mis[0]} runs the stored ${what} command \`${show(cmd)}\` — ${r.reason.replace(`${R}: `, '')}`;
    // a command that asks anyway (deploy run) keeps its own question, which lists every stored command
    const own = r.decision === 'ask' ? externalMis(mis, dir, text) : allow;
    return own.decision === 'ask' ? ask(`${own.reason.replace(`${R}: `, '')} [${why}]`) : { decision: r.decision, reason: `${R}: ${why}` };
  }
  return allow;
}

/** M9-C: `mis tty start -- <cmd>` runs and `mis tty send <text>` types a command line: classify it as that Bash command. */
function misInner(mis, text, ctx, dir) {
  if (mis?.[0] === 'skill' && mis[1] === 'test' && /\bMIS_SKILL_TEST_CMD=/.test(text)) return ask('a custom skill-test agent command (MIS_SKILL_TEST_CMD) may send the skill and scenarios to another service — needs your approval');
  const q = (w) => `'${String(w).replace(/'/g, `'\\''`)}'`;
  // M9-D: commands that mis runs for you later are classified like the same Bash command now.
  const inline = (f) => { const i = (mis ?? []).findIndex((w) => w === f || w.startsWith(`${f}=`)); return i < 0 ? null : mis[i].startsWith(`${f}=`) ? mis[i].slice(f.length + 1) : mis[i + 1] ?? null; };
  // mis wait auto types --text into the limit-stopped panes: in a shell pane that text runs as a command.
  if (mis?.[0] === 'wait' && mis[1] === 'auto' && inline('--text')) { const r = classifyBash(inline('--text'), ctx, dir); if (r.decision !== 'allow') return r; }
  if (['wait', 'detach'].includes(mis?.[0]) && mis.includes('--')) return classifyBash(mis.slice(mis.indexOf('--') + 1).map(q).join(' '), ctx, dir);
  const later = mis?.[0] === 'self-improve' && mis[1] === 'tournament' ? inline('--bench') : mis?.[0] === 'autoresearch' && mis[1] === 'init' ? inline('--eval') : null;
  if (later) return classifyBash(later, ctx, dir);
  if (mis?.[0] !== 'tty') return allow;
  if (mis[1] === 'start' && mis.includes('--')) return classifyBash(mis.slice(mis.indexOf('--') + 1).map(q).join(' '), ctx, dir);
  if (mis[1] === 'send') return classifyBash(mis.slice(3).filter((w) => w !== '--no-enter').join(' '), ctx, dir);
  if (mis[1] === 'keys') return ttyKeys(mis.slice(3), ctx, dir);
  return allow;
}

// tmux send-keys types a word that is not a key name literally, so `keys` is classified as the text it types (M9 r1 D2).
const TMUX_KEY = /^(?:(?:[CMS]-)+(?:.|[A-Z]\w*)|\^.|Enter|Escape|Tab|BTab|Space|BSpace|Up|Down|Left|Right|Home|End|PageUp|PgUp|PPage|PageDown|PgDn|NPage|Insert|IC|Delete|DC|F\d{1,2}|KP\w+)$/;
const NEWLINE_KEY = /^(?:Enter|KPEnter|C-[mj]|\^[MJ])$/;
// A word tmux may take as a send-keys option (flags c:FHKlMN:Rt:X); `-1` is not one. tmux may permute options, so any such
// word before `--` asks; after `--` every word is a key or text.
const TMUX_OPTION = /^-[FHKlMRX]*(?:[FHKlMRX]|[cNt].*)$/;
function ttyKeys(words, ctx, dir) {
  const dd = words.indexOf('--'), ks = dd < 0 ? words : [...words.slice(0, dd), ...words.slice(dd + 1)];
  if (words.slice(0, dd < 0 ? words.length : dd).some((k) => TMUX_OPTION.test(k))) return ask('mis tty keys passes words starting with "-" to tmux as options (hex input, another pane) — needs your approval');
  // Other key names (C-c, Up, ...) type nothing; text on both sides of them is joined, which can only make this stricter.
  const typed = ks.map((k) => (k === 'Space' ? ' ' : NEWLINE_KEY.test(k) ? '\n' : TMUX_KEY.test(k) ? '' : k)).join('');
  return classifyBash(typed, ctx, dir);
}

// M9-A: mis subcommands that change files outside this repository (~/.claude settings and CLAUDE.md, MCP config,
// the installed plugin, ~/.make-it-ship) always ask, with or without a run. Their default (dry) forms only print.
function outsideRepoMis(m) {
  if (!m) return allow;
  const [sub, a] = m, has = (f) => m.includes(f);
  const why = (sub === 'setup' && a !== 'team' && (has('--write') || has('--apply'))) ? 'mis setup --write edits ~/.claude/settings.json and ~/.claude/CLAUDE.md (review the diff from `mis setup` first)'
    : (sub === 'doctor' && has('--fix')) ? 'mis doctor --fix repairs ~/.claude/settings.json and Make It Ship state'
    : (sub === 'mcp-setup' && a === 'add' && has('--write')) ? 'mis mcp-setup add --write registers an MCP server in your Claude Code config'
    : (sub === 'upgrade' && has('--yes')) ? 'mis upgrade --yes updates the installed plugin'
    : (sub === 'uninstall' && has('--yes')) ? 'mis uninstall --yes deletes Make It Ship state and settings entries (see `mis uninstall` for the list)'
    : null;
  return why ? ask(`${why} — changes files outside this repository; needs your approval`) : allow;
}

// M9 r1 D1/D8/D9/D10/D13: lasting changes outside this repository that a wrapper's ask alone would not catch.
// Keys of `mis config` that neither run a command nor contact a URL (commands-setup.mjs CONFIG_KEYS without `sensitive`;
// a test keeps the two equal). Any other key, including an unknown or variable one, asks.
export const NON_SENSITIVE_CONFIG = ['style.default', 'keywords.disabled', 'subagentMatcher', 'update.check', 'maintenance.retainDays',
  'telemetry.enabled', 'simplifier.enabled', 'simplifier.maxFiles', 'proactive'];
const CLAUDE_CHANGES = { mcp: ['add', 'add-json', 'add-from-claude-desktop', 'remove', 'reset-project-choices'], plugin: ['install', 'i', 'uninstall', 'remove', 'update', 'enable', 'disable'],
  'plugin marketplace': ['add', 'remove', 'rm', 'update'], config: ['set', 'add', 'remove'] };
// --settings (a file or JSON) can set permissions.defaultMode: any --settings on launch asks (M9 r2 D3)
const BYPASS = (m) => m.some((w, i) => /^--(?:allow-)?dangerously-skip-permissions(?:=|$)|^--permission-mode=bypassPermissions$|^--settings(?:=|$)/.test(w)
  || (w === '--permission-mode' && m[i + 1] === 'bypassPermissions'));
/** argv after the `claude` program: direct, or run from the package by npx/bunx/pnpm dlx/yarn dlx/npm exec; else null. */
function claudeArgs(ws) {
  if (ws[0] === 'claude') return ws.slice(1);
  if (!['npx', 'bunx', 'pnpm', 'yarn', 'npm'].includes(ws[0])) return null;
  const k = ws.findIndex((w) => /^@anthropic-ai\/claude-code(?:@[^/]*)?$/.test(w));
  if (k < 0) return null;
  const rest = ws.slice(k + 1);
  if (rest[0] === '--') rest.shift();
  if (rest[0] === 'claude') rest.shift(); // npx -p @anthropic-ai/claude-code claude …
  return rest;
}
const expandHome = (p) => p.replace(/^~(?=\/|$)/, homedir()).replace(/^\$\{?HOME\}?(?=\/|$)/, homedir());
const under = (p, d) => (p + sep).startsWith(d + sep);

/** Why writing `abs` is a lasting change to Claude Code or Make It Ship configuration, or null. */
// shortcut: paths compare case-insensitively everywhere (macOS APFS default), so a case-sensitive volume over-asks for
// odd-case names like ~/.claude/Settings.json; detect the volume's case rule if that ever matters.
const lc = (p) => p.toLowerCase();
const CLAUDE_MD = /^claude(?:\.local)?\.md$/;
function protectedFile(abs, repoRoot) {
  const home = lc(homedir()), mh = lc(homeDir()), cds = [...new Set([claudeDir(), join(homedir(), '.claude')].flatMap((c) => [lc(c), lc(realish(c))]))];
  for (const p of new Set([lc(abs), lc(realish(abs))])) {
    const name = basename(p), d = dirname(p);
    if (cds.includes(d) && (/^settings.*\.json$/.test(name) || name === 'claude.md')) return `${p} is your Claude Code configuration (used by every session)`;
    // skills, agents, commands and rules are instructions in every session; hooks scripts run in every session
    if (cds.some((c) => ['skills', 'agents', 'commands', 'rules', 'hooks'].some((x) => under(p, join(c, x))))) return `${p} is in your Claude Code configuration (skills, agents, commands, rules or hooks used by every session)`;
    if (p === join(home, '.claude.json') || cds.some((c) => p === join(c, '.claude.json'))) return `${p} holds your Claude Code MCP servers and project settings`;
    if (basename(d) === '.claude' && /^settings.*\.json$/.test(name)) return `${p} is Claude Code settings (permissions and hooks that run commands)`;
    if (CLAUDE_MD.test(name) && !under(p, lc(realish(repoRoot)))) return `${p} is a ${name} outside this repository (instructions for other sessions)`;
    if (p === join(mh, 'config.json') || under(p, join(mh, 'skills')) || p === join(mh, 'trusted-repos.json')) return `${p} is Make It Ship user configuration (applies to every repository)`;
  }
  return null;
}

// M9 r2 D4: MCP tools that may write a file, by a verb in the name (`set`/`put` only as a word: not settings, input).
const MCP_WRITER = (name) => /write|edit|create|update|patch|insert|move|copy|rename|replace|delete|remove|append|save|upload/i.test(name)
  || /(?:^|[_\-.])(?:set|put)(?=$|[_\-.]|[A-Z0-9])|(?:^|[_\-.])(?:Set|Put)/.test(name);
/** Path-like strings anywhere in an MCP tool input (nested objects/arrays, bounded); `file:` URLs become paths. */
function mcpPathsDeep(input) {
  const out = [];
  let budget = 500;
  const walk = (v, keyed, depth) => {
    if (--budget < 0 || depth > 6) return;
    if (typeof v === 'string') {
      if (!keyed) return;
      if (/^file:/i.test(v)) { try { out.push(fileURLToPath(v)); } catch { /* not a local file URL */ } } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x, keyed, depth + 1);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, /path|file|dest|target|uri|url/i.test(k), depth + 1);
  };
  walk(input, false, 0);
  return out;
}

/** Files a shell command writes, moves or deletes (redirects, tee, cp/mv/ln/install/rsync destinations, sed/perl -i, dd of=, rm). */
function shellTargets(ws, redirects, dir) {
  const [n, ...rest] = ws, args = rest.filter((w) => !w.startsWith('-'));
  const t = [...redirects];
  const ti = rest.findIndex((w) => w === '-t' || w.startsWith('--target-directory'));
  // a copy or move into a directory writes dest/<basename of each source>
  const intoDir = (dest, srcs) => {
    let isDir = dest.endsWith('/');
    try { isDir ||= statSync(resolve(dir, expandHome(dest))).isDirectory(); } catch { /* not there: a file name */ }
    return isDir ? srcs.map((a) => join(dest, basename(a))) : [];
  };
  const valueOf = (short, long) => rest.flatMap((w, i) => (new RegExp(`^-[a-zA-Z]*${short}$`).test(w) ? [rest[i + 1]] : w === long ? [rest[i + 1]] : w.startsWith(`${long}=`) ? [w.slice(long.length + 1)] : []));
  if (n === 'tee' || n === 'mv' || n === 'rm' || n === 'truncate') t.push(...args, ...(n === 'mv' && args.length > 1 ? intoDir(args.at(-1), args.slice(0, -1)) : []));
  else if (['cp', 'install', 'ln', 'rsync', 'scp'].includes(n)) {
    if (ti >= 0) { const dirArg = rest[ti].includes('=') ? rest[ti].split('=')[1] : rest[ti + 1]; t.push(dirArg, ...args.filter((a) => a !== dirArg).map((a) => join(dirArg, basename(a)))); }
    else if (args.length) t.push(args.at(-1), ...intoDir(args.at(-1), args.slice(0, -1)));
  } else if ((n === 'sed' || n === 'perl') && rest.some((w) => /^-[a-zA-Z]*i|^--in-place/.test(w))) t.push(...args);
  else if (n === 'dd') t.push(...rest.filter((w) => w.startsWith('of=')).map((w) => w.slice(3)));
  else if (n === 'curl') t.push(...valueOf('o', '--output'));
  else if (n === 'wget') t.push(...valueOf('O', '--output-document'));
  else if (n === 'patch') t.push(...args);
  return t.filter(Boolean);
}

function lastingChange(ws, m, text, redirects, dir, ctx) {
  const why = (() => {
    if (m) {
      const [sub, a] = m, has = (f) => m.includes(f);
      if (/\bxargs\b/.test(text)) return 'mis.mjs run through xargs takes its subcommand from input the guard cannot see';
      if (sub === 'config' && a === 'set' && !NON_SENSITIVE_CONFIG.includes(m[2])) return `mis config set ${m[2] ?? ''} stores a command or URL that Make It Ship runs or contacts later (or a key the guard cannot check)`;
      if (sub === 'telemetry' && a === 'endpoint' && m[2] !== undefined) return 'mis telemetry endpoint sets the URL that usage events are uploaded to';
      if (sub === 'skill' && ['add', 'edit'].includes(a) && (has('--scope=user') || m.some((w, i) => w === '--scope' && m[i + 1] === 'user'))) return 'a user-scope skill is offered in every repository\'s prompts as an instruction to follow';
      if (sub === 'skill' && a === 'trust' && !has('--remove')) return 'mis skill trust lets this repository\'s .make-it-ship/skills be followed as instructions';
      if (sub === 'launch' && BYPASS(m)) return 'mis launch starts Claude Code without permission prompts in a detached tmux session nobody watches';
    }
    const cl = claudeArgs(ws);
    // global flags may come first and some take an optional value (--debug [filter]): look for the subcommand anywhere
    for (let i = 0; cl && i < cl.length; i++) {
      const key = cl[i] === 'plugin' && cl[i + 1] === 'marketplace' ? 'plugin marketplace' : cl[i];
      const verb = key === 'plugin marketplace' ? cl[i + 2] : cl[i + 1];
      if (CLAUDE_CHANGES[key]?.includes(verb)) return `claude ${key} ${verb} changes your Claude Code configuration for every session`;
    }
    for (const p of shellTargets(ws, redirects ?? [], dir)) { const w = protectedFile(resolve(dir, expandHome(p)), ctx.sessionRoot ?? ctx.repoRoot); if (w) return w; }
    return null;
  })();
  return why ? ask(`${why} — a lasting change outside this repository; needs your approval`) : allow;
}

function otherModelTeam(mis, text) {
  if (mis?.[0] !== 'team' || mis[1] !== 'start') return allow;
  const w = mis.find((a, i) => a.startsWith('--worker=') || mis[i - 1] === '--worker');
  if ((w && !/^(--worker=)?claude$/.test(w)) || /\bMIS_TEAM_WORKER_CMD=/.test(text)) {
    return ask('team workers on another model (codex/gemini or a custom worker command) send repository content to an external model service — needs your approval');
  }
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
 * @param ctx {repoRoot, activeRun, currentBranch, plannedFiles?: string[]|null, freezeDir?: string|null, debugScope?: string[]|null, sessionRoot?: string}
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
    if (STORED_FILE.test(abs) || STORED_FILE.test(realish(abs))) return storedWrite(abs, ti.content ?? ti.new_string ?? ti.edits?.map((e) => e.new_string).join(' | ') ?? ti.new_source);
    if (ctx.debugScope?.length && outsideScope(abs, ctx.debugScope)) return ask(`${abs} is outside the debug scope (${ctx.debugScope.join(', ')}); a fix outside the hypothesis widens the change (mis debug scope --clear to lift)`);
    const pf = protectedFile(abs, ctx.sessionRoot ?? ctx.repoRoot); // the target's own repo would always contain it
    if (pf) return ask(`${pf} — a lasting configuration change; needs your approval`);
    if (!ctx.activeRun) return allow;
    if (abs.endsWith(sep + CONFIG)) return ask('changing .make-it-ship.json invalidates existing evidence');
    const inRepo = (abs + sep).startsWith(ctx.repoRoot + sep);
    if (inRepo && ctx.plannedFiles?.length) {
      const rel = abs.slice(ctx.repoRoot.length + 1);
      if (!ctx.plannedFiles.some((g) => globToRegExp(g).test(rel))) return ask(`${rel} is outside the approved plan's files; editing it widens the scope`);
    }
    return allow;
  }
  if (tool.startsWith('mcp__') && MCP_WRITER(tool.split('__').slice(2).join('__'))) {
    for (const p of mcpPathsDeep(ti)) { const pf = protectedFile(resolve(cwd, expandHome(p)), ctx.sessionRoot ?? ctx.repoRoot); if (pf) return ask(`${pf} — a lasting configuration change (${tool}); needs your approval`); }
  }
  if (tool.startsWith(OWN_MCP)) {
    const name = tool.slice(OWN_MCP.length);
    const writes = name === 'lsp_code_action_resolve' || (FILE_WRITERS.includes(name) && ti.apply === true);
    if (!writes) return allow;
    const stored = mcpPaths(ti).map((p) => resolve(cwd, p)).find((p) => STORED_FILE.test(p));
    if (stored) return storedWrite(stored);
    if (ctx.freezeDir) {
      const paths = name === 'ast_grep_replace' ? [].concat(ti.paths ?? []) : [];
      if (!paths.length || paths.some((p) => outsideFreeze(resolve(cwd, p), ctx.freezeDir))) return deny(`edits are frozen to ${ctx.freezeDir} (run mis unfreeze to lift)`);
    }
    return ctx.activeRun ? ask(`${name} rewrites files outside the plan's per-file check; confirm the change`) : allow;
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__');
    const stored = !READ_MCP.test(name) || MCP_WRITE.test(name) ? mcpPaths(ti).map((p) => resolve(cwd, p)).find((p) => STORED_FILE.test(p)) : null;
    if (stored) return storedWrite(stored, ti.content ?? ti.edits?.map((e) => e.newText ?? e.new_string).join(' | '));
    if (ctx.activeRun && MCP_WRITE.test(name)) return ask(`external write via MCP (${tool}) needs your approval`);
  }
  return allow;
}
