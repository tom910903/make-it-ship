// M9-D D3: deploy setup/run against a local stub server, read-only landing-report and mission-board, wait, detach.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, git, fakeHome, MIS } from '../helpers.mjs';
import { canaryAlerts, nextVersion, detectPlatform } from '../../scripts/lib/commands-ops.mjs';

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
  const r = ok(mis(dir, ['landing-report'], { env: { ...h.env, PATH: `${h.bin}:/usr/bin:/bin` } }));
  assert.equal(r.status, 'ONLINE'); assert.equal(r.baseVersion, '1.2.0.0');
  assert.deepEqual(r.collisions, ['1.2.1.0']);
  assert.equal(r.next.patch, '1.2.2.0', 'skips the claimed 1.2.1.0');
  assert.equal(git(dir, 'status', '--porcelain'), before, 'writes nothing');
  const off = ok(mis(dir, ['landing-report'], { env: { ...h.env, PATH: '/usr/bin:/bin' } }));
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
