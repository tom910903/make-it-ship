// mis commands of the always-on layer (M6): style level. Run-independent; state lives in home.mjs.
import { currentStyle, setStyle, normalizeStyle } from './style.mjs';
import { globalConfig, setGlobalConfig, homeDir, envSession } from './home.mjs';
import { detectKeywords, styleSwitch, learnedSkills, promptContext } from './keywords.mjs';
import { repoRoot } from './tree-hash.mjs';
import { readLoop, startLoop, cancelLoop } from './loop.mjs';
import { readHome, writeHome } from './home.mjs';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { routingChange, sectionDiff } from './routing.mjs';
import { readTimeline, timelineLog, timelineText, sessionKind } from './timeline.mjs';

function style([a, b]) {
  if (a === 'default') {
    const lvl = normalizeStyle(b);
    if (!lvl) throw new Error(`usage: mis style default <off|lite|full|ultra>`);
    setGlobalConfig({ style: { ...globalConfig().style, default: lvl } });
    return { default: lvl };
  }
  if (a !== undefined) return { level: setStyle(a, envSession()) };
  return { level: currentStyle(envSession()), default: globalConfig().style.default };
}

/** Dry run of the UserPromptSubmit router: what a prompt would trigger. Changes nothing. */
function testPrompt(args, cwd) {
  const prompt = args.join(' ');
  let root = null; try { root = repoRoot(cwd); } catch { /* not a repo */ }
  const matches = detectKeywords(prompt, { disabled: globalConfig().keywords.disabled });
  const style = styleSwitch(prompt), skills = learnedSkills(prompt, root, homeDir());
  return { matches: matches.map((m) => m.name), style, skills: skills.map((s) => s.name), context: promptContext(matches, style, skills) };
}

function loop([sub, ...rest], cwd) {
  if (sub === 'start') {
    let max = 20;
    if (rest[0] === '--max') { max = Number(rest[1]); rest = rest.slice(2); }
    return startLoop(cwd, rest.join(' ').trim(), max, envSession());
  }
  if (sub === 'cancel') return cancelLoop(cwd, envSession());
  if (sub === 'status' || sub === undefined) return readLoop(cwd);
  throw new Error('usage: mis loop start [--max N] <task> | status | cancel');
}

/** Freeze edits to one directory (absorbs gstack freeze); enforced by guard.mjs for Write/Edit. */
function freeze([d], cwd) {
  if (!d) return { freezeDir: readHome('freeze.json')?.dir ?? null };
  const abs = resolve(cwd, d);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`not a directory: ${d}`);
  const dir = realpathSync(abs);
  let root = null; try { root = realpathSync(repoRoot(cwd)); } catch { /* outside a repo: applies everywhere outside repos */ }
  writeHome('freeze.json', { dir, root, at: new Date().toISOString() });
  return { freezeDir: dir };
}

function unfreeze() {
  writeHome('freeze.json', null);
  return { freezeDir: null };
}

/** M9-F8: limit edits while debugging to the hypothesis' files/dirs (guard asks outside them, unlike freeze which denies). */
function debug([sub, ...rest], cwd) {
  if (sub !== 'scope') throw new Error('usage: mis debug scope <path…> | --clear');
  if (rest[0] === '--clear') { writeHome('debug-scope.json', null); return { debugScope: null }; }
  if (!rest.length) return { debugScope: readHome('debug-scope.json')?.paths ?? null };
  const paths = rest.map((p) => {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) throw new Error(`no such file or directory: ${p}`);
    return realpathSync(abs);
  });
  let root = null; try { root = realpathSync(repoRoot(cwd)); } catch { /* outside a repo */ }
  writeHome('debug-scope.json', { paths, root, at: new Date().toISOString() });
  return { debugScope: paths };
}

/** M9-F10: `mis setup routing` shows the project CLAUDE.md routing change; `--write` (guard asks) applies it. */
function setup([sub, ...rest], cwd) {
  if (sub !== 'routing') throw new Error('usage: mis setup routing [--write]');
  let root = cwd; try { root = repoRoot(cwd); } catch { /* not a repo: the current directory */ }
  const file = join(root, 'CLAUDE.md');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { next, old, changed } = routingChange(text);
  if (!changed) return `${file}: the Skill routing section is already current; nothing to change.`;
  if (!rest.includes('--write')) return `${file} (dry run, nothing written)\n${old ? 'replaces the existing "## Skill routing" section' : 'appends a "## Skill routing" section'}:\n\n${sectionDiff(old)}\n\nApply with: mis setup routing --write (after the user approves this change)`;
  writeFileSync(file, next);
  return { written: file, replaced: Boolean(old) };
}

/** M9-F9: project timeline (events outside runs). `mis timeline [--last N]`, `mis timeline log <event> [key=value…]`. */
function timeline([sub, ...rest], cwd) {
  if (sub === 'log') {
    const [event, ...kv] = rest;
    if (!event) throw new Error('usage: mis timeline log <event> [key=value…]');
    const extra = Object.fromEntries(kv.map((p) => [p.split('=')[0], p.split('=').slice(1).join('=')]).filter(([k]) => /^\w+$/.test(k) && !['at', 'event'].includes(k)));
    timelineLog(cwd, { ...extra, event, session: envSession(), kind: sessionKind() });
    return { logged: event };
  }
  if (sub !== undefined && sub !== '--last') throw new Error('usage: mis timeline [--last N] | log <event> [key=value…]');
  const n = sub === '--last' ? Number(rest[0]) : 50;
  return readTimeline(cwd).slice(-n).map((e) => `${e.at}  ${timelineText(e)}`).join('\n') || 'no timeline events';
}

export const alwaysCommands = { freeze, unfreeze, style, 'test-prompt': testPrompt, loop, debug, setup, timeline };
