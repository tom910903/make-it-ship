// M9-D D3: deploy and operations (absorbs gstack canary, setup-deploy, land-and-deploy, landing-report, gstack-detach;
// OMC `omc wait`, `omc mission-board`). Deploy commands and canary always ask (policy.mjs APPROVAL_MIS); the reports
// (landing-report, mission-board) are read-only snapshots that write nothing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fail, flag, bool, projectDir, rootOf, readJson, writeJson, stamp, slug, duration, MIS_CLI_ENV } from './cli-util.mjs';
import { browseDir, send } from './browse/client.mjs';
import { stateRoot, loadRun } from './state.mjs';
import { loadRuns } from './retro.mjs';
import { readLoop } from './loop.mjs';
import { homeDir } from './home.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const gitOut = (cwd, ...a) => { const r = git(cwd, ...a); return r.status === 0 ? r.stdout.trim() : null; };

// ---------------------------------------------------------------- canary

/** One canary probe of a page through the built-in browser: HTTP status, console errors, load time (navigation
 *  timing) and a screenshot as evidence. */
async function probePage(cwd, url, shot) {
  const dir = browseDir(cwd), at = new Date().toISOString();
  try {
    await send(dir, { cmd: 'console', args: ['--clear'], cwd });
    const nav = await send(dir, { cmd: 'goto', args: [url], cwd });
    const status = Number(/\((\d{3})\)\s*$/.exec(String(nav))?.[1] ?? NaN);
    const errs = String(await send(dir, { cmd: 'console', args: ['--errors'], cwd }));
    const errors = errs.startsWith('(no console') ? [] : errs.split('\n').filter(Boolean);
    let perf = await send(dir, { cmd: 'perf', args: [], cwd });
    if (typeof perf === 'string') try { perf = JSON.parse(perf); } catch { perf = {}; }
    let screenshot = null;
    if (shot) { mkdirSync(dirname(shot), { recursive: true }); screenshot = String(await send(dir, { cmd: 'screenshot', args: [shot], cwd })).trim(); }
    return { url, at, status: Number.isNaN(status) ? null : status, consoleErrors: errors.length, errors: errors.slice(0, 5), loadMs: perf?.loadMs > 0 ? perf.loadMs : null, screenshot };
  } catch (e) {
    if (/BLOCKED/.test(e.message)) throw e;
    return { url, at, status: null, consoleErrors: null, loadMs: null, screenshot: null, error: e.message };
  }
}

// A load-time regression needs 2x the baseline and at least this much slower: a 5 ms local page at 11 ms is noise.
const SLOW_FLOOR_MS = 100;
/** Alerts compare with the baseline and must persist across 2 consecutive checks (one check: alert at once).
 *  CRITICAL = failed load, HIGH = more console errors than the baseline, MEDIUM = load time >= 2x the baseline. */
export function canaryAlerts(checks, baseline = {}) {
  const alerts = [];
  const pages = [...new Set(checks.flat().map((p) => p.url))];
  for (const url of pages) {
    const series = checks.map((c) => c.find((p) => p.url === url)).filter(Boolean);
    const base = baseline[url];
    const is = {
      CRITICAL: (p) => p.status === null || p.status >= 400,
      HIGH: (p) => p.consoleErrors > (base?.consoleErrors ?? 0),
      MEDIUM: (p) => base?.loadMs > 0 && p.loadMs >= 2 * base.loadMs && p.loadMs - base.loadMs >= SLOW_FLOOR_MS,
    };
    const need = series.length > 1 ? 2 : 1;
    for (const level of ['CRITICAL', 'HIGH', 'MEDIUM']) {
      let run = 0, hit = null;
      for (const p of series) { run = is[level](p) ? run + 1 : 0; if (run >= need) hit = p; }
      if (!hit) continue;
      const detail = level === 'CRITICAL' ? `page failed to load (${hit.status ?? hit.error})`
        : level === 'HIGH' ? `${hit.consoleErrors} console errors (baseline ${base?.consoleErrors ?? 0})` : `load ${hit.loadMs} ms (baseline ${base.loadMs} ms, ${(hit.loadMs / base.loadMs).toFixed(1)}x)`;
      alerts.push({ level, url, detail, ...(hit.screenshot ? { screenshot: hit.screenshot } : {}) });
      break;
    }
  }
  return alerts;
}

