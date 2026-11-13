import { setupRouting } from './commands-always.mjs';
// mis commands of M9-A (setup & lifecycle): setup (global settings + instruction migration, team bootstrap), doctor
// (+ --fix, session), mcp-setup, config, version, update-check, upgrade, uninstall, launch, and cancel --all.
// Absorbs OMC omc-setup/setup/install/doctor/debug/mcp-setup/config/version/update/launch/cancel and gstack
// upgrade/update-check/uninstall/config/settings-hook/team-init/platform-detect (own implementations).
// Everything that edits files outside the repository is dry by default; the executing flag makes the guard ask.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { claudeDir, globalConfig, homeDir, readHome, writeHome } from './home.mjs';
import { applyChanges, diffText, isOurStatusLine, KNOWN_MCP, mcpRegistrations, planSetup, PLUGIN_ROOT, statusLineCommand } from './install.mjs';
import { installKind, pluginVersion, updateCheck, upgradeCommands } from './update.mjs';
import { detectConfig, doctor as baseDoctor, writeConfig } from './setup.mjs';
import { CONFIG_FILE } from './config.mjs';
import { repoRoot } from './tree-hash.mjs';
import { stateRoot, pidAlive, loadRun, reclaimLock, TERMINAL } from './state.mjs';
import { readLoop, endLoop } from './loop.mjs';
import { readTrace } from './trace.mjs';
import { DEFAULT_PRESET, PRESETS, isItem, isPreset } from './hud-items.mjs';

const fail = (msg) => { throw new Error(msg); };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const tryRoot = (cwd) => { try { return repoRoot(cwd); } catch { return null; } };
const tryState = (cwd) => { try { return stateRoot(cwd); } catch { return null; } };
const onPath = (name) => (process.env.PATH ?? '').split(':').some((d) => d && existsSync(join(d, name)));

// ---------------------------------------------------------------- setup

function setupTeam(args, cwd) {
  const root = repoRoot(cwd);
  const files = [];
  if (!existsSync(join(root, CONFIG_FILE))) {
    const d = detectConfig(root);
    if (d.config) files.push({ path: CONFIG_FILE, content: JSON.stringify(d.config, null, 2) + '\n' });
  }
  const gi = join(root, '.gitignore');
  const ignore = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!/^\/?\.worktrees\/?$/m.test(ignore)) files.push({ path: '.gitignore', append: '.worktrees/\n' });
  if (!args.includes('--write')) return { dryRun: true, files, next: files.length ? 'mis setup team --write creates these (shared with the team through git)' : 'nothing to add' };
  for (const f of files) {
    if (f.content) writeConfig(root, JSON.parse(f.content));
    else appendFileSync(gi, (ignore && !ignore.endsWith('\n') ? '\n' : '') + f.append);
  }
  return { dryRun: false, files: files.map((f) => ({ path: f.path })) };
}

function setup(args, cwd) {
  if (args[0] === 'team') return setupTeam(args.slice(1), cwd);
  if (args[0] === 'routing') return setupRouting(args, cwd);
  if (args[0] !== undefined && !args[0].startsWith('--')) fail('usage: mis setup [--write] | setup team [--write] | setup routing [--write]');
  const { changes, review } = planSetup();
  const reviewNote = review.length ? 'These lines refer to plugins Make It Ship replaces; edit them by hand if they no longer apply.' : undefined;
  if (!args.includes('--write') && !args.includes('--apply')) {
    return { dryRun: true, changes: changes.map(({ file, diff }) => ({ file, diff })), review, reviewNote,
      next: changes.length ? 'Show the diff to the user. After they approve, run mis setup --write (the guard asks first); backups are kept next to each file.' : 'already set up' };
  }
  const backups = applyChanges(changes);
  return { dryRun: false, changes: changes.map((c) => c.file), backups, review, reviewNote, next: changes.length ? 'Restart Claude Code to load the new status line and CLAUDE.md.' : undefined };
}

// ---------------------------------------------------------------- doctor

