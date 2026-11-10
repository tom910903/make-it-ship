import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, git } from '../helpers.mjs';
import { treeHash } from '../../scripts/lib/tree-hash.mjs';

test('tree hash: stable, sensitive to edits and untracked files, ignores .gitignore and report dir', () => {
  const dir = makeRepo({ 'a.txt': 'a\n', '.gitignore': 'build/\n' });
  const h0 = treeHash(dir);
  assert.match(h0, /^[0-9a-f]{40}$/);
  assert.equal(treeHash(dir), h0, 'stable');

  write(dir, { 'build/out.bin': 'x' });
  assert.equal(treeHash(dir), h0, 'gitignored file ignored');

  write(dir, { 'docs/make-it-ship/r1/report.md': 'report' });
  assert.equal(treeHash(dir), h0, 'report dir excluded');

  write(dir, { 'new.txt': 'n' });
  const h1 = treeHash(dir);
  assert.notEqual(h1, h0, 'untracked file counts');
  rmSync(join(dir, 'new.txt'));
  assert.equal(treeHash(dir), h0);

  write(dir, { 'a.txt': 'changed\n' });
  assert.notEqual(treeHash(dir), h0, 'tracked edit counts');
});

test('tree hash: does not touch the real index, works from a subdirectory', () => {
  const dir = makeRepo({ 'src/x.js': '1' });
  write(dir, { 'src/x.js': '2', 'u.txt': 'u' });
  const statusBefore = git(dir, 'status', '--porcelain'); // refreshes stat cache first
  const before = readFileSync(join(dir, '.git', 'index'));
  const h = treeHash(join(dir, 'src'));
  assert.equal(treeHash(dir), h, 'subdir gives same whole-repo hash');
  assert.ok(readFileSync(join(dir, '.git', 'index')).equals(before), 'real index bytes unchanged');
  assert.equal(git(dir, 'status', '--porcelain'), statusBefore);
});

// ISSUE-002 (review 2026-11-10): plans and specs are inputs of a verification, so an edit to them must change the hash;
// what mis writes itself (reports, ledgers, retros) must not, or every report would stale its own evidence.
test('tree hash: plan and spec documents count, generated report files do not; the real index stays untouched', () => {
  const dir = makeRepo({ 'a.txt': 'a\n', 'docs/make-it-ship/plans/p.md': '# plan\n' });
  const h0 = treeHash(dir);
  write(dir, { 'docs/make-it-ship/r1/report.md': 'report', 'docs/make-it-ship/decisions.jsonl': '{}\n', 'docs/make-it-ship/retro-2026-11-10.md': 'r' });
  assert.equal(treeHash(dir), h0, 'generated files excluded');
  write(dir, { 'docs/make-it-ship/plans/p.md': '# plan\n- new criterion\n' });
  const h1 = treeHash(dir);
  assert.notEqual(h1, h0, 'a plan edit counts');
  write(dir, { 'docs/make-it-ship/specs/s-design.md': '# spec\n' });
  assert.notEqual(treeHash(dir), h1, 'a new spec counts');
  assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'nothing staged in the real index');
  const bare = makeRepo({ 'a.txt': 'a\n' });
  assert.match(treeHash(bare), /^[0-9a-f]{40}$/, 'works when plans/ and specs/ do not exist');
});

// Found while fixing ISSUE-002: with docs/make-it-ship in .gitignore the exclude pathspec named an ignored path and git add
// exited 1, so every check was BLOCKED. Ignored plans and specs still count: they are the inputs of the verification.
test('tree hash: works when docs/make-it-ship is gitignored, and its plans still count', () => {
  const dir = makeRepo({ 'a.txt': 'a\n', '.gitignore': 'docs/make-it-ship/\n' });
  write(dir, { 'docs/make-it-ship/plans/p.md': '# plan\n', 'docs/make-it-ship/r1/report.md': 'r' });
  const h0 = treeHash(dir);
  write(dir, { 'docs/make-it-ship/r1/report.md': 'r2' });
  assert.equal(treeHash(dir), h0, 'generated files excluded');
  write(dir, { 'docs/make-it-ship/plans/p.md': '# plan v2\n' });
  assert.notEqual(treeHash(dir), h0, 'an ignored plan edit still counts');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing staged or changed');
});
