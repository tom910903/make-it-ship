// M9-D D3: deploy and operations (absorbs gstack canary, setup-deploy, land-and-deploy, landing-report, gstack-detach;
// OMC `omc wait`, `omc mission-board`). Deploy commands and canary always ask (policy.mjs APPROVAL_MIS); the reports
// (landing-report, mission-board) are read-only snapshots that write nothing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fail, flag, bool, projectDir, rootOf, readJson, writeJson, stamp, slug, duration } from './cli-util.mjs';
import { browseDir, send } from './browse/client.mjs';
import { stateRoot, loadRun } from './state.mjs';
import { loadRuns } from './retro.mjs';
import { readLoop } from './loop.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const gitOut = (cwd, ...a) => { const r = git(cwd, ...a); return r.status === 0 ? r.stdout.trim() : null; };

// ---------------------------------------------------------------- canary

/** One canary pass over the pages: HTTP status of the document and console errors, through the built-in browser. */
async function probePage(cwd, url) {
  const dir = browseDir(cwd), at = new Date().toISOString();
  try {
    await send(dir, { cmd: 'console', args: ['--clear'], cwd });
    const nav = await send(dir, { cmd: 'goto', args: [url], cwd });
    const status = Number(/\((\d{3})\)\s*$/.exec(String(nav))?.[1] ?? NaN);
    const errs = String(await send(dir, { cmd: 'console', args: ['--errors'], cwd }));
    const errors = errs.startsWith('(no console') ? [] : errs.split('\n').filter(Boolean);
    return { url, at, status: Number.isNaN(status) ? null : status, consoleErrors: errors.length, errors: errors.slice(0, 5) };
  } catch (e) {
    if (/BLOCKED/.test(e.message)) throw e;
    return { url, at, status: null, consoleErrors: null, error: e.message };
  }
}

/** Alerts compare with the baseline and must persist across 2 consecutive checks (one check: alert at once). */
export function canaryAlerts(checks, baseline = {}) {
  const alerts = [];
  const pages = [...new Set(checks.flat().map((p) => p.url))];
  for (const url of pages) {
    const series = checks.map((c) => c.find((p) => p.url === url)).filter(Boolean);
    const base = baseline[url];
    const bad = (p) => (p.status === null || p.status >= 400 ? 'CRITICAL' : p.consoleErrors > (base?.consoleErrors ?? 0) ? 'HIGH' : null);
    const need = series.length > 1 ? 2 : 1;
    for (const level of ['CRITICAL', 'HIGH']) {
      let run = 0, hit = null;
      for (const p of series) { run = bad(p) === level ? run + 1 : 0; if (run >= need) hit = p; }
      if (hit) { alerts.push({ level, url, detail: level === 'CRITICAL' ? `page failed to load (${hit.status ?? hit.error})` : `${hit.consoleErrors} console errors (baseline ${base?.consoleErrors ?? 0})` }); break; }
    }
  }
  return alerts;
}