async function mcpTools() {
  const { loadTools } = await import('../mcp/registry.mjs');
  const expected = (await loadTools()).length;
  const p = spawn(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'mcp', 'server.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    const got = await new Promise((res, rej) => {
      let buf = '';
      const timer = setTimeout(() => rej(new Error('no tools/list answer within 15s')), 15000);
      p.on('error', rej);
      p.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').slice(0, -1)) {
          try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); res(m.result?.tools?.length ?? 0); } } catch { /* partial */ }
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
      });
      const send = (o) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mis-doctor', version: '0' } } });
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list' });
    });
    return { name: 'mcp', status: got === expected && got > 0 ? 'ok' : 'error', detail: `MCP server answered tools/list with ${got} tools (registry: ${expected})` };
  } catch (e) {
    return { name: 'mcp', status: 'error', detail: `MCP server did not start: ${e.message}` };
  } finally { p.kill(); }
}

function hooksCheck() {
  const hj = readJson(join(PLUGIN_ROOT, 'hooks', 'hooks.json'));
  if (!hj?.hooks) return { name: 'hooks', status: 'error', detail: 'hooks/hooks.json missing or invalid' };
  const cmds = Object.values(hj.hooks).flat().flatMap((m) => m.hooks ?? []).map((h) => h.command);
  const missing = cmds.flatMap((c) => [...c.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)].map((m) => m[1])).filter((f) => !existsSync(join(PLUGIN_ROOT, f)));
  return { name: 'hooks', status: missing.length ? 'error' : 'ok', detail: missing.length ? `hook scripts missing: ${missing.join(', ')}` : `${Object.keys(hj.hooks).length} events, ${cmds.length} commands` };
}

/** Broken things `--fix` can repair: [{check, fix()}]. */
function fixables(cwd) {
  const out = [];
  const sp = join(claudeDir(), 'settings.json');
  const s = readJson(sp);
  const cmd = s?.statusLine?.command;
  const path = cmd?.match(/"([^"]*statusline\.mjs)"|(\S*statusline\.mjs)/)?.slice(1).find(Boolean);
  if (isOurStatusLine(cmd) && cmd !== statusLineCommand() && path && !existsSync(path)) {
    const change = { file: sp, before: readFileSync(sp, 'utf8'), after: JSON.stringify({ ...s, statusLine: { ...s.statusLine, command: statusLineCommand() } }, null, 2) + '\n' };
    out.push({ check: { name: 'statusLine', status: 'error', detail: `statusLine points at a missing file ${path} (an old plugin version?)`, diff: diffText(sp, change.before, change.after) },
      fix: () => applyChanges([change]) });
  }
  const sr = tryState(cwd);
  if (sr) {
    for (const id of existsSync(join(sr, 'runs')) ? readdirSync(join(sr, 'runs')) : []) {
      const lock = join(sr, 'runs', id, 'lock');
      let seen = null; try { seen = readFileSync(lock, 'utf8'); } catch { /* no lock */ }
      let pid = null; try { pid = JSON.parse(seen).pid; } catch { /* unreadable lock: its owner is unknown, treat as stale */ }
      if (seen !== null && !(pid && pidAlive(pid))) {
        out.push({ check: { name: `lock:${id}`, status: 'error', detail: `stale run lock (pid ${pid ?? '?'} is not running)` }, fix: () => reclaimLock(lock, seen) });
      }
    }
    const modes = join(sr, 'memory', 'modes');
    for (const f of existsSync(modes) ? readdirSync(modes).filter((n) => n.endsWith('.json')) : []) {
      if (readJson(join(modes, f)) === null) out.push({ check: { name: `mode:${f.slice(0, -5)}`, status: 'error', detail: `${join(modes, f)} is not valid JSON` }, fix: () => renameSync(join(modes, f), join(modes, `${f}.broken`)) });
    }
  }
  return out;
}

function stateCheck(cwd) {
  try {
    mkdirSync(homeDir(), { recursive: true }); accessSync(homeDir(), constants.W_OK);
    const sr = tryState(cwd);
    return { name: 'state', status: 'ok', detail: `${homeDir()} writable${sr ? `; run state in ${sr}` : ''}` };
  } catch (e) { return { name: 'state', status: 'error', detail: `${homeDir()} not writable: ${e.message}` }; }
}

