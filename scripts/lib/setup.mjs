// mis init (config detection) and mis doctor (environment checks). No run needed.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { CONFIG_FILE, loadConfig, validateConfig } from './config.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const has = (root, f) => existsSync(join(root, f));

/** @returns {{config:object|null, detected:string[], message:string}} */
export function detectConfig(root) {
  const checks = {};
  const detected = [];
  const pkg = readJson(join(root, 'package.json'));
  if (pkg?.scripts) {
    const pm = has(root, 'pnpm-lock.yaml') ? 'pnpm' : has(root, 'yarn.lock') ? 'yarn' : 'npm';
    const s = pkg.scripts;
    if (s.test && !/no test specified/.test(s.test)) checks.unit = { argv: [pm, 'test'], timeoutSec: 600 };
    for (const k of ['typecheck', 'lint', 'build']) if (s[k]) checks[k] = { argv: [pm, 'run', k], timeoutSec: 600 };
    detected.push(`package.json scripts (${pm})`);
  }
  if (!checks.unit) {
    const pyproject = has(root, 'pyproject.toml') ? readFileSync(join(root, 'pyproject.toml'), 'utf8') : '';
    const testDir = ['tests', 'test'].find((d) => has(root, d) && readdirSync(join(root, d)).some((f) => /^test_.*\.py$|_test\.py$/.test(f)));
    if (/pytest/.test(pyproject)) { checks.unit = { argv: ['python3', '-m', 'pytest', '-q'], timeoutSec: 600 }; detected.push('pyproject (pytest)'); }
    else if (testDir) { checks.unit = { argv: ['python3', '-m', 'unittest', 'discover', '-s', testDir, '-v'], timeoutSec: 600 }; detected.push(`python unittest (${testDir}/)`); }
  }
  if (!checks.unit && has(root, 'Makefile') && /^test:/m.test(readFileSync(join(root, 'Makefile'), 'utf8'))) { checks.unit = { argv: ['make', 'test'], timeoutSec: 600 }; detected.push('Makefile test target'); }
  if (!checks.unit && has(root, 'Cargo.toml')) { checks.unit = { argv: ['cargo', 'test'], timeoutSec: 900 }; detected.push('Cargo'); }
  if (!checks.unit && has(root, 'go.mod')) { checks.unit = { argv: ['go', 'test', './...'], timeoutSec: 900 }; detected.push('Go'); }
  if (!checks.unit && has(root, 'Package.swift')) { checks.unit = { argv: ['swift', 'test'], timeoutSec: 1200 }; detected.push('SwiftPM'); }
  if (!Object.keys(checks).length) {
    return { config: null, detected, message: 'No test or build command detected. Define checks in .make-it-ship.json by hand; until then verification is BLOCKED.' };
  }
  const names = Object.keys(checks);
  const config = { version: 1, checks, required: { quick: checks.unit ? ['unit'] : names, standard: names },
    limits: { maxAttemptsPerTask: 2, maxRuntimeMinutes: 120 } };
  const errs = validateConfig(config);
  if (errs.length) throw new Error(`internal: detected config invalid: ${errs.join('; ')}`);
  return { config, detected, message: 'Proposed .make-it-ship.json. Show it to the user; write with `mis init --write` after they confirm.' };
}

export function writeConfig(root, config) {
  const p = join(root, CONFIG_FILE);
  if (existsSync(p)) throw new Error(`${CONFIG_FILE} already exists; edit it instead`);
  writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
  return p;
}

const DUPLICATES = ['oh-my-claudecode', 'superpowers', 'ponytail', 'gstack'];

export function doctor(cwd) {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', status: major >= 22 ? 'ok' : 'error', detail: `node ${process.versions.node} (need >= 22)` });
  let root = null;
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a repo */ }
  checks.push({ name: 'git', status: root ? 'ok' : 'error', detail: root ?? 'not inside a git repository' });
  if (root) {
    const c = loadConfig(root);
    checks.push({ name: 'config', status: !c.exists ? 'warn' : c.errors.length ? 'error' : 'ok',
      detail: !c.exists ? `${CONFIG_FILE} missing (run mis init)` : c.errors.length ? c.errors.join('; ') : `${Object.keys(c.config.checks).length} check(s)` });
  }
  const home = homedir();
  const files = [join(home, '.claude', 'settings.json'), ...(root ? [join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')] : [])];
  const found = new Set();
  for (const f of files) {
    for (const [k, v] of Object.entries(readJson(f)?.enabledPlugins ?? {})) {
      const name = k.split('@')[0];
      if (v === true && DUPLICATES.includes(name)) found.add(name);
    }
  }
  if (existsSync(join(home, '.claude', 'skills', 'gstack'))) found.add('gstack (~/.claude/skills/gstack)');
  checks.push({ name: 'plugins', status: found.size ? 'warn' : 'ok',
    detail: found.size ? `overlapping plugins active: ${[...found].join(', ')}. Make It Ship works without them; their hooks may add duplicate prompts or reviews.` : 'no overlapping plugins' });
  return { ok: !checks.some((c) => c.status === 'error'), checks };
}
