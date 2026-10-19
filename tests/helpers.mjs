// Test helpers: throwaway git repos in the OS temp dir (never this project's .git).
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIS = join(ROOT, 'scripts', 'mis.mjs');
export const GUARD = join(ROOT, 'scripts', 'guard.mjs');

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export function makeRepo(files = { 'README.md': '# demo\n' }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mis-test-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

export function write(dir, files) {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), typeof c === 'string' ? c : JSON.stringify(c, null, 2));
  }
}

/** Run mis CLI; returns {code, out, err, json} */
export function mis(cwd, args, opts = {}) {
  const r = spawnSync(process.execPath, [MIS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...opts.env }, input: opts.input });
  let json; try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