/** mis canary <url> [--pages /,/a] [--checks 3] [--interval 60s] [--baseline] */
async function canary(argv, cwd) {
  const args = [...argv];
  const pages = (flag(args, '--pages') ?? '/').split(',').filter(Boolean), checks = Number(flag(args, '--checks') ?? 3);
  const interval = duration(flag(args, '--interval') ?? '60s', '--interval'), isBaseline = bool(args, '--baseline');
  const [url] = args;
  if (!url || !/^https?:\/\//.test(url) || !Number.isInteger(checks) || checks < 1 || checks > 60) fail('usage: mis canary <http(s)://url> [--pages /,/dashboard] [--checks 1-60] [--interval 60s] [--baseline]');
  const urls = pages.map((p) => new URL(p, url).href);
  const dir = projectDir(cwd, 'canary');
  if (isBaseline) {
    const snap = [];
    for (const u of urls) snap.push(await probePage(cwd, u)); // one tab: pages one after another
    const baseline = { url, at: new Date().toISOString(), branch: gitOut(cwd, 'branch', '--show-current'), pages: Object.fromEntries(snap.map((p) => [p.url, p])) };
    writeJson(join(dir, 'baseline.json'), baseline);
    return { baseline: join(dir, 'baseline.json'), pages: snap, next: `Deploy, then run mis canary ${url}` };
  }
  const baseline = readJson(join(dir, 'baseline.json'))?.pages ?? {};
  const results = [];
  for (let i = 0; i < checks; i++) {
    if (i) await sleep(interval);
    const pass = [];
    for (const u of urls) pass.push(await probePage(cwd, u));
    results.push(pass);
  }
  const alerts = canaryAlerts(results, baseline);
  const report = { url, checks: results.length, baseline: Object.keys(baseline).length ? 'baseline.json' : 'none (alerts use 0 console errors and HTTP < 400)', status: alerts.length ? 'ALERT' : 'HEALTHY', alerts, results };
  const file = join(dir, `report-${stamp()}.json`);
  writeJson(file, report);
  if (alerts.length) process.exitCode = 1;
  return { ...report, report: file };
}

// ---------------------------------------------------------------- deploy: setup, run, status

const PLATFORM_FILES = [['fly', 'fly.toml'], ['render', 'render.yaml'], ['vercel', 'vercel.json'], ['vercel', '.vercel'], ['netlify', 'netlify.toml'], ['heroku', 'Procfile'], ['railway', 'railway.json'], ['railway', 'railway.toml']];
export function detectPlatform(root) {
  const found = PLATFORM_FILES.filter(([, f]) => existsSync(join(root, f))).map(([p]) => p);
  const wf = join(root, '.github', 'workflows');
  const workflows = existsSync(wf) ? readdirSync(wf).filter((f) => /\.ya?ml$/.test(f) && /deploy|release|production|staging/i.test(readFileSync(join(wf, f), 'utf8'))).map((f) => `.github/workflows/${f}`) : [];
  return { platform: found[0] ?? (workflows.length ? 'github-actions' : null), candidates: [...new Set(found)], workflows };
}
const deployFile = (cwd) => join(projectDir(cwd), 'deploy.json');
const FIELDS = { '--platform': 'platform', '--url': 'url', '--merge-cmd': 'mergeCmd', '--deploy-cmd': 'deployCmd', '--status-cmd': 'statusCmd', '--health': 'healthUrl' };

function deploy([sub, ...argv], cwd) {
  const args = [...argv], root = rootOf(cwd);
  if (sub === 'status') return { config: readJson(deployFile(cwd)), file: deployFile(cwd) };
  if (sub === 'setup') {
    const write = bool(args, '--write');
    const detected = detectPlatform(root);
    const config = { platform: detected.platform, ...readJson(deployFile(cwd), {}) };
    for (const [f, k] of Object.entries(FIELDS)) { const v = flag(args, f); if (v !== undefined) config[k] = v; }
    if (config.healthUrl && !/^https?:\/\//.test(config.healthUrl)) fail('--health must be an http(s) URL');
    if (!write) return { config, detected, write: false, next: 'Confirm each field with the user, then rerun with --write (the guard asks).' };
    if (!config.deployCmd && !config.mergeCmd) fail('set at least --deploy-cmd or --merge-cmd before --write');
    writeJson(deployFile(cwd), { ...config, configuredAt: new Date().toISOString() });
    return { written: deployFile(cwd), config };
  }
  if (sub === 'run') return deployRun(args, cwd);
  return fail('usage: mis deploy setup [--platform p] [--url u] [--merge-cmd c] [--deploy-cmd c] [--status-cmd c] [--health url] [--write] | run [--dry-run] [--health-tries N] | status');
}

async function deployRun(args, cwd) {
  const root = rootOf(cwd), dry = bool(args, '--dry-run'), tries = Number(flag(args, '--health-tries') ?? 5), wait = duration(flag(args, '--health-interval') ?? '10s');
  const c = readJson(deployFile(cwd));
  if (!c) fail('no deploy configuration (mis deploy setup, then --write)');
  const plan = [['merge', c.mergeCmd], ['deploy', c.deployCmd], ['status', c.statusCmd]].filter(([, cmd]) => cmd);
  if (dry) return { dryRun: true, steps: plan.map(([step, cmd]) => ({ step, cmd })), health: c.healthUrl ?? null };
  if (gitOut(root, 'status', '--porcelain', '--', '.', ':(exclude).make-it-ship')) fail('the working tree has uncommitted changes; commit or stash them before deploying');
  const run = loadRun(cwd);
  const steps = [];
  let failed = null;
  for (const [step, cmd] of plan) {
    // shortcut: the 30-min timeout kills `sh` only, not processes it started; upgrade with a process-group kill if steps hang.
    const t0 = Date.now(), r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: 30 * 60000 });
    steps.push({ step, cmd, exit: r.status, ms: Date.now() - t0, output: `${r.stdout}${r.stderr}`.trim().slice(-2000) });
    if (r.status !== 0) { failed = step; break; }
  }
  let health = null;
  if (!failed && c.healthUrl) {
    health = { url: c.healthUrl, attempts: [] };
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(wait);
      let status = null;
      try { status = (await fetch(c.healthUrl, { signal: AbortSignal.timeout(15000), redirect: 'follow' })).status; } catch (e) { status = e.cause?.code ?? e.message; }
      health.attempts.push(status);
      if (typeof status === 'number' && status < 400) { health.ok = true; break; }
    }
    if (!health.ok) { health.ok = false; failed = 'health'; }
  }
  const result = { status: failed ? 'FAILED' : 'DEPLOYED', failedStep: failed, steps, health, run: run ? { id: run.state.runId, state: run.state.state } : null,
    next: failed ? 'Show the user the failing step; offer a revert (git revert + deploy) only with their approval.' : c.url ? `Watch it: mis canary ${c.url} --checks 5` : 'Done.' };
  const file = join(projectDir(cwd, 'deploy'), `deploy-${stamp()}.json`);
  writeJson(file, result);
  if (failed) process.exitCode = 1;
  return { ...result, report: file };
}

