// Dependency-manifest change detection since the run's base commit (AC#7).
import { execFileSync } from 'node:child_process';

/** @returns {string[]} manifest paths that differ between baseCommit and the given tree */
export function changedManifests(cwd, baseCommit, tree, manifests) {
  const specs = manifests.map((m) => `:(glob)**/${m}`);
  const base = baseCommit ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git's empty tree
  const out = execFileSync('git', ['diff', '--name-only', base, tree, '--', ...specs], { cwd, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}
