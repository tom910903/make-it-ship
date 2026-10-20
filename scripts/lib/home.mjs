// Per-user state outside any repo (style level, global config, loop/freeze state of the always-on layer).
// Run state stays in <git-common-dir>/make-it-ship and is written only by mis.mjs; this is a separate tree.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const homeDir = () => process.env.MIS_STATE_HOME || join(homedir(), '.make-it-ship');

const DEFAULTS = { style: { default: 'full' }, keywords: { disabled: [] }, subagentMatcher: null };

export function readHome(name, fallback = null) {
  try { return JSON.parse(readFileSync(join(homeDir(), name), 'utf8')); } catch { return fallback; }
}

export function writeHome(name, value) {
  const p = join(homeDir(), name), tmp = `${p}.${process.pid}.tmp`;
  mkdirSync(dirname(p), { recursive: true });
  if (value === null) { rmSync(p, { force: true }); return; }
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, p);
}

/** Global config merged over defaults; a missing or broken file means defaults. */
export function globalConfig() {
  const c = readHome('config.json', {}) ?? {};
  return { ...DEFAULTS, ...c, style: { ...DEFAULTS.style, ...c.style }, keywords: { ...DEFAULTS.keywords, ...c.keywords } };
}

export function setGlobalConfig(patch) {
  const c = readHome('config.json', {}) ?? {};
  writeHome('config.json', { ...c, ...patch });
}

export const homeExists = () => existsSync(homeDir());

// Per-session memory (style level, hint counters); keyed by the host session id.
const sid = (id) => `sessions/${String(id || 'default').replace(/[^\w.-]/g, '_')}.json`;
export const readSession = (id) => readHome(sid(id), {}) ?? {};
export const writeSession = (id, s) => writeHome(sid(id), s);
/** The session a CLI call runs in (Claude Code sets it for Bash tool commands). */
export const envSession = () => process.env.CLAUDE_CODE_SESSION_ID || null;
