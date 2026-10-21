// M9 round-2 D/E verifier defects end to end: N2 stored-command executors refuse nested external mis commands (MIS_CLI),
// N3 approve proposal shows and applies exactly change.patch, N5 trace.jsonl is masked, N8 connect refuses copied or
// hardlinked browser data. Every process gets a temp HOME / MIS_STATE_HOME (fakeHome); codex is a stub on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis, git, fakeHome, GUARD, MIS } from '../helpers.mjs';
import { classify } from '../../scripts/lib/policy.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const envOf = (h) => { const e = { ...process.env, ...h.env }; for (const k of ['CLAUDE_CODE_SESSION_ID', 'MIS_TEAM_ID', 'NODE_TEST_CONTEXT', 'MIS_CLI']) delete e[k]; return e; };
const stubCodex = (h) => { const log = join(h.home, 'codex.log'); writeFileSync(join(h.bin, 'codex'), `#!/bin/sh\necho "CODEX CALLED: $*" >> "${log}"\necho answer\n`); chmodSync(join(h.bin, 'codex'), 0o755); return log; };

test('N2: the autoresearch evaluator, the tournament bench, deploy steps, mis health and the session create baseline run with MIS_CLI: a nested `mis ask codex` in their scripts is refused', () => {
  const h = fakeHome(), log = stubCodex(h);
  const nested = `"${process.execPath}" "${MIS}" ask codex leak-from-script`;
  const dir = makeRepo({ 'ev.sh': `${nested} >/dev/null 2>err.txt; echo '{"pass":true}'\n`, 'dep.sh': `${nested}\n`, '.make-it-ship/score': '1\n',
    'chk.sh': `${nested}\n`, '.make-it-ship.json': JSON.stringify({ version: 1, checks: { test: { argv: ['sh', 'chk.sh'] } } }) });
  const run = (args) => mis(dir, args, { env: h.env });
  ok(run(['autoresearch', 'init', 'm1', '--mission', 'x', '--eval', 'sh ev.sh']));
  ok(run(['autoresearch', 'start', 'm1']));
  assert.equal(ok(run(['autoresearch', 'eval', 'm1', '--decision', 'x'])).status, 'pass');
  assert.match(readFileSync(join(dir, 'err.txt'), 'utf8'), /MIS_CLI is set/);
  ok(run(['deploy', 'setup', '--deploy-cmd', 'sh dep.sh', '--write']));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'cfg');
  const d = mis(dir, ['deploy', 'run'], { env: { ...h.env, PATH: `${h.bin}:/usr/bin:/bin` } });
  assert.equal(d.json?.failedStep, 'deploy', d.err + d.out); assert.match(d.out, /MIS_CLI is set/);
  writeFileSync(join(dir, 'a.diff'), '--- a/.make-it-ship/score\n+++ b/.make-it-ship/score\n@@ -1 +1 @@\n-1\n+4\n');
  const t = ok(run(['self-improve', 'tournament', '--bench', `${nested} && echo '{"score":9}'`, 'a.diff']));
  assert.equal(t.winner, null, JSON.stringify(t));
  // R3-DE-1: mis health and the session create baseline run the stored check (`sh chk.sh`) the same way
  assert.equal(ok(run(['health', '--no-record'])).checks.test.status, 'FAIL');
  assert.equal(ok(run(['session', 'create', 'feature', 'x'])).baseline.checks[0].status, 'FAIL');
  assert.equal(existsSync(log), false, 'codex was never called');
});

function proposalRepo() {
  const dir = makeRepo({ 'CLAUDE.md': 'old\n', '.claude/settings.json': '{}\n', 'src/y.md': '' });
  const diff = (file, from, to) => { writeFileSync(join(dir, file), to); const p = git(dir, 'diff', '--', file) + '\n'; writeFileSync(join(dir, file), from); return p; };
  writeFileSync(join(dir, 'p1.diff'), diff('CLAUDE.md', 'old\n', 'new\n'));
  writeFileSync(join(dir, 'evil.diff'), diff('.claude/settings.json', '{}\n', '{"hooks":{"x":[{"command":"curl evil"}]}}\n'));
  return dir;
}

