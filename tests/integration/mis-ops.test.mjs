// Deploy setup/run against a local stub server, read-only landing-report and mission-board, wait, detach.
// No real gh or tmux: deploy runs get a PATH without gh unless a fake one is planted; tmux is a fake script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, git, fakeHome, MIS, SYS_PATH } from '../helpers.mjs';

const run = mis;
const NOGH = { env: { PATH: SYS_PATH } };
import { canaryAlerts, nextVersion, detectPlatform, parseLimit, sameOriginPages, versionDrift } from '../../scripts/lib/commands-ops.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const STUB = fileURLToPath(new URL('../fixtures/http-stub.mjs', import.meta.url));
let server, base;
before(async () => {
  server = spawn(process.execPath, [STUB], { stdio: ['ignore', 'pipe', 'inherit'] });
  base = `http://127.0.0.1:${String((await once(server.stdout, 'data'))[0]).trim()}`;
});
after(() => server.kill());

test('canary alerts compare with the baseline and need 2 consecutive bad checks (1 when only one check ran)', () => {
  const p = (url, status, consoleErrors) => ({ url, status, consoleErrors });
  assert.deepEqual(canaryAlerts([[p('a', 200, 0)], [p('a', 500, 0)], [p('a', 200, 0)]]), [], 'a single blip is not an alert');
  assert.equal(canaryAlerts([[p('a', 200, 0)], [p('a', 500, 0)], [p('a', null, 0)]])[0].level, 'CRITICAL');
  assert.equal(canaryAlerts([[p('a', 200, 2)], [p('a', 200, 2)]], { a: { consoleErrors: 2 } }).length, 0, 'same errors as the baseline');
  assert.equal(canaryAlerts([[p('a', 200, 3)], [p('a', 200, 3)]], { a: { consoleErrors: 2 } })[0].level, 'HIGH');
  assert.equal(canaryAlerts([[p('a', 404, 0)]]).length, 1);
});

test('nextVersion skips claimed versions; detectPlatform reads platform files and deploy workflows', () => {
  assert.equal(nextVersion('1.6.3.0', 'patch', ['1.6.4.0']), '1.6.5.0');
  assert.equal(nextVersion('1.6.3.0', 'micro'), '1.6.3.1');
  assert.equal(nextVersion('1.6.3', 'minor'), '1.7.0');
  assert.equal(nextVersion('1.6.3', 'micro'), null);
  const dir = makeRepo({ 'fly.toml': 'app="x"', '.github/workflows/cd.yml': 'name: deploy to production' });
  assert.deepEqual(detectPlatform(dir), { platform: 'fly', candidates: ['fly'], workflows: ['.github/workflows/cd.yml'] });
});

test('mis deploy: setup proposes without writing, --write saves; run executes the commands then checks health; failures exit 1', () => {
  const dir = makeRepo({ 'vercel.json': '{}' });
  const mis = (d, args) => run(d, args, NOGH);
  const dry = ok(mis(dir, ['deploy', 'setup', '--deploy-cmd', 'echo deployed > .deployed', '--health', `${base}/ok`]));
  assert.equal(dry.write, false); assert.equal(dry.config.platform, 'vercel');
  assert.equal(existsSync(join(dir, '.make-it-ship/deploy.json')), false);
  ok(mis(dir, ['deploy', 'setup', '--deploy-cmd', 'echo deployed > /dev/null', '--status-cmd', 'true', '--health', `${base}/ok`, '--url', base, '--write']));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'deploy config');
  assert.deepEqual(ok(mis(dir, ['deploy', 'run', '--dry-run'])).steps.map((s) => s.step), ['deploy', 'status']);
  const r = ok(mis(dir, ['deploy', 'run']));
  assert.equal(r.status, 'DEPLOYED'); assert.deepEqual(r.health.attempts, [200]); assert.match(r.next, /mis canary/);
  ok(mis(dir, ['deploy', 'setup', '--health', `${base}/bad`, '--write']));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'bad health');
  const bad = mis(dir, ['deploy', 'run', '--health-tries', '2', '--health-interval', '0s']);
  assert.equal(bad.code, 1); assert.equal(bad.json.failedStep, 'health'); assert.deepEqual(bad.json.health.attempts, [500, 500]);
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  assert.match(mis(dir, ['deploy', 'run']).err, /uncommitted changes/);
});