/** Same-origin page URLs from sitemap.xml <loc> entries and from links (`text → href` lines); no hash, deduped. */
export function sameOriginPages(origin, sitemapXml = '', links = '') {
  const urls = [...String(sitemapXml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
    .concat(String(links).split('\n').map((l) => l.split(' → ').at(-1).trim()));
  const out = [];
  for (const u of urls) {
    let x; try { x = new URL(u, origin); } catch { continue; }
    if (x.origin !== origin || !/^https?:$/.test(x.protocol)) continue;
    x.hash = '';
    if (!out.includes(x.href)) out.push(x.href);
  }
  return out;
}

/** Pages to watch: the start page, its sitemap.xml and its links, same origin only, at most max. */
async function discoverPages(cwd, url, max) {
  const origin = new URL(url).origin;
  let xml = '';
  try { const r = await fetch(new URL('/sitemap.xml', origin), { signal: AbortSignal.timeout(10000), redirect: 'manual' }); if (r.ok) xml = await r.text(); } catch { /* no sitemap */ }
  let links = '';
  try { await send(browseDir(cwd), { cmd: 'goto', args: [url], cwd }); links = String(await send(browseDir(cwd), { cmd: 'links', args: [], cwd })); } catch (e) { if (/BLOCKED/.test(e.message)) throw e; }
  return sameOriginPages(origin, xml, `${url}\n${links}`).slice(0, max);
}

const shotName = (u) => slug(new URL(u).pathname.replace(/\/$/, '') || 'home') || 'home';

/** mis canary <url> [--pages /,/a | --discover [--max-pages 10]] [--checks 3] [--interval 60s] [--baseline] */
async function canary(argv, cwd) {
  const args = [...argv];
  const pagesArg = flag(args, '--pages'), discover = bool(args, '--discover'), maxPages = Number(flag(args, '--max-pages') ?? 10);
  const checks = Number(flag(args, '--checks') ?? 3);
  const interval = duration(flag(args, '--interval') ?? '60s', '--interval'), isBaseline = bool(args, '--baseline');
  const [url] = args;
  if (!url || !/^https?:\/\//.test(url) || !Number.isInteger(checks) || checks < 1 || checks > 60 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) fail('usage: mis canary <http(s)://url> [--pages /,/dashboard | --discover [--max-pages 1-50]] [--checks 1-60] [--interval 60s] [--baseline]');
  const listed = (pagesArg ?? (discover ? '' : '/')).split(',').filter(Boolean).map((p) => new URL(p, url).href);
  const urls = [...new Set([...listed, ...(discover ? await discoverPages(cwd, url, maxPages) : [])])];
  const dir = projectDir(cwd, 'canary');
  if (isBaseline) {
    const snap = [];
    for (const u of urls) snap.push(await probePage(cwd, u, join(dir, 'baseline', `${shotName(u)}.png`))); // one tab: pages one after another
    const baseline = { url, at: new Date().toISOString(), branch: gitOut(cwd, 'branch', '--show-current'), pages: Object.fromEntries(snap.map((p) => [p.url, p])) };
    writeJson(join(dir, 'baseline.json'), baseline);
    return { baseline: join(dir, 'baseline.json'), pages: snap, next: `Deploy, then run mis canary ${url}` };
  }
  const baseline = readJson(join(dir, 'baseline.json'))?.pages ?? {};
  const results = [], run = stamp();
  for (let i = 0; i < checks; i++) {
    if (i) await sleep(interval);
    const pass = [];
    for (const u of urls) pass.push(await probePage(cwd, u, join(dir, 'shots', run, `${shotName(u)}-${i + 1}.png`)));
    results.push(pass);
  }
  const alerts = canaryAlerts(results, baseline);
  const report = { url, pages: urls, checks: results.length, baseline: Object.keys(baseline).length ? 'baseline.json' : 'none (alerts use 0 console errors and HTTP < 400; no load-time comparison)', status: alerts.length ? 'ALERT' : 'HEALTHY', alerts, results };
  const file = join(dir, `report-${run}.json`);
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
const FIELDS = { '--platform': 'platform', '--url': 'url', '--merge-cmd': 'mergeCmd', '--deploy-cmd': 'deployCmd', '--status-cmd': 'statusCmd', '--health': 'healthUrl', '--ci-cmd': 'ciCmd', '--rollback-cmd': 'rollbackCmd', '--base': 'base' };

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
  return fail('usage: mis deploy setup [--platform p] [--url u] [--merge-cmd c] [--deploy-cmd c] [--status-cmd c] [--health url] [--ci-cmd c] [--rollback-cmd c] [--base branch] [--write] | run [--dry-run] [--auto-revert] [--health-tries N] [--ci-tries N] [--ci-interval 30s] | status');
}

// MIS_CLI (M9 r2 N2): a mis command a deploy/CI/rollback step calls that the guard would ask about is refused there
const sh = (cmd, cwd) => { const t0 = Date.now(), r = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 30 * 60000, env: MIS_CLI_ENV() }); return { exit: r.status, ms: Date.now() - t0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-2000) }; };
const onPath = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
const cmpV = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** VERSION drift (gstack land-and-deploy step 3.4): the branch must carry a VERSION above the base's, or another
 *  change already claimed it. Skipped without a VERSION file or when deploying the base branch itself. */
