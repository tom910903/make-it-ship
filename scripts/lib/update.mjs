// M9-A update check (absorbs OMC session-start update check, gstack-update-check/upgrade/session-update) and
// SessionStart maintenance (OMC setup-maintenance). Read-only check against the plugin's own source:
// a marketplace clone already on disk, or the git remote of a git checkout. Nothing about the user's repository is sent.
// Fail-open: any error is cached as "no update" and printed nowhere.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { claudeDir, globalConfig, readHome, writeHome } from './home.mjs';
import { applyChanges, cacheInstall, misBlock, MIS_RE, PLUGIN_ROOT, statusLineCommand } from './install.mjs';

export const CACHE_MS = 24 * 3600 * 1000;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export const pluginVersion = () => readJson(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))?.version ?? null;

export function semverCmp(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** How this copy was installed: managed marketplace cache, git checkout, or unknown. */
export function installKind(root = PLUGIN_ROOT) {
  const cache = join(claudeDir(), 'plugins', 'cache') + sep;
  if ((root + sep).startsWith(cache)) {
    const [marketplace, name] = relative(cache, root).split(sep);
    return { kind: 'marketplace', marketplace, name };
  }
  if (existsSync(join(root, '.git'))) return { kind: 'git' };
  return { kind: 'unknown' };
}

const git = (args, timeout = 10000) => spawnSync('git', args, { cwd: PLUGIN_ROOT, encoding: 'utf8', timeout, killSignal: 'SIGKILL',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=5' } });

async function readSource(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  return readFileSync(src, 'utf8');
}
const versionOf = (text) => { try { return JSON.parse(text).version ?? null; } catch { return text.trim().split('\n')[0] || null; } };

/** One fresh look at the update source. @returns {{current, latest, updateAvailable, source}} */
async function lookup() {
  const current = pluginVersion();
  const src = process.env.MIS_UPDATE_SOURCE || globalConfig().update?.source;
  if (src) {
    const latest = versionOf(await readSource(src));
    return { current, latest, updateAvailable: !!latest && semverCmp(latest, current) > 0, source: src };
  }
  const k = installKind();
  if (k.kind === 'marketplace') {
    // The marketplace clone Claude Code keeps on disk (refreshed by `claude plugin marketplace update`); no network here.
    const mroot = join(claudeDir(), 'plugins', 'marketplaces', k.marketplace);
    const entry = readJson(join(mroot, '.claude-plugin', 'marketplace.json'))?.plugins?.find((p) => p.name === k.name);
    const local = typeof entry?.source === 'string' ? resolve(mroot, entry.source) : null;
    const latest = (local && readJson(join(local, '.claude-plugin', 'plugin.json'))?.version) ?? entry?.version ?? null;
    return { current, latest, updateAvailable: !!latest && semverCmp(latest, current) > 0, source: `marketplace ${k.marketplace}` };
  }
  if (k.kind === 'git') {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    const remote = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
    if (remote.status !== 0) throw new Error(`git ls-remote failed: ${(remote.stderr || remote.error?.message || '').trim()}`);
    const sha = remote.stdout.split(/\s/)[0];
    const head = git(['rev-parse', 'HEAD']).stdout.trim();
    // New upstream commits = the remote tip is a commit this checkout does not have yet.
    const known = !sha || sha === head || git(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
    return { current: `${current} (${head.slice(0, 7)})`, latest: `origin/${branch} ${sha.slice(0, 7)}`, updateAvailable: !known, source: 'git origin' };
  }
  return { current, latest: null, updateAvailable: false, source: 'unknown install (no update source)' };
}

/** Cached update check: one lookup per 24h unless force. Errors are cached as "no update". */
export async function updateCheck({ force = false, now = Date.now() } = {}) {
  if (globalConfig().update?.check === false) return { disabled: true };
  const c = readHome('update-check.json');
  if (!force && c && now - Date.parse(c.checkedAt) < CACHE_MS && c.current?.startsWith(pluginVersion() ?? '')) return { ...c, cached: true };
  let r;
  try { r = await lookup(); } catch (e) { r = { current: pluginVersion(), latest: null, updateAvailable: false, error: e.message }; }
  const rec = { ...r, checkedAt: new Date(now).toISOString() };
  try { writeHome('update-check.json', rec); } catch { /* unwritable home: just don't cache */ }
  return { ...rec, cached: false };
}

/**
 * SessionStart: read the cache only (never waits on the network). When the cache is stale and this is a real plugin
 * install (or a test source is set), refresh it in a detached child; the notice shows from the next session on.
 */
export function updateNotice() {
  if (globalConfig().update?.check === false) return null;
  const c = readHome('update-check.json');
  const fresh = c && Date.now() - Date.parse(c.checkedAt) < CACHE_MS;
  if (!fresh && (process.env.MIS_UPDATE_SOURCE || installKind().kind === 'marketplace' || (process.env.CLAUDE_PLUGIN_ROOT === PLUGIN_ROOT && installKind().kind === 'git'))) {
    const child = spawn(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'mis.mjs'), 'update-check'], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  if (!c?.updateAvailable || !c.current?.startsWith(pluginVersion() ?? '')) return null;
  return `Make It Ship ${c.latest} is available (installed ${c.current}). Mention it once; the user can run \`mis upgrade\` to see the update command (it asks before running).`;
}

/**
 * SessionStart after Claude Code updated the plugin: the status line and the CLAUDE.md block still name an older version
 * folder of this same install, which goes away once no session uses it. Point them at this version (backups kept).
 * Only our own entries, only to a newer version (a session still running an old one never moves them back).
 */
export function followUpgrade(root = PLUGIN_ROOT) {
  const me = cacheInstall(root);
  if (!me) return null;
  const older = (text) => [...String(text ?? '').matchAll(/plugins\/cache\/([^/"]+)\/([^/"]+)\/([^/"]+)\/scripts\/(?:statusline|mis)\.mjs/g)]
    .some(([, mp, name, v]) => mp === me.marketplace && name === me.name && v !== me.version && semverCmp(me.version, v) > 0);
  const changes = [];
  const sp = join(claudeDir(), 'settings.json'), mp = join(claudeDir(), 'CLAUDE.md');
  const sText = existsSync(sp) ? readFileSync(sp, 'utf8') : null;
  let s = null; try { s = JSON.parse(sText); } catch { /* unreadable settings: leave them to mis doctor */ }
  if (s && older(s.statusLine?.command)) changes.push({ file: sp, before: sText, after: JSON.stringify({ ...s, statusLine: { ...s.statusLine, command: statusLineCommand(root) } }, null, 2) + '\n' });
  const mText = existsSync(mp) ? readFileSync(mp, 'utf8') : null;
  const block = mText?.match(MIS_RE)?.[0];
  if (block && older(block)) changes.push({ file: mp, before: mText, after: mText.replace(MIS_RE, misBlock(root)) });
  if (!changes.length) return null;
  const backups = applyChanges(changes);
  return `Make It Ship was updated to ${me.version}: ${changes.map((c) => c.file).join(' and ')} now point at it (backups: ${backups.join(', ')}). `
    + `The CLI is now \`node "${join(root, 'scripts', 'mis.mjs')}"\`. Mention this once.`;
}

/** Commands that update the installed plugin (shown by `mis upgrade`, run with --yes). */
export function upgradeCommands() {
  const k = installKind();
  if (k.kind === 'marketplace') return [['claude', 'plugin', 'marketplace', 'update', k.marketplace], ['claude', 'plugin', 'update', `${k.name}@${k.marketplace}`]];
  if (k.kind === 'git') return [['git', '-C', PLUGIN_ROOT, 'pull', '--ff-only']];
  return [];
}

// ---------------------------------------------------------------- maintenance (SessionStart, at most once a day)

export const DEFAULT_RETAIN_DAYS = 90;
const TERMINAL = ['REPORTED', 'BLOCKED', 'CANCELLED'];
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const olderThan = (p, ms, now) => { try { return now - statSync(p).mtimeMs > ms; } catch { return false; } };
const dirs = (d) => { try { return readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()); } catch { return []; } };

/**
 * Remove finished state older than retainDays under <git-common-dir>/make-it-ship: terminal runs (never the current
 * one), ended teams, browse dirs whose daemon is gone. Active runs, loops and unreadable runs are kept.
 */
export function pruneState(stateRoot, { retainDays = DEFAULT_RETAIN_DAYS, now = Date.now() } = {}) {
  const removed = [];
  if (!retainDays || !existsSync(stateRoot)) return removed;
  const ms = retainDays * 864e5;
  const current = existsSync(join(stateRoot, 'current')) ? readFileSync(join(stateRoot, 'current'), 'utf8').trim() : null;
  const rm = (p) => { rmSync(p, { recursive: true, force: true }); removed.push(p); };
  for (const id of dirs(join(stateRoot, 'runs'))) {
    const f = join(stateRoot, 'runs', id, 'state.json');
    const s = readJson(f);
    if (id !== current && s && TERMINAL.includes(s.state) && olderThan(f, ms, now)) rm(join(stateRoot, 'runs', id));
  }
  for (const id of dirs(join(stateRoot, 'team'))) {
    const f = join(stateRoot, 'team', id, 'team.json');
    if (readJson(f)?.endedAt && olderThan(f, ms, now)) rm(join(stateRoot, 'team', id));
  }
  for (const id of dirs(join(stateRoot, 'browse'))) {
    const d = join(stateRoot, 'browse', id), s = readJson(join(d, 'state.json'));
    if (!alive(s?.pid) && olderThan(d, ms, now)) rm(d);
  }
  return removed;
}

/** Once a day per state root. Returns removed paths (empty when throttled or disabled). */
export function dailyMaintenance(stateRoot, now = Date.now()) {
  const days = globalConfig().maintenance?.retainDays ?? DEFAULT_RETAIN_DAYS;
  const stamps = readHome('maintenance.json', {}) ?? {};
  const day = new Date(now).toISOString().slice(0, 10);
  if (stamps[stateRoot] === day) return [];
  writeHome('maintenance.json', { ...stamps, [stateRoot]: day });
  return pruneState(stateRoot, { retainDays: days, now });
}

