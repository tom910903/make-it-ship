// Working-tree hash (Spec §5.4): stage everything into a throwaway index, write-tree.
// Includes untracked files, respects .gitignore, never touches the user's index.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPORT_DIR = 'docs/make-it-ship';

export const repoRoot = (cwd) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();

export function treeHash(cwd) {
  const top = repoRoot(cwd);
  const tmp = mkdtempSync(join(tmpdir(), 'mis-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    execFileSync('git', ['add', '-A', '--', '.', `:(exclude)${REPORT_DIR}`], { cwd: top, env, stdio: 'pipe' });
    return execFileSync('git', ['write-tree'], { cwd: top, env, encoding: 'utf8' }).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