export function versionDrift(root, base) {
  const branch = gitOut(root, 'branch', '--show-current');
  let mine = null; try { mine = readFileSync(join(root, 'VERSION'), 'utf8').trim(); } catch { /* none */ }
  if (!mine || !branch || branch === base) return { status: 'skipped', reason: !mine ? 'no VERSION file' : 'deploying the base branch itself' };
  const theirs = gitOut(root, 'show', `origin/${base}:VERSION`) ?? gitOut(root, 'show', `${base}:VERSION`);
  if (!parseV(theirs) || !parseV(mine)) return { status: 'skipped', reason: `no comparable VERSION on ${base}` };
  return cmpV(mine, theirs) > 0 ? { status: 'ok', branch: mine, base: theirs }
    : { status: 'drift', branch: mine, base: theirs, reason: `VERSION ${mine} is not above ${base}'s ${theirs}: another change landed first; bump again (mis next-version) before deploying` };
}

/** CI gate: the configured ciCmd, else `gh pr checks` when gh is installed. Exit 0 = green, 8 = pending (gh's code), else failed. */
async function waitCi(c, root, tries, every) {
  const cmd = c.ciCmd ?? (onPath('gh') ? 'gh pr checks' : null);
  if (!cmd) return { status: 'skipped', reason: 'no --ci-cmd configured and gh is not installed' };
  const polls = [];
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(every);
    const r = sh(cmd, root);
    polls.push(r.exit);
    if (r.exit === 0) return { status: 'passed', cmd, polls };
    if (!c.ciCmd && /no pull requests? found/i.test(r.output)) return { status: 'skipped', cmd, reason: 'no pull request for this branch' };
    if (r.exit !== 8) return { status: 'failed', cmd, polls, output: r.output };
  }
  return { status: 'timeout', cmd, polls };
}

/** Undo a deploy whose health check failed: the rollback command, else revert what this run merged and deploy again. */
function revertDeploy(c, root, before) {
  if (c.rollbackCmd) return { how: 'rollback-cmd', cmd: c.rollbackCmd, ...sh(c.rollbackCmd, root) };
  const head = gitOut(root, 'rev-parse', 'HEAD');
  if (!before || head === before) return { how: 'none', exit: null, reason: 'this run merged nothing and no --rollback-cmd is configured' };
  const merge = (gitOut(root, 'rev-list', '--parents', '-n', '1', head) ?? '').split(' ').length > 2;
  const r = sh(`git revert --no-edit ${merge ? `-m 1 ${head}` : `${before}..${head}`}`, root);
  if (r.exit !== 0) { git(root, 'revert', '--abort'); return { how: 'git-revert', reverted: head, ...r, reason: 'git revert failed (conflict?); resolve it by hand' }; }
  const redeploy = c.deployCmd ? sh(c.deployCmd, root) : null;
  return { how: 'git-revert', reverted: head, revertCommit: gitOut(root, 'rev-parse', 'HEAD'), exit: redeploy ? redeploy.exit : 0, redeploy };
}

