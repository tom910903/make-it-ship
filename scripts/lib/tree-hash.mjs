// Working-tree hash: stage everything into a throwaway index, write-tree.
// Includes untracked files, respects .gitignore (but plans and specs always count), never touches the user's index.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPORT_DIR = 'docs/make-it-ship';
// Inputs of a verification inside REPORT_DIR (review 2026-11-10, ISSUE-002): an edit to a plan or spec stales the evidence.
// Everything else there is written by mis itself (reports, ledgers, retros) and stays out, or reporting would stale it.
export const INPUT_DIRS = ['plans', 'specs'].map((d) => `${REPORT_DIR}/${d}`);

// stderr is captured (kept in the error), never inherited: hooks outside a repository must not print git's fatal line.
export const repoRoot = (cwd) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

export function treeHash(cwd) {
  const top = repoRoot(cwd);
  const tmp = mkdtempSync(join(tmpdir(), 'mis-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    // not an exclude pathspec: naming a gitignored REPORT_DIR there makes git add exit 1
    execFileSync('git', ['add', '-A', '--', '.'], { cwd: top, env, stdio: 'pipe' });
    execFileSync('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', REPORT_DIR], { cwd: top, env, stdio: 'pipe' });
    const inputs = INPUT_DIRS.filter((d) => existsSync(join(top, d))); // a pathspec that matches nothing is fatal
    if (inputs.length) execFileSync('git', ['add', '-A', '-f', '--', ...inputs], { cwd: top, env, stdio: 'pipe' }); // -f: inputs count even when ignored
    return execFileSync('git', ['write-tree'], { cwd: top, env, encoding: 'utf8' }).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