// ---------------------------------------------------------------- landing-report (read-only)

const parseV = (v) => (/^\d+(\.\d+){2,3}$/.test(v ?? '') ? v.split('.').map(Number) : null);
const LEVELS = { major: 0, minor: 1, patch: 2, micro: 3 };
/** Next free version at a bump level, skipping versions other open PRs already claim. */
export function nextVersion(base, level, claimed = []) {
  let v = parseV(base);
  if (!v || LEVELS[level] >= v.length) return null;
  const bump = (x) => x.map((n, i) => (i < LEVELS[level] ? n : i === LEVELS[level] ? n + 1 : 0));
  v = bump(v);
  while (claimed.includes(v.join('.'))) v = bump(v);
  return v.join('.');
}

function landingReport(argv, cwd) {
  const args = [...argv], root = rootOf(cwd);
  const base = flag(args, '--base') ?? gitOut(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main';
  const fileV = (dir) => { try { return readFileSync(join(dir, 'VERSION'), 'utf8').trim(); } catch { return null; } };
  const refV = (ref) => gitOut(root, 'show', `${ref}:VERSION`);
  const baseVersion = refV(`origin/${base}`) ?? refV(base) ?? fileV(root);
  let prs = [], online = true, reason = null;
  const gh = spawnSync('gh', ['pr', 'list', '--base', base, '--state', 'open', '--json', 'number,headRefName,url,title'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  if (gh.error || gh.status !== 0) { online = false; reason = gh.error ? 'gh is not installed' : (gh.stderr.trim().split('\n')[0] || `gh exit ${gh.status}`); }
  else prs = JSON.parse(gh.stdout || '[]').map((p) => ({ pr: p.number, branch: p.headRefName, url: p.url, version: refV(`origin/${p.headRefName}`) }));
  const counts = {};
  for (const p of prs) if (p.version) counts[p.version] = (counts[p.version] ?? 0) + 1;
  const now = Date.now() / 1000;
  const worktrees = (gitOut(root, 'worktree', 'list', '--porcelain') ?? '').split('\n\n').filter(Boolean).map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1], branch = /^branch refs\/heads\/(.*)$/m.exec(b)?.[1] ?? null;
    const version = fileV(path), last = Number(gitOut(path, 'log', '-1', '--format=%ct') ?? 0);
    const pr = prs.find((p) => p.branch === branch)?.pr ?? null;
    const ahead = !!(parseV(version) && parseV(baseVersion) && version.localeCompare(baseVersion, undefined, { numeric: true }) > 0);
    return { path, branch, version, lastCommitHoursAgo: last ? Math.round((now - last) / 360) / 10 : null, pr, active: !!(ahead && last && now - last < 86400 && !pr) };
  });
  const claimed = Object.keys(counts);
  return { base, baseVersion, branchVersion: fileV(cwd), status: online ? 'ONLINE' : 'OFFLINE', ...(reason ? { reason } : {}),
    claimed: prs, collisions: Object.entries(counts).filter(([, n]) => n > 1).map(([v]) => v), worktrees,
    next: Object.fromEntries(Object.keys(LEVELS).map((l) => [l, nextVersion(baseVersion, l, claimed)])) };
}

// ---------------------------------------------------------------- mission-board (read-only)