test('mis landing-report: read-only snapshot of claimed versions, collisions and next free versions (stub gh, no fetch)', () => {
  const dir = makeRepo({ VERSION: '1.2.0.0\n' });
  git(dir, 'checkout', '-qb', 'feat-a'); writeFileSync(join(dir, 'VERSION'), '1.2.1.0\n'); git(dir, 'commit', '-qam', 'bump');
  git(dir, 'update-ref', 'refs/remotes/origin/feat-a', 'HEAD'); git(dir, 'update-ref', 'refs/remotes/origin/feat-b', 'HEAD');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
  const h = fakeHome();
  writeFileSync(join(h.bin, 'gh'), `#!/bin/sh\necho '[{"number":1,"headRefName":"feat-a","url":"u1"},{"number":2,"headRefName":"feat-b","url":"u2"}]'\n`); chmodSync(join(h.bin, 'gh'), 0o755);
  const before = git(dir, 'status', '--porcelain');
  const r = ok(mis(dir, ['landing-report'], { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` } }));
  assert.equal(r.status, 'ONLINE'); assert.equal(r.baseVersion, '1.2.0.0');
  assert.deepEqual(r.collisions, ['1.2.1.0']);
  assert.equal(r.next.patch, '1.2.2.0', 'skips the claimed 1.2.1.0');
  assert.equal(git(dir, 'status', '--porcelain'), before, 'writes nothing');
  const off = ok(mis(dir, ['landing-report'], { env: { ...h.env, PATH: SYS_PATH } }));
  assert.equal(off.status, 'OFFLINE'); assert.match(off.reason, /gh/);
});

test('mis mission-board: one JSON snapshot of runs, loop, team, worktrees and research; writes nothing', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  const h = fakeHome();
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  ok(mis(dir, ['research', 'start', 'q'], { env: h.env }));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'r');
  const r = ok(mis(dir, ['mission-board'], { env: h.env }));
  assert.ok(r.currentRun); assert.equal(r.runs.length, 1); assert.equal(r.worktrees[0].changes, 0);
  assert.equal(r.research[0].status, 'in_progress');
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('mis wait sleeps until the given time, then runs the resume command', () => {
  const dir = makeRepo();
  const r = ok(mis(dir, ['wait', '--seconds', '1', '--', 'sh', '-c', 'echo resumed > resumed.txt']));
  assert.ok(r.waitedMs >= 900); assert.equal(r.exit, 0);
  assert.equal(readFileSync(join(dir, 'resumed.txt'), 'utf8'), 'resumed\n');
  const past = ok(mis(dir, ['wait', '--until', new Date(Date.now() - 1000).toISOString()]));
  assert.equal(past.waitedMs, 0);
  assert.match(mis(dir, ['wait']).err, /usage/);
});

test('mis detach: the job survives a SIGTERM to the launching process group and ends with an EXIT sentinel', async () => {
  const dir = makeRepo();
  const marker = join(mkdtempSync(join(tmpdir(), 'mis-detach-')), 'done');
  // launcher shell in its own process group; it starts the job, then waits to be killed
  const sh = spawn('sh', ['-c', `"${process.execPath}" "${MIS}" detach --label t -- sh -c 'sleep 2; echo finished > "${marker}"; echo out'; sleep 60`], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  sh.stdout.on('data', (c) => { out += c; });
  for (let i = 0; i < 600 && !/"log"/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  const { log } = JSON.parse(out);
  process.kill(-sh.pid, 'SIGTERM');
  await once(sh, 'exit');
  for (let i = 0; i < 600 && !/mis-detach EXIT=/.test(readFileSync(log, 'utf8')); i++) await new Promise((r) => setTimeout(r, 100));
  const text = readFileSync(log, 'utf8');
  assert.match(text, /### mis-detach EXIT=0 ###/);
  assert.match(text, /out/);
  assert.equal(readFileSync(marker, 'utf8'), 'finished\n');
});

// ---------------------------------------------------------------- wait auto, canary rules, deploy gates, detach --lock

test('parseLimit reads Claude Code limit stops and their reset time (fixed clock); other text is not a stop', () => {
  const now = Date.parse('2026-10-20T01:00:00Z'); // a Tuesday
  const p = (t) => parseLimit(t, now);
  assert.deepEqual([p('Claude Code\n● You\'ve hit your session limit · resets 12pm (Asia/Tokyo)').resetAt, p('x').blocked], ['2026-10-20T03:00:00.000Z', false]);
  assert.equal(p('You\'ve hit your limit · resets Feb 17 at 2pm (Asia/Seoul)').resetAt, '2027-02-17T05:00:00.000Z');
  const weekly = p('⚠️  Weekly usage limit reached\nLimit resets Monday at 12:00 AM UTC.\n[1] Continue when limit resets');
  assert.deepEqual([weekly.kind, weekly.resetAt], ['weekly', '2026-10-26T00:00:00.000Z']);
  assert.equal(p('5-hour limit reached ∙ resets 3:30pm (UTC)').resetAt, '2026-10-20T15:30:00.000Z');
  assert.equal(p('5-hour limit reached ∙ resets 12:30am (UTC)').resetAt, '2026-10-21T00:30:00.000Z', 'a time already past today is tomorrow');
  assert.equal(p('Claude AI usage limit reached|1760000000').resetAt, new Date(1760000000 * 1000).toISOString());
  assert.deepEqual([p('You\'ve hit your limit').blocked, p('You\'ve hit your limit').resetAt], [true, null], 'no reset time: reported, never guessed');
  for (const t of ['HTTP 429: rate limit exceeded, try again later', 'diff --git a/docs/usage limit reached.md b/docs/usage limit reached.md\n+++ b/docs/usage limit reached.md']) assert.equal(p(t).blocked, false, t);
});

/** Fake tmux: two panes; send-keys calls are appended to a log. */
function fakeTmux(panes, { cleanFirst = false } = {}) {
  const h = fakeHome(), log = join(h.home, 'tmux.log');
  for (const [id, text] of Object.entries(panes)) writeFileSync(join(h.home, `pane${id.slice(1)}.txt`), text);
  writeFileSync(join(h.bin, 'tmux'), `#!/bin/sh
case "$1" in
  list-panes) ${Object.keys(panes).map((id, i) => `echo '${id} main:0.${i}'`).join('; ')} ;;
  capture-pane) ${cleanFirst ? `if [ ! -f "${h.home}/seen" ]; then touch "${h.home}/seen"; echo '$ claude'; exit 0; fi; ` : ''}cat "${h.home}/pane$(echo "$4" | tr -d %).txt" ;;
  send-keys) echo "$*" >> "${log}" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(h.bin, 'tmux'), 0o755);
  return { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` }, log };
}

test('mis wait detect/auto: finds the limit-stopped pane, waits for its reset, types the resume text into it only', () => {
  const dir = makeRepo();
  const past = Math.floor(Date.now() / 1000) - 60;
  const t = fakeTmux({ '%1': `Claude Code\nClaude AI usage limit reached|${past}\n`, '%2': '$ npm test\nok\n' });
  const det = ok(mis(dir, ['wait', 'detect'], { env: t.env }));
  assert.deepEqual(det.blocked.map((b) => [b.pane, b.where]), [['%1', 'main:0.0']]);
  const r = ok(mis(dir, ['wait', 'auto', '--margin', '0s'], { env: t.env }));
  assert.equal(r.status, 'RESUMED'); assert.deepEqual(r.resumed.map((x) => [x.pane, x.ok]), [['%1', true]]);
  assert.equal(readFileSync(t.log, 'utf8'), 'send-keys -t %1 -l continue\nsend-keys -t %1 Enter\n');
  assert.match(mis(dir, ['wait', 'auto', '--pane', '1;rm'], { env: t.env }).err, /bad pane id/);
  assert.match(mis(dir, ['wait', 'detect'], { env: { PATH: SYS_PATH } }).err, /BLOCKED: tmux is not installed/);
});

test('mis wait auto --watch: armed before the stop, it scans until a limit appears, then resumes', () => {
  const dir = makeRepo();
  const t = fakeTmux({ '%7': `Claude Code\nClaude AI usage limit reached|${Math.floor(Date.now() / 1000) - 1}\n` }, { cleanFirst: true });
  assert.equal(ok(mis(dir, ['wait', 'auto', '--pane', '%7', '--margin', '0s'], { env: t.env })).status, 'NOT_LIMITED', 'without --watch: one scan');
  rmSync(join(t.env.HOME, 'seen'));
  const r = ok(mis(dir, ['wait', 'auto', '--pane', '%7', '--watch', '--poll', '0s', '--margin', '0s'], { env: t.env }));
  assert.equal(r.status, 'RESUMED');
  assert.equal(readFileSync(t.log, 'utf8'), 'send-keys -t %7 -l continue\nsend-keys -t %7 Enter\n');
});

test('mis wait auto: a stop without a reset time is reported, nothing is typed; --log mode runs the resume command', () => {
  const dir = makeRepo();
  const t = fakeTmux({ '%4': 'Claude Code\nYou\'ve hit your limit\n' });
  const r = mis(dir, ['wait', 'auto', '--margin', '0s'], { env: t.env });
  assert.equal(r.code, 1); assert.equal(r.json.status, 'NO_RESET_TIME');
  assert.equal(existsSync(t.log), false, 'no keys sent');
  writeFileSync(join(dir, 'session.log'), `working...\nClaude AI usage limit reached|${Math.floor(Date.now() / 1000) - 5}\n`);
  const l = ok(mis(dir, ['wait', 'auto', '--log', 'session.log', '--margin', '0s', '--', 'sh', '-c', 'echo resumed > resumed.txt']));
  assert.equal(l.status, 'RESUMED'); assert.equal(l.resumed[0].exit, 0);
  assert.equal(readFileSync(join(dir, 'resumed.txt'), 'utf8'), 'resumed\n');
  writeFileSync(join(dir, 'clean.log'), 'all good\n');
  assert.equal(ok(mis(dir, ['wait', 'auto', '--log', 'clean.log', '--', 'true'])).status, 'NOT_LIMITED');
});

test('canary: load time >= 2x the baseline (and >= 100 ms slower) for 2 checks is a MEDIUM alert with its screenshot; discovery keeps one origin', () => {
  const p = (loadMs, screenshot) => ({ url: 'a', status: 200, consoleErrors: 0, loadMs, screenshot });
  const base = { a: { consoleErrors: 0, loadMs: 400 } };
  const slow = canaryAlerts([[p(900, 's1.png')], [p(1000, 's2.png')]], base);
  assert.deepEqual(slow, [{ level: 'MEDIUM', url: 'a', detail: 'load 1000 ms (baseline 400 ms, 2.5x)', screenshot: 's2.png' }]);
  assert.deepEqual(canaryAlerts([[p(900)], [p(500)], [p(900)]], base), [], 'not consecutive');
  assert.deepEqual(canaryAlerts([[p(30)], [p(40)]], { a: { loadMs: 5 } }), [], 'tiny pages: under the noise floor');
  assert.equal(canaryAlerts([[p(750)], [p(760)]], { a: { loadMs: 300 } })[0].level, 'MEDIUM', '300 -> 750 ms is 2.5x');
  assert.deepEqual(canaryAlerts([[p(5000)], [p(5000)]]), [], 'no baseline load time: no comparison');
  assert.deepEqual(sameOriginPages('http://s.test:8', '<urlset><url><loc>http://s.test:8/a#x</loc></url><url><loc>https://evil.example/b</loc></url></urlset>',
    'Home → http://s.test:8/\nOut → http://other.test:8/c\nA → http://s.test:8/a\nMail → mailto:x@y.z'), ['http://s.test:8/a', 'http://s.test:8/']);
});

/** Repo whose main has VERSION 1.0.0 and a branch "feat" adding feature.txt. */
function featRepo(version = '1.0.1') {
  const dir = makeRepo({ VERSION: '1.0.0\n' });
  git(dir, 'checkout', '-qb', 'feat'); writeFileSync(join(dir, 'feature.txt'), 'new\n'); writeFileSync(join(dir, 'VERSION'), `${version}\n`);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'feature');
  return dir;
}
const configure = (dir, args, env) => { ok(mis(dir, ['deploy', 'setup', ...args, '--write'], env)); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'deploy config'); };

test('mis deploy run: VERSION drift against the base stops before anything runs', () => {
  const dir = featRepo('1.0.0');
  assert.equal(versionDrift(dir, 'main').status, 'drift');
  configure(dir, ['--deploy-cmd', 'echo deployed > deployed.txt'], NOGH);
  const r = mis(dir, ['deploy', 'run'], NOGH);
  assert.equal(r.code, 1); assert.equal(r.json.failedStep, 'version'); assert.match(r.json.next, /not above main's 1\.0\.0/);
  assert.deepEqual(r.json.steps, []); assert.equal(existsSync(join(dir, 'deployed.txt')), false);
  assert.equal(versionDrift(featRepo('1.0.1'), 'main').status, 'ok');
  assert.equal(versionDrift(makeRepo(), 'main').status, 'skipped');
});

test('mis deploy run: waits for CI (pending, then green) before merging; red CI stops it; gh is used when present', () => {
  const dir = featRepo();
  const n = join(dir, '..', `${Date.now()}-ci-polls`);
  configure(dir, ['--ci-cmd', `c=$(cat "${n}" 2>/dev/null || echo 0); echo $((c+1)) > "${n}"; [ $c -ge 1 ] && exit 0 || exit 8`, '--deploy-cmd', 'true'], NOGH);
  const r = ok(mis(dir, ['deploy', 'run', '--ci-interval', '0s'], NOGH));
  assert.deepEqual([r.status, r.ci.status, r.ci.polls], ['DEPLOYED', 'passed', [8, 0]]);
  configure(dir, ['--ci-cmd', 'echo "test failed"; exit 1', '--merge-cmd', 'echo merged > merged.txt'], NOGH);
  const red = mis(dir, ['deploy', 'run', '--ci-interval', '0s'], NOGH);
  assert.equal(red.code, 1); assert.equal(red.json.failedStep, 'ci'); assert.match(red.json.ci.output, /test failed/);
  assert.equal(existsSync(join(dir, 'merged.txt')), false, 'no merge after red CI');
  const d2 = featRepo(), h = fakeHome();
  writeFileSync(join(h.bin, 'gh'), '#!/bin/sh\necho "$*" >> "$(dirname "$0")/gh.log"\nexit 0\n'); chmodSync(join(h.bin, 'gh'), 0o755);
  const env = { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` } };
  configure(d2, ['--deploy-cmd', 'true'], env);
  assert.equal(ok(mis(d2, ['deploy', 'run'], env)).ci.status, 'passed');
  assert.equal(readFileSync(join(h.bin, 'gh.log'), 'utf8'), 'pr checks\n');
  assert.equal(ok(mis(featRepo(), ['deploy', 'setup', '--deploy-cmd', 'true'], NOGH)).config.deployCmd, 'true');
});