async function sessionDiag(cwd) {
  const sr = tryState(cwd);
  let run = null; try { run = loadRun(cwd); } catch { /* not a repo */ }
  const latest = sr && readJson(join(sr, 'team', 'latest.json'));
  const team = latest && readJson(join(sr, 'team', latest.id, 'team.json'));
  const gates = [];
  if (sr && existsSync(join(sr, 'merge-readiness'))) {
    for (const f of readdirSync(join(sr, 'merge-readiness')).filter((n) => n.endsWith('.json'))) { const g = readJson(join(sr, 'merge-readiness', f)); if (g?.active) gates.push({ file: f, phase: g.phase }); }
  }
  const root = tryRoot(cwd);
  // Entries written by older versions or hand edits may lack a string cwd or not be objects: skip and count them.
  const all = readTrace(), trace = all.filter((e) => e && typeof e === 'object' && !Array.isArray(e) && (e.cwd === undefined || typeof e.cwd === 'string'));
  return {
    run: run ? { id: run.state.runId, state: run.state.state, active: !TERMINAL.includes(run.state.state) } : null,
    loop: readLoop(cwd),
    team: team ? { id: team.id, session: team.session, ended: team.endedAt ?? null } : null,
    freeze: readHome('freeze.json'),
    mergeReadiness: gates,
    hookErrors: trace.filter((e) => e.error && (!root || !e.cwd || e.cwd.startsWith(root))).slice(-10),
    recentHooks: trace.slice(-5).map(({ at, hook, tool, decision }) => ({ at, hook, tool, decision })),
    malformedTraceEntries: all.length - trace.length,
  };
}

const AGENTS = ['claude', 'codex', 'gemini', 'cursor-agent', 'aider', 'opencode'];

async function doctor(args, cwd) {
  if (args[0] === 'session') return sessionDiag(cwd);
  const r = baseDoctor(cwd);
  r.checks.push({ name: 'plugin', status: 'ok', detail: `make-it-ship ${pluginVersion()} at ${PLUGIN_ROOT} (${installKind().kind} install)` });
  r.checks.push(hooksCheck());
  r.checks.push(await mcpTools());
  const sl = readJson(join(claudeDir(), 'settings.json'))?.statusLine?.command;
  r.checks.push({ name: 'statusLine', status: isOurStatusLine(sl) ? 'ok' : 'warn', detail: !sl ? 'not set (mis setup)' : isOurStatusLine(sl) ? sl : `another status line is set: ${sl} (mis setup chains it after ours)` });
  r.checks.push(stateCheck(cwd));
  const agents = AGENTS.filter(onPath); // PATH presence only: never run another model's CLI
  r.checks.push({ name: 'coding-agents', status: 'ok', detail: agents.length ? `on PATH: ${agents.join(', ')}` : 'none on PATH' });
  const put = (c) => { const i = r.checks.findIndex((x) => x.name === c.name); if (i >= 0) r.checks[i] = c; else r.checks.push(c); };
  let broken = fixables(cwd);
  if (args.includes('--fix')) {
    r.fixed = broken.map((b) => { b.fix(); return b.check.name; });
    broken = fixables(cwd);
    for (const n of r.fixed) put({ name: n, status: 'ok', detail: 'repaired' });
  }
  for (const b of broken) put(b.check);
  r.ok = !r.checks.some((c) => c.status === 'error');
  if (broken.length && !args.includes('--fix')) r.next = 'mis doctor --fix repairs the items marked fixable (the guard asks first)';
  return r;
}

// ---------------------------------------------------------------- mcp-setup