async function deployRun(args, cwd) {
  const root = rootOf(cwd), dry = bool(args, '--dry-run'), autoRevert = bool(args, '--auto-revert');
  const tries = Number(flag(args, '--health-tries') ?? 5), wait = duration(flag(args, '--health-interval') ?? '10s');
  const ciTries = Number(flag(args, '--ci-tries') ?? 60), ciEvery = duration(flag(args, '--ci-interval') ?? '30s');
  const c = readJson(deployFile(cwd));
  if (!c) fail('no deploy configuration (mis deploy setup, then --write)');
  const base = c.base ?? gitOut(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '') ?? 'main';
  const plan = [['merge', c.mergeCmd], ['deploy', c.deployCmd], ['status', c.statusCmd]].filter(([, cmd]) => cmd);
  if (dry) return { dryRun: true, version: versionDrift(root, base), ci: c.ciCmd ?? (onPath('gh') ? 'gh pr checks' : null), steps: plan.map(([step, cmd]) => ({ step, cmd })), health: c.healthUrl ?? null, autoRevert: autoRevert ? (c.rollbackCmd ?? 'git revert of the merge, then the deploy command') : false };
  if (gitOut(root, 'status', '--porcelain', '--', '.', ':(exclude).make-it-ship')) fail('the working tree has uncommitted changes; commit or stash them before deploying');
  const run = loadRun(cwd);
  const steps = [];
  let failed = null, ci = null, before = null, merge = null;
  const version = versionDrift(root, base);
  if (version.status === 'drift') failed = 'version';
  if (!failed) { ci = await waitCi(c, root, ciTries, ciEvery); if (!['passed', 'skipped'].includes(ci.status)) failed = 'ci'; }
  for (const [step, cmd] of failed ? [] : plan) {
    if (step === 'merge') before = gitOut(root, 'rev-parse', 'HEAD');
    // shortcut: the 30-min timeout kills `sh` only, not processes it started; upgrade with a process-group kill if steps hang.
    const r = sh(cmd, root);
    steps.push({ step, cmd, ...r });
    if (step === 'merge') merge = { before, after: gitOut(root, 'rev-parse', 'HEAD') };
    if (r.exit !== 0) { failed = step; break; }
  }
  let health = null, revert = null;
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
  if (failed === 'health' && autoRevert) revert = revertDeploy(c, root, before);
  const reverted = revert?.exit === 0;
  const result = { status: reverted ? 'REVERTED' : failed ? 'FAILED' : 'DEPLOYED', failedStep: failed, version, ci, merge, steps, health, ...(revert ? { revert } : {}), run: run ? { id: run.state.runId, state: run.state.state } : null,
    next: reverted ? 'The deploy was rolled back. Tell the user; fix on the branch and ship again.'
      : failed === 'version' ? version.reason
        : failed === 'health' && !revert ? `Show the user the failed health check. Rolling back is their call: ${c.rollbackCmd ? `the rollback command (${c.rollbackCmd})` : merge && merge.after !== merge.before ? `git revert ${merge.after.slice(0, 12)}${(gitOut(root, 'rev-list', '--parents', '-n', '1', merge.after) ?? '').split(' ').length > 2 ? ' -m 1' : ''} (what this run merged), then the deploy command` : 'this run merged nothing locally (remote merge?): configure --rollback-cmd or revert on the platform'}. (--auto-revert does this only on the run that deploys; rerunning merges nothing new.)`
          : failed ? 'Show the user the failing step and output; revert only with their approval.' : c.url ? `Watch it: mis canary ${c.url} --checks 5` : 'Done.' };
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

// Claude Code's own limit wording (OMC tmux-detector fixtures); generic "rate limit" API errors do not count.
const LIMIT = /you(?:'|’)ve\s+(?:hit|reached)\s+your\s+(?:[\w-]+\s+)?limit|\b(?:usage|5[- ]?hour|weekly|session)\s+(?:usage\s+)?limit\s+(?:reached|hit)\b|limit (?:will )?resets?\b/i;
const GIT_LINE = /^(?:commit\s+[0-9a-f]{6,40}\b|Author:\s|Date:\s|Merge:\s|diff\s--git\s|(?:---|\+\+\+)\s[ab]\/|@@\s-\d)/;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RESET = new RegExp(String.raw`resets?\s+(?:at\s+|on\s+)?(?:(${WEEKDAYS.join('|')})[a-z]*\s+(?:at\s+)?|(${MONTHS.join('|')})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\)|\s+(UTC|GMT))?`, 'i');

/** Wall-clock parts of instant t in time zone tz. */
function partsIn(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    .formatToParts(t).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute, wd: WEEKDAYS.indexOf(p.weekday.toLowerCase()) };
}
/** Instant of a wall-clock time in tz (two passes settle the offset, also across a DST change). */
function zoned(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo, d, h, mi);
  const off = (t) => { const p = partsIn(t, tz); return Date.UTC(p.y, p.mo, p.d, p.h, p.mi) - Math.floor(t / 60000) * 60000; };
  const t = want - off(want);
  return want - off(t);
}