test('mis deploy run --auto-revert: a failed health check reverts the merge and redeploys; a rollback command wins when set', () => {
  const dir = makeRepo({ 'app.txt': 'v1\n' });
  git(dir, 'checkout', '-qb', 'feat'); writeFileSync(join(dir, 'app.txt'), 'v2\n'); git(dir, 'commit', '-qam', 'v2'); git(dir, 'checkout', '-q', 'main');
  const deploys = join(dir, '..', `${Date.now()}-deploys.log`);
  configure(dir, ['--merge-cmd', 'git merge -q --no-ff feat -m "merge feat"', '--deploy-cmd', `cat app.txt >> "${deploys}"`, '--health', `${base}/bad`], NOGH);
  const plain = mis(dir, ['deploy', 'run', '--health-tries', '1'], NOGH);
  assert.equal(plain.json.status, 'FAILED'); assert.equal(plain.json.revert, undefined, 'no revert without --auto-revert');
  assert.equal(plain.json.merge.after, git(dir, 'rev-parse', 'HEAD'));
  assert.match(plain.json.next, new RegExp(`git revert ${plain.json.merge.after.slice(0, 12)} -m 1 \\(what this run merged\\)[\\s\\S]*rerunning merges nothing new`));
  // --auto-revert acts on the run that merges: undo the first merge to deploy again
  git(dir, 'reset', '-q', '--hard', 'HEAD~1');
  const r = mis(dir, ['deploy', 'run', '--health-tries', '1', '--auto-revert'], NOGH);
  assert.equal(r.code, 1); assert.equal(r.json.status, 'REVERTED'); assert.equal(r.json.revert.how, 'git-revert');
  assert.equal(readFileSync(join(dir, 'app.txt'), 'utf8'), 'v1\n');
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^Revert "merge feat"/);
  assert.equal(readFileSync(deploys, 'utf8'), 'v2\nv2\nv1\n', 'the reverted tree was deployed again');
  configure(dir, ['--rollback-cmd', 'echo rolled > rolled.txt'], NOGH);
  const rb = mis(dir, ['deploy', 'run', '--health-tries', '1', '--auto-revert'], NOGH);
  assert.deepEqual([rb.json.status, rb.json.revert.how], ['REVERTED', 'rollback-cmd']);
  assert.equal(readFileSync(join(dir, 'rolled.txt'), 'utf8'), 'rolled\n');
});