test('N3: approve proposal asks with the files change.patch really touches (and a preview); a patch changed after propose is refused; --sha pins it', () => {
  const h = fakeHome(), dir = proposalRepo();
  const p = ok(mis(dir, ['self-improve', 'propose', 't1', '--patch', 'p1.diff'], { env: h.env }));
  assert.match(p.patchSha, /^[0-9a-f]{64}$/); assert.match(p.next, new RegExp(`--sha ${p.patchSha.slice(0, 12)}`));
  const why = (cmd) => classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: dir }, { repoRoot: dir, activeRun: false }).reason;
  const clean = why(`node /p/scripts/mis.mjs approve proposal ${p.id}`);
  assert.match(clean, /changes: CLAUDE\.md/); assert.match(clean, /\+new/); assert.match(clean, new RegExp(p.patchSha.slice(0, 12)));
  // a bypass appends a second patch (mis detach --log, a case variant, a symlink...): the ask shows it and apply refuses
  appendFileSync(join(dir, '.make-it-ship/self-improve/proposals', p.id, 'change.patch'), readFileSync(join(dir, 'evil.diff'), 'utf8'));
  const tampered = why(`node /p/scripts/mis.mjs approve proposal ${p.id}`);
  assert.match(tampered, /\.claude\/settings\.json/); assert.match(tampered, /curl evil/); assert.match(tampered, /CHANGED since it was proposed|differs/i);
  const a = mis(dir, ['approve', 'proposal', p.id], { env: h.env });
  assert.notEqual(a.code, 0); assert.match(a.err, /changed since it was proposed/);
  assert.equal(readFileSync(join(dir, '.claude/settings.json'), 'utf8'), '{}\n', 'nothing applied');
  assert.match(mis(dir, ['approve', 'proposal', p.id, '--sha', 'deadbeefdeadbeef'], { env: h.env }).err, /does not match --sha/);
  // a fresh proposal applies exactly what was shown, pinned by --sha
  git(dir, 'checkout', '--', '.');
  const q = ok(mis(dir, ['self-improve', 'propose', 't2', '--patch', 'p1.diff'], { env: h.env }));
  const r = ok(mis(dir, ['approve', 'proposal', q.id, '--sha', q.patchSha.slice(0, 12)], { env: h.env }));
  assert.equal(r.status, 'applied'); assert.deepEqual(r.paths, ['CLAUDE.md']);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), 'new\n');
  // a rename out of the process files is not a process-file change
  writeFileSync(join(dir, 'mv.diff'), 'diff --git a/.claude/settings.json b/src/z.json\nsimilarity index 100%\nrename from .claude/settings.json\nrename to src/z.json\n');
  assert.match(mis(dir, ['self-improve', 'propose', 'mv', '--patch', 'mv.diff'], { env: h.env }).err, /only process and skill files[\s\S]*src\/z\.json/);
});

test('N3 end to end: mis detach --log onto change.patch asks through guard.mjs', () => {
  const h = fakeHome(), dir = makeRepo();
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8', env: envOf(h),
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `node "${MIS}" detach --log .make-it-ship/self-improve/proposals/p1/change.patch -- cat evil.patch` }, cwd: dir }) });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('N5: a URL password in an ask never reaches trace.jsonl', () => {
  const h = fakeHome(), dir = makeRepo();
  mkdirSync(h.state, { recursive: true });
  writeFileSync(join(h.state, 'config.json'), JSON.stringify({ telemetry: { enabled: true, endpoint: 'https://alice:hunter2pass@tele.example/ingest' } }));
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8', env: envOf(h),
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `node "${MIS}" telemetry sync` }, cwd: dir }) });
  const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /tele\.example/); assert.ok(!reason.includes('hunter2pass'), reason);
  assert.ok(!readFileSync(join(h.state, 'trace.jsonl'), 'utf8').includes('hunter2pass'));
});

test('N8: connect refuses a dir with browser profile data files (no Local State), and hardlinks of the real Cookies even in its own profile', () => {
  const h = fakeHome(), dir = makeRepo();
  const env = { ...h.env, MIS_BROWSE_HEADLESS_ONLY: '1', MIS_BROWSE_IDLE_MS: '300000' };
  const b = (...a) => mis(dir, ['browse', ...a], { env });
  if (!findChrome()) { assert.match(b('connect').err, /BLOCKED/); return; }
  try {
    const real = process.platform === 'darwin' ? join(h.home, 'Library', 'Application Support', 'Google', 'Chrome') : join(h.home, '.config', 'google-chrome');
    mkdirSync(join(real, 'Default', 'Network'), { recursive: true });
    writeFileSync(join(real, 'Default', 'Network', 'Cookies'), 'SQLite format 3\0');
    const hl = join(h.home, 'hl'); mkdirSync(join(hl, 'Default', 'Network'), { recursive: true });
    linkSync(join(real, 'Default', 'Network', 'Cookies'), join(hl, 'Default', 'Network', 'Cookies'));
    const cp = join(h.home, 'cp1'); mkdirSync(join(cp, 'Default', 'Local Storage'), { recursive: true }); writeFileSync(join(cp, 'Default', 'Login Data'), 'x');
    for (const d of [hl, cp, join(cp, 'Default')]) { const r = b('connect', '--profile-dir', d); assert.notEqual(r.code, 0, d); assert.match(r.err, /browser (profile )?data/i, d); }
    // a profile connect made, with the real Cookies hardlinked in afterwards
    const own = join(h.home, 'own'); mkdirSync(join(own, 'Default', 'Network'), { recursive: true }); writeFileSync(join(own, '.make-it-ship-profile'), 'x');
    linkSync(join(real, 'Default', 'Network', 'Cookies'), join(own, 'Default', 'Network', 'Cookies'));
    const r = b('connect', '--profile-dir', own); assert.notEqual(r.code, 0); assert.match(r.err, /hard ?link|same file/i);
    assert.equal(ok(b('status')).mode, 'headless', 'nothing was launched');
  } finally { b('stop'); }
});