/** Does this text show a Claude Code usage-limit stop, and when does the limit reset? Pure (now is passed in). */
export function parseLimit(text, now = Date.now()) {
  const lines = String(text).split('\n').filter((l) => !GIT_LINE.test(l.trimStart()));
  // the last limit message on screen wins (older ones may still be in the scrollback)
  const at = lines.findLastIndex((l) => LIMIT.test(l));
  if (at < 0) return { blocked: false };
  const near = lines.slice(Math.max(0, at - 2), at + 4).join(' ');

  const kind = /weekly/i.test(near) ? 'weekly' : /5[- ]?hour/i.test(near) ? 'five_hour' : /session/i.test(near) ? 'session' : 'unknown';
  const epoch = /limit reached\|(\d{10})/i.exec(near);
  if (epoch) return { blocked: true, kind, resetAt: new Date(Number(epoch[1]) * 1000).toISOString(), message: lines[at].trim() };
  const r = RESET.exec(near);
  if (!r || (!r[6] && !r[5] && !r[8] && !r[7])) return { blocked: true, kind, resetAt: null, message: lines[at].trim() }; // "resets 5" alone is not a time
  let tz = r[8] ? 'UTC' : r[7] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { partsIn(now, tz); } catch { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }
  let h = Number(r[4]) % (r[6] ? 12 : 24);
  if (r[6]?.toLowerCase() === 'pm') h += 12;
  const mi = Number(r[5] ?? 0), today = partsIn(now, tz);
  let t;
  if (r[2]) { // "Feb 17 at 2pm": this year, or next year when that date has passed
    const mo = MONTHS.indexOf(r[2].toLowerCase()), d = Number(r[3]);
    t = zoned(today.y, mo, d, h, mi, tz);
    if (t <= now - 86400000) t = zoned(today.y + 1, mo, d, h, mi, tz);
  } else {
    const ahead = r[1] ? (WEEKDAYS.indexOf(r[1].toLowerCase()) - today.wd + 7) % 7 : 0;
    t = zoned(today.y, today.mo, today.d + ahead, h, mi, tz);
    if (t <= now) t = zoned(today.y, today.mo, today.d + ahead + (r[1] ? 7 : 1), h, mi, tz);
  }
  return { blocked: true, kind, resetAt: new Date(t).toISOString(), timeZone: tz, message: lines[at].trim() };
}

const PANE = /^%\d+$/;
const tmux = (...a) => spawnSync('tmux', a, { encoding: 'utf8', timeout: 10000 });
function tmuxPanes(only) {
  if (only) { if (!PANE.test(only)) fail(`bad pane id "${only}" (expected %N, see tmux list-panes -a -F '#{pane_id}')`); return [{ pane: only }]; }
  const r = tmux('list-panes', '-a', '-F', '#{pane_id} #{session_name}:#{window_index}.#{pane_index}');
  if (r.error) fail('BLOCKED: tmux is not installed (or pass --log <file> with the session output)');
  if (r.status !== 0) return []; // no tmux server: nothing to scan
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [pane, where] = l.split(' '); return { pane, where }; }).filter((p) => PANE.test(p.pane));
}
/** Every pane (or the one pane / log file given) with a usage-limit stop on screen. */
function detectLimits(args, cwd) {
  const log = flag(args, '--log'), only = flag(args, '--pane');
  if (log) { const r = parseLimit(readFileSync(resolve(cwd, log), 'utf8')); return r.blocked ? [{ log: resolve(cwd, log), ...r }] : []; }
  return tmuxPanes(only).map((p) => ({ ...p, ...parseLimit(tmux('capture-pane', '-p', '-t', p.pane, '-S', '-40').stdout ?? '') })).filter((p) => p.blocked);
}

