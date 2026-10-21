// Small helpers shared by the M9-D command modules (argument parsing, project dirs, PATH lookup, JSON files).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './tree-hash.mjs';

export const fail = (msg) => { throw new Error(msg); };

/** Remove `--name value` (or `--name=value`) from args and return the value. */
export function flag(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  if (args[i].includes('=')) return args.splice(i, 1)[0].split('=').slice(1).join('=');
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}
/** Remove a boolean `--name` from args; true if it was there. */
export function bool(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

/** Environment for scripts mis runs from stored commands (checks, evaluator, benchmarks, deploy steps): with MIS_CLI set,
 *  a mis command inside them that the guard would ask about is refused (mis.mjs), since the guard cannot see it there. */
export const MIS_CLI_ENV = () => ({ ...process.env, MIS_CLI: fileURLToPath(new URL('../mis.mjs', import.meta.url)) });

export const rootOf = (cwd) => { try { return repoRoot(cwd); } catch { return cwd; } };
/** <repo>/.make-it-ship/<sub>: per-project working files (plain files in the working tree, like the wiki). */
export function projectDir(cwd, ...sub) {
  const d = join(rootOf(cwd), '.make-it-ship', ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}

export function which(name) {
  for (const d of (process.env.PATH ?? '').split(':')) if (d && existsSync(join(d, name))) return join(d, name);
  return null;
}

export const readJson = (p, fallback = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
export function writeJson(p, v) {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n');
  renameSync(tmp, p);
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** "30m", "90s", "2h", "1500ms" or a number of seconds → milliseconds. */
export function duration(v, what = 'duration') {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(v ?? ''));
  if (!m) fail(`${what} must look like 90s, 30m or 2h`);
  return Math.round(Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] ?? 's']);
}

/** Text from a file path, `-` (stdin) or the literal argument. */
export function textArg(cwd, arg) {
  if (arg === '-') return readFileSync(0, 'utf8');
  const p = join(cwd, arg);
  return arg && existsSync(arg.startsWith('/') ? arg : p) ? readFileSync(arg.startsWith('/') ? arg : p, 'utf8') : arg;
}
