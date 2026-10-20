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
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID; // tests run inside a Claude Code session; never inherit its id
  Object.assign(env, opts.env);
  delete env.NODE_TEST_CONTEXT; // else a nested `node --test` check reports to this runner instead of failing
  const r = spawnSync(process.execPath, [MIS, ...args], { cwd, encoding: 'utf8', env, input: opts.input });
  let json; try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

/** Temp HOME with CLAUDE_CONFIG_DIR, MIS_STATE_HOME and a stub bin dir first on PATH: never the real ~/.claude or ~/.make-it-ship. */
export function fakeHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-')));
  const claude = join(home, '.claude'), state = join(home, '.make-it-ship'), bin = join(home, 'bin');
  mkdirSync(claude, { recursive: true }); mkdirSync(bin);
  const env = { HOME: home, CLAUDE_CONFIG_DIR: claude, MIS_STATE_HOME: state, CLAUDE_PLUGIN_ROOT: '', PATH: `${bin}:${process.env.PATH}` };
  return { home, claude, state, bin, env };
}