function mcpSetup([sub, name, ...rest], cwd) {
  const root = tryRoot(cwd);
  const reg = mcpRegistrations(root);
  const scopesOf = (n) => ['user', 'local', 'project'].filter((s) => reg[s].includes(n));
  if (sub === 'list' || sub === undefined) {
    return { servers: Object.entries(KNOWN_MCP).map(([n, s]) => ({ name: n, about: s.about, env: s.env ?? [], registered: scopesOf(n) })),
      other: [...new Set([...reg.user, ...reg.local, ...reg.project])].filter((n) => !KNOWN_MCP[n]) };
  }
  if (sub !== 'add' || !KNOWN_MCP[name]) fail(`usage: mis mcp-setup list | add <${Object.keys(KNOWN_MCP).join('|')}> [--scope user|local|project] [--dir <path>] [--write]`);
  const s = KNOWN_MCP[name];
  const i = rest.indexOf('--scope'), scope = i >= 0 ? rest[i + 1] : 'user';
  if (!['user', 'local', 'project'].includes(scope)) fail('--scope must be user, local or project');
  const d = rest.indexOf('--dir'), dir = resolve(cwd, d >= 0 ? rest[d + 1] : root ?? cwd);
  const missing = (s.env ?? []).filter((k) => !process.env[k]);
  const envArgs = (mask) => (s.env ?? []).flatMap((k) => ['-e', `${k}=${mask ? `$${k}` : process.env[k]}`]);
  const tail = [name, ...s.args.map((a) => (a === '<dir>' ? dir : a))];
  const shown = ['claude', 'mcp', 'add', '--scope', scope, ...envArgs(true), ...tail];
  if (!rest.includes('--write')) {
    return { argv: shown, ran: false, registered: scopesOf(name), missingEnv: missing,
      next: missing.length ? `set ${missing.join(', ')} in the environment, then mis mcp-setup add ${name} --write` : `mis mcp-setup add ${name} --write runs it (the guard asks first)` };
  }
  if (missing.length) fail(`${name} needs ${missing.join(', ')} in the environment (not set); nothing was run`);
  const r = spawnSync('claude', ['mcp', 'add', '--scope', scope, ...envArgs(false), ...tail], { encoding: 'utf8', cwd: root ?? cwd });
  if (r.error || r.status !== 0) fail(`claude mcp add failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return { argv: shown, ran: true, next: 'restart Claude Code to load the server' };
}

// ---------------------------------------------------------------- config, version

const validRegex = (v) => { try { new RegExp(v); return true; } catch { return false; } };
const bool = (v) => typeof v === 'boolean';
/**
 * Keys of ~/.make-it-ship/config.json: validator, one-line doc, and `sensitive` when the value is a command Make It Ship
 * runs or a URL it contacts (the guard asks before `mis config set` of those; policy.mjs NON_SENSITIVE_CONFIG lists the
 * rest). Groups adding a setting, or a hook reading a new key, register it here.
 */
export const CONFIG_KEYS = {
  'style.default': { check: (v) => ['off', 'lite', 'full', 'ultra'].includes(v), doc: 'coding style level new sessions start with (off|lite|full|ultra; default full)' },
  'keywords.disabled': { check: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'), doc: 'prompt keywords that never trigger (names from mis help keywords)' },
  subagentMatcher: { check: (v) => v === null || (typeof v === 'string' && validRegex(v)), doc: 'regex of subagent types that receive the style rules (null: all)' },
  'statusLine.preset': { check: (v) => v === null || v === 'custom' || isPreset(v), doc: `status line preset (${Object.keys(PRESETS).join('|')}|custom; default ${DEFAULT_PRESET}; mis hud lists the parts)` },
  'statusLine.add': { check: (v) => v === null || (Array.isArray(v) && v.every((k) => isItem(k) && k !== 'br')), doc: 'status line parts shown on top of the preset (mis hud add)' },
  'statusLine.remove': { check: (v) => v === null || (Array.isArray(v) && v.every((k) => isItem(k) && k !== 'br')), doc: 'preset parts the status line leaves out (mis hud remove)' },
  'statusLine.items': { check: (v) => v === null || (Array.isArray(v) && v.every(isItem)), doc: 'status line parts in order, br for a new row, used with preset custom (mis hud set)' },
  'statusLine.chain': { check: (v) => v === null || typeof v === 'string', sensitive: true, doc: 'shell command of your previous status line; the status line runs it on every refresh' },
  'update.check': { check: bool, doc: 'daily update check at session start (default true)' },
  'update.source': { check: (v) => v === null || typeof v === 'string', sensitive: true, doc: 'URL or file the update check reads the latest version from' },
  'maintenance.retainDays': { check: (v) => Number.isInteger(v) && v >= 0, doc: 'days finished run state is kept before the daily cleanup deletes it' },
  'telemetry.enabled': { check: bool, doc: 'record usage events to a local JSONL file (M9-D; default false, nothing is uploaded)' },
  'telemetry.endpoint': { check: (v) => v === null || (typeof v === 'string' && /^https?:\/\//.test(v)), sensitive: true, doc: 'URL that mis telemetry sync uploads events to' },
  'simplifier.enabled': { check: bool, doc: 'Stop hook asks for a code-simplifier pass once per set of edited source files (default false)' },
  'simplifier.maxFiles': { check: (v) => Number.isInteger(v) && v >= 1, doc: 'most recent edited files handed to the simplifier (default 10)' },
  'memory.observe': { check: bool, doc: 'record one local observation per tool use for mis memory and memory_search (default true; secrets masked, never uploaded)' },
  'memory.summarize': { check: bool, sensitive: true, doc: 'at the end of each turn run claude -p (no tools) to summarize the turn into memories, like claude-mem; costs model tokens (default true)' },
  'memory.model': { check: (v) => v === null || (typeof v === 'string' && /^[\w.-]+$/.test(v)), sensitive: true, doc: 'model of the memory summarizer (default claude-haiku-4-5)' },
  'memory.importClaudeMem': { check: bool, doc: 'import this project\'s ~/.claude-mem history once, in the background, at session start (default true; read-only)' },
  'memory.context': { check: bool, doc: 'session start shows recent memories in claude-mem layout (default true; not on resume)' },
  'memory.contextObservations': { check: (v) => Number.isInteger(v) && v >= 1, doc: 'memories shown at session start (default 50)' },
  'memory.contextMaxChars': { check: (v) => Number.isInteger(v) && v >= 500, doc: 'size budget of the session-start memory block (default 6000)' },
  proactive: { check: bool, doc: 'session start asks for a one-line next-skill suggestion when a piece of work ends (default true)' },
};

function config([sub, key, raw]) {
  if (sub === 'get' || sub === undefined) {
    const c = globalConfig();
    if (!key) return { config: c, keys: Object.keys(CONFIG_KEYS), docs: Object.fromEntries(Object.entries(CONFIG_KEYS).map(([k, s]) => [k, `${s.doc}${s.sensitive ? ' (setting it asks first)' : ''}`])) };
    if (!CONFIG_KEYS[key]) fail(`unknown key ${key} (known: ${Object.keys(CONFIG_KEYS).join(', ')})`);
    return { key, value: key.split('.').reduce((o, k) => o?.[k], c) ?? null };
  }
  if (sub !== 'set' || !key || raw === undefined) fail('usage: mis config get [key] | set <key> <value>');
  if (!CONFIG_KEYS[key]) fail(`unknown key ${key} (known: ${Object.keys(CONFIG_KEYS).join(', ')})`);
  let v; try { v = JSON.parse(raw); } catch { v = raw; }
  if (!CONFIG_KEYS[key].check(v)) fail(`invalid value for ${key}: ${raw}`);
  const c = readHome('config.json', {}) ?? {};
  const parts = key.split('.');
  let o = c;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
  o[parts.at(-1)] = v;
  writeHome('config.json', c);
  return { key, value: v };
}

function version() {
  let commit = null;
  const g = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
  if (g.status === 0 && existsSync(join(PLUGIN_ROOT, '.git'))) commit = g.stdout.trim();
  else {
    const ip = readJson(join(claudeDir(), 'plugins', 'installed_plugins.json'));
    commit = Object.values(ip?.plugins ?? {}).flat().find((e) => e.installPath === PLUGIN_ROOT)?.gitCommitSha ?? null;
  }
  return { name: 'make-it-ship', version: pluginVersion(), node: process.versions.node, commit, root: PLUGIN_ROOT, install: installKind().kind };
}

// ---------------------------------------------------------------- update, upgrade, uninstall

const updateCheckCmd = (args) => updateCheck({ force: args.includes('--force') });

function upgrade(args) {
  const cmds = upgradeCommands();
  if (!cmds.length) fail('cannot tell how this copy was installed (not a marketplace install or a git checkout); update it the way you installed it');
  if (!args.includes('--yes')) return { commands: cmds.map((c) => c.join(' ')), ran: false, next: 'mis upgrade --yes runs these (the guard asks first); restart Claude Code afterwards' };
  const results = cmds.map((c) => {
    const r = spawnSync(c[0], c.slice(1), { encoding: 'utf8' });
    return { command: c.join(' '), exit: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-2000) };
  });
  try { writeHome('update-check.json', null); } catch { /* cache only */ }
  if (results.some((r) => r.exit !== 0)) fail(`upgrade failed: ${JSON.stringify(results)}`);
  return { ran: true, results, next: 'restart Claude Code to load the new version, then mis setup to check the status line path' };
}

/** Refuse to delete a home that is $HOME, /, or contains the working directory. */
function safeHome(cwd) {
  const h = homeDir();
  if (!existsSync(h)) return null;
  const real = realpathSync(h), cw = realpathSync(cwd);
  if (real === sep || real === realpathSync(homedir()) || (cw + sep).startsWith(real + sep)) fail(`refusing to delete ${real}: it is $HOME, / or contains the working directory`);
  return real;
}

/** The project CLAUDE.md "## Skill routing" section (mis setup routing) is the user's file: uninstall names it, never edits it. */
function routingNote(cwd) {
  const f = join(tryRoot(cwd) ?? cwd, 'CLAUDE.md');
  return existsSync(f) && /^## Skill routing[ \t]*$/m.test(readFileSync(f, 'utf8')) ? `${f} has a "## Skill routing" section (mis setup routing); it is left in place, remove it yourself if you no longer want it` : undefined;
}

async function uninstall(args, cwd) {
  const purgeRuns = args.includes('--purge-runs');
  const remove = [], keep = [], changes = [], processes = [];
  const home = safeHome(cwd);
  if (home) remove.push(home);
  const sp = join(claudeDir(), 'settings.json'), s = readJson(sp);
  if (isOurStatusLine(s?.statusLine?.command)) {
    const { statusLine, ...rest } = s;
    const chain = globalConfig().statusLine?.chain;
    changes.push({ file: sp, before: readFileSync(sp, 'utf8'), after: JSON.stringify(chain ? { ...rest, statusLine: { ...statusLine, command: chain } } : rest, null, 2) + '\n' });
  }
  const mp = join(claudeDir(), 'CLAUDE.md'), md = existsSync(mp) ? readFileSync(mp, 'utf8') : null;
  if (md && /<!-- MIS:START -->/.test(md)) changes.push({ file: mp, before: md, after: md.replace(/<!-- MIS:START -->[\s\S]*?<!-- MIS:END -->\n*/, '') });
  const sr = tryState(cwd);
  const { browseDir, stop } = await import('./browse/client.mjs');
  for (const d of [...new Set([browseDir(cwd), join(homeDir(), 'browse')])]) {
    const st = readJson(join(d, 'state.json'));
    if (st?.pid && pidAlive(st.pid)) processes.push({ kind: 'browse', pid: st.pid, dir: d });
  }
  const latest = sr && readJson(join(sr, 'team', 'latest.json'));
  const team = latest && readJson(join(sr, 'team', latest.id, 'team.json'));
  if (team && !team.endedAt) processes.push({ kind: 'team', id: team.id, session: team.session });
  if (sr && existsSync(sr)) (purgeRuns ? remove : keep).push(sr);
  const plan = { remove, settings: changes.map(({ file, before, after }) => ({ file, diff: diffText(file, before, after) })), processes, keep,
    keepNote: keep.length ? 'run records (.git/make-it-ship) are kept; add --purge-runs to delete them' : undefined,
    routingNote: routingNote(cwd) };
  if (!args.includes('--yes')) return { dryRun: true, ...plan, next: 'mis uninstall --yes removes the above (the guard asks first); then claude plugin uninstall make-it-ship' };
  for (const p of processes) {
    if (p.kind === 'browse') await stop(p.dir).catch(() => {});
    else try { await (await import('./commands-team.mjs')).teamCommands.team(['shutdown', '--team', p.id], cwd); } catch { /* already gone */ }
  }
  const backups = applyChanges(changes);
  for (const p of remove) rmSync(p, { recursive: true, force: true });
  const k = installKind();
  return { dryRun: false, ...plan, backups, next: `finish with: claude plugin uninstall make-it-ship${k.marketplace ? `@${k.marketplace}` : ''} (or remove --plugin-dir)` };
}

// ---------------------------------------------------------------- launch, cancel --all

const tmuxArgs = (a) => (process.env.MIS_TMUX_SOCKET ? ['-L', process.env.MIS_TMUX_SOCKET, ...a] : a);

async function launch(args, cwd) {
  if (spawnSync('tmux', ['-V']).error) fail('BLOCKED: tmux is not installed (command -v tmux failed); start claude directly instead');
  const { SESSION_VARS } = await import('./commands-team.mjs');
  const name = `mis-${basename(tryRoot(cwd) ?? cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(2).toString('hex')}`;
  // The new Claude Code must be its own session, not a child of the one that ran this command.
  const unset = Object.keys(process.env).filter((k) => SESSION_VARS.test(k)).flatMap((k) => ['-u', k]);
  const r = spawnSync('tmux', tmuxArgs(['new-session', '-d', '-s', name, '-c', cwd, 'env', ...unset, 'claude', ...args]), { encoding: 'utf8' });
  if (r.status !== 0) fail(`tmux new-session failed: ${(r.stderr || '').trim()}`);
  return { session: name, cwd, attach: `tmux ${process.env.MIS_TMUX_SOCKET ? `-L ${process.env.MIS_TMUX_SOCKET} ` : ''}attach -t ${name}` };
}

/** mis cancel --all [--run]: loop, team, merge-readiness gates of this worktree; the run only with --run. */
export async function cancelAll(args, cwd, cancelRun) {
  const out = { loop: false, team: null, mergeReadiness: [], run: null };
  if (readLoop(cwd).active) { endLoop(cwd, 'cancelled'); out.loop = true; }
  const sr = tryState(cwd);
  if (sr) {
    const latest = readJson(join(sr, 'team', 'latest.json'));
    const team = latest && readJson(join(sr, 'team', latest.id, 'team.json'));
    if (team && !team.endedAt) {
      try { out.team = await (await import('./commands-team.mjs')).teamCommands.team(['shutdown', '--team', team.id], cwd); } catch (e) { out.team = { id: team.id, error: e.message }; }
    }
    const mr = await import('./merge-readiness.mjs');
    const key = mr.worktreeKey(cwd), d = join(sr, 'merge-readiness');
    for (const f of existsSync(d) ? readdirSync(d).filter((n) => n.startsWith(`${key}-`) && n.endsWith('.json')) : []) {
      const sessionId = f.slice(key.length + 1, -5);
      if (mr.cancelGate(cwd, { sessionId })) out.mergeReadiness.push(sessionId);
    }
  }
  if (args.includes('--run')) {
    let run = null; try { run = loadRun(cwd); } catch { /* not a repo */ }
    out.run = run && !TERMINAL.includes(run.state.state) ? cancelRun(cwd) : { state: run?.state.state ?? null, note: 'no active run' };
  } else {
    let run = null; try { run = loadRun(cwd); } catch { /* not a repo */ }
    if (run && !TERMINAL.includes(run.state.state)) out.runKept = `${run.state.runId} (${run.state.state}); add --run to cancel it too`;
  }
  return out;
}

export const setupCommands = { setup, doctor, 'mcp-setup': mcpSetup, config, version, 'update-check': updateCheckCmd, upgrade, uninstall, launch };