/** mis wait (--until <ISO|HH:MM> | --seconds N) [-- cmd] | detect [--pane %N | --log f] | auto [--pane %N | --log f] [--watch [--poll 60s] [--max-watch 12h]] [--margin 60s] [--text continue] [-- cmd] */
async function wait(argv, cwd) {
  const args = [...argv], i = args.indexOf('--'), cmd = i >= 0 ? args.splice(i).slice(1) : [];
  if (args[0] === 'detect') return { blocked: detectLimits(args.slice(1), cwd) };
  if (args[0] === 'auto') return waitAuto(args.slice(1), cmd, cwd);
  const until = flag(args, '--until'), secs = flag(args, '--seconds');
  let target;
  if (secs !== undefined) target = Date.now() + Number(secs) * 1000;
  else if (/^\d{1,2}:\d{2}$/.test(until ?? '')) { const [h, m] = until.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); target = d.getTime(); }
  else if (until) target = Date.parse(until);
  if (!Number.isFinite(target)) fail('usage: mis wait (--until <ISO time|HH:MM> | --seconds N) [-- <resume command...>] | detect [--pane %N|--log f] | auto [--pane %N|--log f] [--watch [--poll 60s] [--max-watch 12h]] [--margin 60s] [--text continue] [-- <resume command...>]');
  const ms = Math.max(0, target - Date.now());
  if (ms > 24 * 3600000) fail('mis wait waits at most 24h');
  await sleep(ms);
  return { waitedMs: ms, resumedAt: new Date().toISOString(), ...runResume(cmd, cwd) };
}
function runResume(cmd, cwd) {
  if (!cmd.length) return {};
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
  return { resume: cmd.join(' '), exit: r.status ?? r.error?.message };
}

/** Detect limit-stopped sessions, sleep until the latest reset (+ margin), then type the resume text into each pane
 *  (or, with --log, run the resume command). A stop whose message has no reset time is reported, never guessed. */
async function waitAuto(args, cmd, cwd) {
  const margin = duration(flag(args, '--margin') ?? '60s', '--margin'), text = flag(args, '--text') ?? 'continue';
  const log = args.includes('--log');
  if (log && !cmd.length) fail('mis wait auto --log needs a resume command after --');
  const watch = bool(args, '--watch'), poll = duration(flag(args, '--poll') ?? '60s', '--poll'), maxWatch = duration(flag(args, '--max-watch') ?? '12h', '--max-watch');
  let found = detectLimits([...args], cwd); // copies: flag() consumes --log/--pane
  // --watch: armed ahead of time (e.g. under mis detach), it scans until a stop appears, at most --max-watch
  for (const end = Date.now() + maxWatch; watch && !found.length && Date.now() < end;) { await sleep(poll); found = detectLimits([...args], cwd); }
  if (!found.length) return { status: 'NOT_LIMITED', blocked: [] };
  const timed = found.filter((f) => f.resetAt), untimed = found.filter((f) => !f.resetAt);
  if (!timed.length) { process.exitCode = 1; return { status: 'NO_RESET_TIME', blocked: found, next: 'Read the reset time from the session and use mis wait --until <time> -- <resume command>.' }; }
  const target = Math.max(...timed.map((f) => Date.parse(f.resetAt))) + margin;
  const ms = Math.max(0, target - Date.now());
  if (ms > 8 * 86400000) fail(`the limit resets at ${new Date(target).toISOString()}, more than 8 days away`);
  await sleep(ms);
  const resumed = log ? [{ log: timed[0].log, ...runResume(cmd, cwd) }]
    : timed.map((f) => {
      const a = tmux('send-keys', '-t', f.pane, '-l', text), b = a.status === 0 ? tmux('send-keys', '-t', f.pane, 'Enter') : a;
      if (b.status !== 0) process.exitCode = 1;
      return { pane: f.pane, where: f.where, sent: text, ok: b.status === 0 };
    });
  return { status: 'RESUMED', waitedMs: ms, resumedAt: new Date().toISOString(), resumed, ...(untimed.length ? { skipped: untimed.map((f) => ({ pane: f.pane, why: 'no reset time in the message' })) } : {}) };
}

