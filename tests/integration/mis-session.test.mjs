// M8-B project session manager (absorbs OMC project-session-manager/psm): worktrees for issues, PRs and features.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, existsSync, mkdtempSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, git } from '../helpers.mjs';

const HAS_TMUX = spawnSync('sh', ['-c', 'command -v tmux']).status === 0;
const SOCKET = `mis-test-s${process.pid}`;
const env = { MIS_TMUX_SOCKET: SOCKET, TMUX: '' };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const tmux = (...a) => spawnSync('tmux', ['-L', SOCKET, ...a], { encoding: 'utf8' });
after(() => { if (HAS_TMUX) tmux('kill-server'); rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, SOCKET), { force: true }); });

test('feature and issue sessions: own worktree and branch, listed, removed (branch kept), dirty ones refused', () => {
  const dir = makeRepo();
  const f = ok(mis(dir, ['session', 'create', 'feature', 'Login Page!'], { env }));
  assert.deepEqual([f.name, f.branch, f.path], ['feat-login-page', 'feature/login-page', join(dir, '.worktrees', 'feat-login-page')]);
  assert.ok(existsSync(join(f.path, 'README.md')));
  git(dir, 'commit', '--allow-empty', '-qm', 'second');
  const i = ok(mis(dir, ['session', 'create', 'issue', '42', '--base', 'HEAD~1'], { env }));
  assert.deepEqual([i.name, i.branch], ['issue-42', 'fix/42']);
  assert.equal(git(i.path, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', 'HEAD~1'), 'base ref honored');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'session worktrees are not part of the main tree');
  assert.match(mis(dir, ['session', 'create', 'feature', 'login page'], { env }).err, /already exists/);
  assert.match(mis(dir, ['session', 'create', 'issue', 'abc'], { env }).err, /usage/);
  const list = ok(mis(dir, ['session', 'list'], { env }));
  assert.deepEqual(list.map((s) => s.name).sort(), ['feat-login-page', 'issue-42']);
  writeFileSync(join(i.path, 'wip.txt'), 'x');
  assert.equal(ok(mis(dir, ['session', 'list'], { env })).find((s) => s.name === 'issue-42').dirty, true);
  const r = mis(dir, ['session', 'remove', 'issue-42'], { env });
  assert.equal(r.code, 1);
  assert.match(r.err, /uncommitted changes/);
  assert.ok(existsSync(join(i.path, 'wip.txt')), 'uncommitted work is never deleted');
  const rm = ok(mis(dir, ['session', 'remove', 'feat-login-page'], { env }));
  assert.equal(rm.removed, true);
  assert.ok(!existsSync(f.path));
  assert.equal(git(dir, 'branch', '--list', 'feature/login-page').trim(), 'feature/login-page', 'branch kept');
  assert.match(mis(dir, ['session', 'remove', 'nope'], { env }).err, /no session/);
});

test('pr session fetches refs/pull/<n>/head from the remote (a git read) into a review branch', () => {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), 'mis-origin-')));
  git(origin, 'init', '-q', '--bare');
  const src = makeRepo({ 'a.txt': 'main\n' });
  git(src, 'push', '-q', origin, 'main');
  git(src, 'checkout', '-qb', 'contrib');
  writeFileSync(join(src, 'a.txt'), 'pr change\n');
  git(src, 'commit', '-qam', 'pr work');
  const prSha = git(src, 'rev-parse', 'HEAD');
  git(src, 'push', '-q', origin, 'contrib');
  git(origin, 'update-ref', 'refs/pull/7/head', prSha);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mis-clone-')));
  git(dir, 'clone', '-q', origin, '.');
  const p = ok(mis(dir, ['session', 'create', 'pr', '7'], { env }));
  assert.deepEqual([p.name, p.branch], ['pr-7', 'pr-7-review']);
  assert.equal(git(p.path, 'rev-parse', 'HEAD'), prSha);
  assert.match(mis(dir, ['session', 'create', 'pr', '99'], { env }).err, /could not fetch/);
  writeFileSync(join(p.path, 'review.txt'), 'note\n');
  git(p.path, 'add', '-A');
  git(p.path, 'commit', '-qm', 'local review commit');
  const mine = git(p.path, 'rev-parse', 'HEAD');
  ok(mis(dir, ['session', 'remove', 'pr-7'], { env }));
  assert.match(mis(dir, ['session', 'create', 'pr', '7'], { env }).err, /could not fetch/, 'refuses to overwrite local review commits');
  assert.equal(git(dir, 'rev-parse', 'pr-7-review'), mine);
});

test('--tmux opens a tmux session in the worktree (real tmux) or reports BLOCKED without tmux', () => {
  const dir = makeRepo();
  const r = mis(dir, ['session', 'create', 'feature', 'ui', '--tmux'], { env });
  if (!HAS_TMUX) { assert.match(r.err, /BLOCKED: tmux is not installed/); return; }
  const s = ok(r);
  assert.equal(s.tmux, 'mis-feat-ui');
  assert.equal(tmux('display-message', '-p', '-t', s.tmux, '#{pane_current_path}').stdout.trim(), s.path);
  ok(mis(dir, ['session', 'remove', 'feat-ui'], { env }));
  assert.notEqual(tmux('has-session', '-t', s.tmux).status, 0, 'tmux session closed on remove');
});

test('M8 D9: session --tmux without tmux says BLOCKED for the session, not for a team', () => {
  const dir = makeRepo();
  const bin = mkdtempSync(join(tmpdir(), 'mis-notmux-'));
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  const r = mis(dir, ['session', 'create', 'feature', 'nt', '--tmux'], { env: { ...env, PATH: bin } });
  rmSync(bin, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.err, /BLOCKED: tmux is not installed/);
  assert.doesNotMatch(r.err, /team/);
});
