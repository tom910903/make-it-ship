import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis, git, GUARD, passingReview } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

function setup(tasks) {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'shared.txt': 'base\n' });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'demo']));
  return dir;
}
function work(wt, task, files) {
  ok(mis(wt, ['task', task, 'start']));
  write(wt, files);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', `${task} work`);
  ok(mis(wt, ['task', task, 'done']));
}

test('parallel: independent tasks in isolated worktrees, merged back', () => {
  const dir = setup([
    { id: 'T1', title: 'a', acceptance: ['a'], files: ['a.txt'] },
    { id: 'T2', title: 'b', acceptance: ['b'], files: ['b.txt'] },
  ]);
  assert.deepEqual(ok(mis(dir, ['parallel', 'plan'])).waves, [['T1', 'T2']]);
  const w1 = ok(mis(dir, ['worktree', 'add', 'T1'])).path;
  const w2 = ok(mis(dir, ['worktree', 'add', 'T2'])).path;
  assert.ok(existsSync(w1) && existsSync(w2));
  assert.equal(git(dir, 'status', '--porcelain'), '', 'worktrees are not part of the main tree');
  work(w1, 'T1', { 'a.txt': 'A\n' });
  work(w2, 'T2', { 'b.txt': 'B\n' });
  assert.equal(ok(mis(dir, ['worktree', 'merge', 'T1'])).merged, true);
  assert.equal(ok(mis(dir, ['worktree', 'merge', 'T2'])).merged, true);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'A\n');
  assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'B\n');
  assert.ok(!existsSync(w1), 'worktree removed after merge');
});

test('conflict: overlapping edits are detected, the merge is aborted, the run stays PARTIAL', () => {
  const dir = setup([
    { id: 'T1', title: 'a', acceptance: ['a'], files: ['shared.txt'] },
    { id: 'T2', title: 'b', acceptance: ['b'], files: ['b.txt'] },
  ]);
  const w1 = ok(mis(dir, ['worktree', 'add', 'T1'])).path;
  const w2 = ok(mis(dir, ['worktree', 'add', 'T2'])).path;
  work(w1, 'T1', { 'shared.txt': 'from T1\n' });
  work(w2, 'T2', { 'b.txt': 'B\n', 'shared.txt': 'from T2 (outside its ownership)\n' });
  assert.equal(ok(mis(dir, ['worktree', 'merge', 'T1'])).merged, true);
  const r = ok(mis(dir, ['worktree', 'merge', 'T2']));
  assert.equal(r.merged, false);
  assert.deepEqual(r.conflicts, ['shared.txt']);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'main tree left clean (merge aborted)');
  assert.equal(readFileSync(join(dir, 'shared.txt'), 'utf8'), 'from T1\n');
  assert.ok(existsSync(w2), 'conflicting worktree kept for resolution');
  ok(mis(dir, ['check', 'unit']));
  write(dir, { '../rev.md': passingReview(dir) });
  ok(mis(dir, ['review', 'add', 'quality', '../rev.md']));
  const v = ok(mis(dir, ['verdict']));
  assert.equal(v.verdict, 'PARTIAL');
  assert.ok(v.reasons.some((x) => /T2.*not merged/.test(x)), v.reasons.join());
});

test('guard in a task worktree: edits outside the task\'s files ask', () => {
  const dir = setup([{ id: 'T1', title: 'a', acceptance: ['a'], files: ['a.txt'] }, { id: 'T2', title: 'b', acceptance: ['b'], files: ['b.txt'] }]);
  const w1 = ok(mis(dir, ['worktree', 'add', 'T1'])).path;
  const g = (p) => {
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(w1, p) }, cwd: w1 }), encoding: 'utf8' });
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(g('a.txt'), 'allow');
  assert.equal(g('b.txt'), 'ask', 'owned by T2');
});

test('worktree add requires a clean main tree and a startable task', () => {
  const dir = setup([{ id: 'T1', title: 'a', acceptance: ['a'], files: ['a.txt'] }]);
  write(dir, { 'dirty.txt': 'x' });
  assert.notEqual(mis(dir, ['worktree', 'add', 'T1']).code, 0);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'c');
  assert.notEqual(mis(dir, ['worktree', 'add', 'T9']).code, 0);
  ok(mis(dir, ['worktree', 'add', 'T1']));
  assert.notEqual(mis(dir, ['worktree', 'add', 'T1']).code, 0, 'only once');
});