// The wrapper runs in its own session (setsid via detached), so a SIGTERM to the launcher's process group misses it;
// it always appends an EXIT sentinel so a poller can tell finished from died. With a lock file it first waits for
// the machine-wide lock (pid inside; a dead holder's lock is reclaimed) and removes it on exit only if it still owns it.
// shortcut: a reused pid makes a stale lock look held, and two waiters can both reclaim the same stale lock in the
// same instant; upgrade to an flock-style native lock if jobs on one machine start in bursts.
const WRAPPER = `
const { spawn } = require('node:child_process'); const fs = require('node:fs');
const [log, timeoutMs, lock, ...cmd] = JSON.parse(process.argv[1]);
const note = (s) => fs.appendFileSync(log, '### mis-detach ' + s + ' ' + new Date().toISOString() + ' ###\\n');
process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
const mine = () => { try { return fs.readFileSync(lock, 'utf8').split(' ')[0] === String(process.pid); } catch { return false; } };
const release = () => { if (lock && mine()) fs.rmSync(lock, { force: true }); };
if (lock) {
  let waited = false;
  for (;;) {
    try { fs.writeFileSync(lock, process.pid + ' ' + new Date().toISOString() + '\\n', { flag: 'wx' }); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let holder = NaN; try { holder = Number(fs.readFileSync(lock, 'utf8').split(' ')[0]); } catch { continue; }
    let alive = true; try { process.kill(holder, 0); } catch (e) { alive = e.code !== 'ESRCH'; }
    if (!alive) { note('STALE lock of dead pid ' + holder + ' reclaimed'); fs.rmSync(lock, { force: true }); continue; }
    if (!waited) { note('WAITING for lock ' + lock + ' (held by pid ' + holder + ')'); waited = true; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  note('LOCK ACQUIRED ' + lock);
}
const fd = fs.openSync(log, 'a');
// own process group: the timeout kills the job and its children (caffeinate does not exec into the job)
const c = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', fd, fd], detached: true });
const t = timeoutMs > 0 ? setTimeout(() => { fs.appendFileSync(log, '\\n### mis-detach TIMEOUT ###\\n'); try { process.kill(-c.pid, 'SIGKILL'); } catch { c.kill('SIGKILL'); } }, timeoutMs) : null;
c.on('error', (e) => { fs.appendFileSync(log, '\\n' + e.message + '\\n### mis-detach EXIT=127 ###\\n'); release(); process.exit(0); });
c.on('exit', (code, sig) => { if (t) clearTimeout(t); release(); fs.appendFileSync(log, '\\n### mis-detach EXIT=' + (code ?? sig) + ' ###\\n'); process.exit(0); });
`;
/** caffeinate on PATH (macOS): keeps the machine from idle-sleeping while the job runs. */
const caffeinate = () => (process.env.PATH ?? '').split(':').map((d) => join(d || '.', 'caffeinate')).find((p) => existsSync(p)) ?? null;

function detach(argv, cwd) {
  const args = [...argv], i = args.indexOf('--');
  const cmd = i >= 0 ? args.splice(i).slice(1) : [];
  const label = flag(args, '--label') ?? slug(cmd[0] ?? 'job'), t = flag(args, '--timeout'), timeoutMs = t ? duration(t, '--timeout') : 0;
  const logArg = flag(args, '--log'), lockName = flag(args, '--lock');
  if (!cmd.length) fail('usage: mis detach [--log path] [--timeout 30m] [--label name] [--lock name] -- <command...>');
  if (lockName !== undefined && !/^[\w.-]{1,64}$/.test(lockName)) fail('--lock takes a name of letters, digits, . _ - (at most 64)');
  const lock = lockName ? join(homeDir(), 'locks', `${lockName}.lock`) : null;
  if (lock) mkdirSync(dirname(lock), { recursive: true });
  const caf = caffeinate(), run = caf ? [caf, '-i', ...cmd] : cmd;
  const log = logArg ? resolve(cwd, logArg) : join(projectDir(cwd, 'detach'), `${label}-${stamp()}-${process.pid}.log`);
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `### mis-detach START ${new Date().toISOString()} cmd=${JSON.stringify(cmd)}${caf ? ' caffeinate=-i' : ''}${lock ? ` lock=${lockName}` : ''} ###\n`, { flag: 'a' });
  const child = spawn(process.execPath, ['-e', WRAPPER, JSON.stringify([log, timeoutMs, lock, ...run])], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid, log, ...(lock ? { lock } : {}), caffeinate: !!caf, poll: `grep -q '### mis-detach EXIT=' ${log}` };
}

export const opsCommands = { canary, deploy, 'landing-report': landingReport, 'mission-board': missionBoard, wait, detach };