function missionBoard(argv, cwd) {
  const root = rootOf(cwd);
  let runs = [];
  try { runs = loadRuns(stateRoot(cwd)).map(({ state: s }) => ({ id: s.runId, state: s.state, mode: s.mode ?? null, startedAt: s.startedAt, tasks: s.plan?.tasks?.length ?? 0, done: s.plan?.tasks?.filter((t) => t.status === 'done').length ?? 0 })); } catch { /* not a repo */ }
  const current = (() => { try { return loadRun(cwd)?.state.runId ?? null; } catch { return null; } })();
  const worktrees = (gitOut(root, 'worktree', 'list', '--porcelain') ?? '').split('\n\n').filter(Boolean).map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1];
    return { path, branch: /^branch refs\/heads\/(.*)$/m.exec(b)?.[1] ?? null, changes: (gitOut(path, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).length };
  });
  const list = (sub, file) => { const d = join(root, '.make-it-ship', sub); return existsSync(d) ? readdirSync(d).map((x) => readJson(join(d, x, file))).filter(Boolean) : []; };
  const research = list('research', 'state.json').map(({ id, goal, status }) => ({ id, goal, status }));
  const ar = join(root, '.make-it-ship', 'autoresearch');
  const missions = (existsSync(ar) ? readdirSync(ar) : []).map((m) => {
    const id = readJson(join(ar, m, 'current.json'))?.runId, r = id ? readJson(join(ar, m, 'runs', id, 'run.json')) : null;
    return { mission: m, run: r ? { id: r.runId, status: r.status, iteration: r.iteration, deadlineAt: r.deadlineAt } : null };
  });
  let team = null;
  try { const id = readJson(join(stateRoot(cwd), 'team', 'latest.json'))?.id; if (id) { const t = readJson(join(stateRoot(cwd), 'team', id, 'team.json')); team = { id, session: t?.session, workers: t?.workers?.length ?? 0, endedAt: t?.endedAt ?? null }; } } catch { /* none */ }
  let loop = null; try { loop = readLoop(cwd); } catch { /* none */ }
  return { at: new Date().toISOString(), currentRun: current, runs: runs.slice(-10), loop, team, worktrees, research, autoresearch: missions };
}

// ---------------------------------------------------------------- wait, detach

/** mis wait (--until <ISO|HH:MM> | --seconds N) [-- <resume command...>]: sleep, then run the resume command. */
async function wait(argv, cwd) {
  const args = [...argv], i = args.indexOf('--'), cmd = i >= 0 ? args.splice(i).slice(1) : [];
  const until = flag(args, '--until'), secs = flag(args, '--seconds');
  let target;
  if (secs !== undefined) target = Date.now() + Number(secs) * 1000;
  else if (/^\d{1,2}:\d{2}$/.test(until ?? '')) { const [h, m] = until.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); target = d.getTime(); }
  else if (until) target = Date.parse(until);
  if (!Number.isFinite(target)) fail('usage: mis wait (--until <ISO time|HH:MM> | --seconds N) [-- <resume command...>]');
  const ms = Math.max(0, target - Date.now());
  if (ms > 24 * 3600000) fail('mis wait waits at most 24h');
  await sleep(ms);
  if (!cmd.length) return { waitedMs: ms, resumedAt: new Date().toISOString() };
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
  return { waitedMs: ms, resumedAt: new Date().toISOString(), resume: cmd.join(' '), exit: r.status ?? r.error?.message };
}

// The wrapper runs in its own session (setsid via detached), so a SIGTERM to the launcher's process group misses it;
// it always appends an EXIT sentinel so a poller can tell finished from died.
const WRAPPER = `
const { spawn } = require('node:child_process'); const fs = require('node:fs');
const [log, timeoutMs, ...cmd] = JSON.parse(process.argv[1]);
const fd = fs.openSync(log, 'a');
const c = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', fd, fd] });
const t = timeoutMs > 0 ? setTimeout(() => { fs.appendFileSync(log, '\\n### mis-detach TIMEOUT ###\\n'); c.kill('SIGKILL'); }, timeoutMs) : null;
process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
c.on('error', (e) => { fs.appendFileSync(log, '\\n' + e.message + '\\n### mis-detach EXIT=127 ###\\n'); process.exit(0); });
c.on('exit', (code, sig) => { if (t) clearTimeout(t); fs.appendFileSync(log, '\\n### mis-detach EXIT=' + (code ?? sig) + ' ###\\n'); process.exit(0); });
`;
function detach(argv, cwd) {
  const args = [...argv], i = args.indexOf('--');
  const cmd = i >= 0 ? args.splice(i).slice(1) : [];
  const label = flag(args, '--label') ?? slug(cmd[0] ?? 'job'), t = flag(args, '--timeout'), timeoutMs = t ? duration(t, '--timeout') : 0;
  const logArg = flag(args, '--log');
  if (!cmd.length) fail('usage: mis detach [--log path] [--timeout 30m] [--label name] -- <command...>');
  const log = logArg ? resolve(cwd, logArg) : join(projectDir(cwd, 'detach'), `${label}-${stamp()}-${process.pid}.log`);
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `### mis-detach START ${new Date().toISOString()} cmd=${JSON.stringify(cmd)} ###\n`, { flag: 'a' });
  const child = spawn(process.execPath, ['-e', WRAPPER, JSON.stringify([log, timeoutMs, ...cmd])], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid, log, poll: `grep -q '### mis-detach EXIT=' ${log}` };
}

export const opsCommands = { canary, deploy, 'landing-report': landingReport, 'mission-board': missionBoard, wait, detach };
