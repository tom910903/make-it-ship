// Guard and mis read the same stored files, and asks show what really happens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify } from '../../scripts/lib/policy.mjs';
import { maskSecrets } from '../../scripts/lib/mask.mjs';

const M = 'node /p/scripts/mis.mjs';
function repo(files = {}, base = tmpdir()) {
  const r = realpathSync(mkdtempSync(join(base, 'mis-de-')));
  spawnSync('git', ['init', '-q'], { cwd: r });
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(r, p, '..'), { recursive: true }); writeFileSync(join(r, p), typeof c === 'string' ? c : JSON.stringify(c)); }
  return r;
}
const v = (r, command, cwd = r, extra = {}) => classify({ tool_name: 'Bash', tool_input: { command }, cwd }, { repoRoot: r, activeRun: false, currentBranch: 'main', ...extra });

test('maskSecrets hides the password of scheme://user:password@ URLs and keeps the host', () => {
  const m = maskSecrets('to https://alice:hunter2pass@tele.example/ingest and postgres://u:p4ssw0rd@db:5432/x', {});
  assert.ok(!m.includes('hunter2pass') && !m.includes('p4ssw0rd'), m);
  assert.match(m, /tele\.example\/ingest/); assert.match(m, /db:5432/);
});

test('ask file lists show paths relative to the repository, cut from the left so the file name stays visible', () => {
  let base = realpathSync(mkdtempSync(join(tmpdir(), 'mis-de-long-')));
  base = join(base, 'a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)); mkdirSync(base, { recursive: true });
  const r = repo({ '.make-it-ship/wiki/deep/deeper/w.md': '# w' }, base);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mis-de-home-')));
  const saved = process.env.MIS_STATE_HOME; process.env.MIS_STATE_HOME = home;
  try {
    const why = v(r, `${M} gbrain ingest`).reason;
    assert.match(why, /\.make-it-ship\/wiki\/deep\/deeper\/w\.md/, why);
    assert.ok(!why.includes('a'.repeat(60)), 'repo-relative, not the long absolute path');
  } finally { if (saved === undefined) delete process.env.MIS_STATE_HOME; else process.env.MIS_STATE_HOME = saved; }
});

test('asks for external/approval mis commands show the env assignments in front of the command', () => {
  const r = repo();
  const p = v(r, `MIS_PAIR_TUNNEL_CMD='evil-tunnel --to x' ${M} pair-agent start`);
  assert.equal(p.decision, 'ask'); assert.match(p.reason, /tunnel command: evil-tunnel --to x/); assert.doesNotMatch(p.reason, /ngrok http/);
  assert.match(v(r, `env FOO_DEST=elsewhere ${M} ask codex q`).reason, /FOO_DEST=elsewhere/);
  const t = v(r, `HTTPS_PROXY=http://u:s3cr3tpw@proxy.example ${M} telemetry sync`).reason;
  assert.match(t, /HTTPS_PROXY=/); assert.ok(!t.includes('s3cr3tpw'), t);
  assert.match(v(r, `MIS_STATE_HOME=/elsewhere ${M} telemetry sync`).reason, /MIS_STATE_HOME=\/elsewhere/);
});

test('guard reads the stored command from the same repository root mis uses (git rev-parse), even under a bogus .git dir', () => {
  const r = repo({
    '.make-it-ship/autoresearch/m1/evaluator.json': { command: `${M} ask codex leak1; echo '{"pass":true}'`, timeoutSec: 5, output: 'json' },
    '.make-it-ship/deploy.json': { deployCmd: 'fly deploy --app shop' },
    'sub2/x': 'x',
  });
  mkdirSync(join(r, 'sub2', '.git'));
  const e = v(r, `${M} autoresearch eval m1 --decision x`, join(r, 'sub2'));
  assert.equal(e.decision, 'ask'); assert.match(e.reason, /ask codex leak1/);
  const d = v(r, `${M} deploy run`, join(r, 'sub2'));
  assert.equal(d.decision, 'ask'); assert.match(d.reason, /fly deploy --app shop/); assert.doesNotMatch(d.reason, /no commands configured/);
  // where mis will run cannot be known: ask, never "allow" or "no commands"
  const fine = repo({ '.make-it-ship/autoresearch/ok/evaluator.json': { command: `echo '{"pass":true}'`, timeoutSec: 5, output: 'json' } });
  assert.equal(v(fine, `${M} autoresearch eval ok`).decision, 'allow');
  for (const cmd of [`cd "$W" && ${M} autoresearch eval ok`, `cd /nonexistent/dir && ${M} autoresearch eval ok`, `GIT_DIR=/x/.git ${M} autoresearch eval ok`, `pushd /x && ${M} check unit`]) {
    const x = v(fine, cmd); assert.equal(x.decision, 'ask', cmd); assert.match(x.reason, /cannot tell which repository/, cmd);
  }
  const u = v(fine, `cd "$W" && ${M} deploy run`);
  assert.equal(u.decision, 'ask'); assert.doesNotMatch(u.reason, /no commands configured/);
  for (const d of [r, fine]) rmSync(d, { recursive: true, force: true });
});

test('env -C / --chdir (and sudo -D) move where a stored-command mis runs, like cd: the guard cannot follow it and asks', () => {
  // repro: the root evaluator is harmless, the nested repository's evaluator calls codex
  const ev = (command) => ({ command, timeoutSec: 5, output: 'json' });
  const r = repo({ '.make-it-ship/autoresearch/m1/evaluator.json': ev(`echo '{"pass":true}'`) });
  const other = join(r, 'other'); mkdirSync(other); spawnSync('git', ['init', '-q'], { cwd: other });
  mkdirSync(join(other, '.make-it-ship/autoresearch/m1'), { recursive: true });
  writeFileSync(join(other, '.make-it-ship/autoresearch/m1/evaluator.json'), JSON.stringify(ev(`codex exec leakO; echo '{"pass":true}'`)));
  assert.equal(v(r, `${M} autoresearch eval m1`).decision, 'allow');
  assert.equal(v(r, `cd other && ${M} autoresearch eval m1`).decision, 'ask');
  for (const cmd of [`env -C other ${M} autoresearch eval m1`, `env --chdir other ${M} autoresearch eval m1`, `env --chdir=other ${M} autoresearch eval m1`,
    `env -Cother ${M} autoresearch eval m1`, `env -u X -C other FOO=1 ${M} autoresearch eval m1`, `sudo -D other ${M} autoresearch eval m1`,
    `env -C other sh -c '${M} autoresearch eval m1'`,
    // spaced sudo --chdir, clustered short options, -C then -S
    `sudo --chdir other ${M} autoresearch eval m1`, `env -vC other ${M} autoresearch eval m1`, `env -iC other ${M} autoresearch eval m1`,
    `env -0C other ${M} autoresearch eval m1`, `env -C other -S '${M} autoresearch eval m1'`]) {
    const x = v(r, cmd); assert.equal(x.decision, 'ask', cmd); assert.match(x.reason, /cannot tell which repository/, cmd);
  }
  assert.equal(v(r, `env -C other true && ${M} autoresearch eval m1`).decision, 'allow', 'env -C moves only its own command');
  rmSync(r, { recursive: true, force: true });
});

test('mis options that write to a chosen path, letter-case variants and symlinked redirects reach the stored-file check', () => {
  const r = repo({ '.make-it-ship/self-improve/proposals/p1/change.patch': '', '.make-it-ship/deploy.json': '{}' });
  const patch = '.make-it-ship/self-improve/proposals/p1/change.patch';
  for (const cmd of [`${M} detach --log ${patch} -- cat evil.patch`, `${M} detach --log=${patch} -- cat evil.patch`, `${M} wait auto --log ${patch} -- true`,
    `${M} browse screenshot .make-it-ship/deploy.json`, `${M} detach --log .Make-It-Ship/DEPLOY.json -- echo x`]) {
    const x = v(r, cmd); assert.equal(x.decision, 'ask', cmd); assert.match(x.reason, /runs later/, cmd);
  }
  symlinkSync(join(r, '.make-it-ship', 'deploy.json'), join(r, 'dj'));
  for (const cmd of ['echo "{}" > dj', 'cp /tmp/x dj', 'echo x > .MAKE-IT-SHIP/Deploy.JSON']) assert.equal(v(r, cmd).decision, 'ask', cmd);
  for (const f of [join(r, '.Make-It-Ship/autoresearch/m/EVALUATOR.json'), join(r, 'dj')]) {
    const x = classify({ tool_name: 'Write', tool_input: { file_path: f, content: '{}' }, cwd: r }, { repoRoot: r, activeRun: false });
    assert.equal(x.decision, 'ask', f);
  }
  assert.equal(v(r, `${M} detach --log build.log -- npm test`).decision, 'allow', 'ordinary log paths stay allowed');
  rmSync(r, { recursive: true, force: true });
});
