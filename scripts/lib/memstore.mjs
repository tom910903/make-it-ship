// Global memory store (user decision 2026-11-10, like claude-mem): ~/.make-it-ship/memory/projects/<name>-<hash>/ holds one
// project's observations, memories, summaries and cursor. The project key is the git remote (origin first; scheme, userinfo,
// port and .git removed, lowercased) so every clone and worktree of one repository shares it; without a remote the main
// worktree's path, outside git the folder's path. Credentials in a remote URL never reach the key, the name or meta.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homeDir } from './home.mjs';

export const memoryRoot = () => join(homeDir(), 'memory');
const FILES = ['observations.jsonl', 'memories.jsonl', 'summaries.jsonl', 'memory-cursor.json'];
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** git@host:o/r.git, https://u:tok@host/o/r.git, ssh://git@host:22/o/r → host/o/r */
export function normalizeRemote(url) {
  let u = String(url).trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  // userinfo up to the last @ that a host follows (a password may hold unencoded @ or /)
  u = u.replace(/[?#].*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^.*@(?=[^@/:]+[/:])/, ''); // a query may hold another URL
  u = scheme ? u.replace(/^([^/:]+):\d*(?=\/)/, '$1') : u.replace(/^([^/:]+):/, '$1/');
  return u.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
}

/** Folder names this project goes by locally (claude-mem labels projects by the session's folder name). */
export function folderNames(cwd) {
  try { return [...new Set([basename(git(cwd, ['rev-parse', '--show-toplevel'])), basename(real(dirname(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])))))])]; }
  catch { return [basename(real(cwd))]; }
}

export function projectKey(cwd) {
  let common;
  try { common = git(cwd, ['rev-parse', '--git-common-dir']); } catch { const p = real(cwd); return { key: p, name: basename(p) || 'root' }; }
  let remotes = [];
  try { remotes = git(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$']).split('\n').filter(Boolean).map((l) => l.split(/\s+/)); } catch { /* no remote */ }
  const url = (remotes.find(([k]) => k === 'remote.origin.url') ?? remotes[0])?.[1];
  if (url) { const key = normalizeRemote(url); return { key, name: basename(key) || key }; }
  const root = real(dirname(resolve(cwd, common)));
  return { key: root, name: basename(root) };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9가-힯._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
export const dirFor = ({ key, name }) => join(memoryRoot(), 'projects', `${slug(name)}-${createHash('sha256').update(key).digest('hex').slice(0, 10)}`);
export const readMeta = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')); } catch { return null; } };
export const writeMeta = (dir, patch) => writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...readMeta(dir), ...patch }, null, 2) + '\n');

function move(from, to) {
  try { renameSync(from, to); } catch { copyFileSync(from, to); rmSync(from, { force: true }); } // another disk: copy then delete
}

/** The 0.6.0 stores (<git-common-dir>/make-it-ship/*, home/observations/<hash>.jsonl) move into a project dir that has none. */
function migrateLegacy(cwd, dir) {
  const found = [];
  try { const old = join(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])), 'make-it-ship'); for (const f of FILES) if (existsSync(join(old, f))) found.push([join(old, f), f]); } catch { /* outside git */ }
  const oldNonGit = join(homeDir(), 'observations', `${createHash('sha256').update(resolve(cwd)).digest('hex').slice(0, 16)}.jsonl`);
  if (existsSync(oldNonGit)) found.push([oldNonGit, 'observations.jsonl']);
  for (const [from, f] of found) if (!existsSync(join(dir, f))) move(from, join(dir, f));
}

/** This project's memory folder (created, with legacy files moved in, on first use). */
export function projectDir(cwd) {
  const k = projectKey(cwd), dir = dirFor(k);
  if (!existsSync(join(dir, 'meta.json'))) {
    mkdirSync(dir, { recursive: true });
    try { migrateLegacy(cwd, dir); } catch { /* best effort */ }
    // a remote added later: the memory kept under the repository's path moves along
    try {
      const root = real(dirname(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])))), byPath = dirFor({ key: root, name: basename(root) });
      if (k.key !== root && existsSync(byPath)) { for (const f of FILES) if (existsSync(join(byPath, f)) && !existsSync(join(dir, f))) move(join(byPath, f), join(dir, f)); rmSync(byPath, { recursive: true, force: true }); }
    } catch { /* outside git */ }
    writeMeta(dir, { key: k.key, name: k.name, created: new Date().toISOString() });
  }
  return dir;
}

export function listProjects() {
  const root = join(memoryRoot(), 'projects');
  if (!existsSync(root)) return [];
  return readdirSync(root).map((d) => ({ dir: join(root, d), meta: readMeta(join(root, d)) })).filter((p) => p.meta);
}
