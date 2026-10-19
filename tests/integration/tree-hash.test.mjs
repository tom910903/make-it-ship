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