const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) assert.fail('timed out'); await new Promise((r) => setTimeout(r, 100)); } };
const exited = (log) => existsSync(log) && /mis-detach EXIT=/.test(readFileSync(log, 'utf8'));

test('mis detach --lock: jobs with the same lock run one after another; a dead holder\'s lock is reclaimed; caffeinate wraps the job when present', async () => {
  const dir = makeRepo(), h = fakeHome(), tmp = mkdtempSync(join(tmpdir(), 'mis-lock-'));
  writeFileSync(join(h.bin, 'caffeinate'), `#!/bin/sh\necho "caffeinate $1" >> "${tmp}/caf"\nshift\nexec "$@"\n`); chmodSync(join(h.bin, 'caffeinate'), 0o755);
  const env = { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` } };
  const order = join(tmp, 'order'), gate = join(tmp, 'gate');
  // job 1 holds the lock until the test creates the gate file; no sleeps decide the outcome
  const one = ok(mis(dir, ['detach', '--lock', 'evals', '--label', 'one', '--', 'sh', '-c', `echo start1 >> "${order}"; while [ ! -f "${gate}" ]; do sleep 0.1; done; echo end1 >> "${order}"`], env));
  assert.equal(one.caffeinate, true); assert.equal(one.lock, join(h.state, 'locks', 'evals.lock'));
  await until(() => existsSync(order));
  const two = ok(mis(dir, ['detach', '--lock', 'evals', '--label', 'two', '--', 'sh', '-c', `echo start2 >> "${order}"`], env));
  await until(() => /WAITING for lock/.test(readFileSync(two.log, 'utf8')));
  writeFileSync(gate, '');
  await until(() => exited(one.log) && exited(two.log));
  assert.equal(readFileSync(order, 'utf8'), 'start1\nend1\nstart2\n');
  assert.equal(existsSync(one.lock), false, 'released');
  assert.match(readFileSync(one.log, 'utf8'), /START .* caffeinate=-i lock=evals/);
  assert.equal(readFileSync(join(tmp, 'caf'), 'utf8'), 'caffeinate -i\ncaffeinate -i\n');
  // stale: the holder pid has exited
  const dead = spawn(process.execPath, ['-e', '0']); await once(dead, 'exit');
  writeFileSync(one.lock, `${dead.pid} 2026-01-01T00:00:00Z\n`);
  const three = ok(mis(dir, ['detach', '--lock', 'evals', '--', 'true'], env));
  await until(() => exited(three.log));
  assert.match(readFileSync(three.log, 'utf8'), new RegExp(`STALE lock of dead pid ${dead.pid} reclaimed[\\s\\S]*LOCK ACQUIRED[\\s\\S]*EXIT=0`));
  assert.match(mis(dir, ['detach', '--lock', '../x', '--', 'true'], env).err, /--lock takes a name/);
});

test('mis detach --timeout kills the whole job, also when a wrapper (like caffeinate) does not exec into it', async () => {
  const dir = makeRepo(), h = fakeHome(), tmp = mkdtempSync(join(tmpdir(), 'mis-to-')), pidFile = join(tmp, 'pid');
  writeFileSync(join(h.bin, 'caffeinate'), '#!/bin/sh\nshift\n"$@"\nexit $?\n'); chmodSync(join(h.bin, 'caffeinate'), 0o755); // a child, not exec
  const env = { env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` } };
  const r = ok(mis(dir, ['detach', '--timeout', '1s', '--', 'sh', '-c', `echo $$ > "${pidFile}"; exec sleep 300`], env));
  await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim());
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await until(() => /mis-detach TIMEOUT/.test(readFileSync(r.log, 'utf8')));
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
});
