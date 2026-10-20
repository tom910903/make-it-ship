// mis commands of the always-on layer (M6): style level. Run-independent; state lives in home.mjs.
import { currentStyle, setStyle, normalizeStyle } from './style.mjs';
import { globalConfig, setGlobalConfig, homeDir } from './home.mjs';
import { detectKeywords, styleSwitch, learnedSkills, promptContext } from './keywords.mjs';
import { repoRoot } from './tree-hash.mjs';
import { readLoop, startLoop, endLoop } from './loop.mjs';
import { readHome, writeHome } from './home.mjs';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function style([a, b]) {
  if (a === 'default') {
    const lvl = normalizeStyle(b);
    if (!lvl) throw new Error(`usage: mis style default <off|lite|full|ultra>`);
    setGlobalConfig({ style: { ...globalConfig().style, default: lvl } });
    return { default: lvl };
  }
  if (a !== undefined) return { level: setStyle(a) };
  return { level: currentStyle(), default: globalConfig().style.default };
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
    return startLoop(cwd, rest.join(' ').trim(), max);
  }
  if (sub === 'cancel') return endLoop(cwd, 'cancelled');
  if (sub === 'status' || sub === undefined) return readLoop(cwd);
  throw new Error('usage: mis loop start [--max N] <task> | status | cancel');
}

/** Freeze edits to one directory (absorbs gstack freeze); enforced by guard.mjs for Write/Edit. */
function freeze([d], cwd) {
  if (!d) return { freezeDir: readHome('freeze.json')?.dir ?? null };
  const abs = resolve(cwd, d);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`not a directory: ${d}`);
  const dir = realpathSync(abs);
  writeHome('freeze.json', { dir, at: new Date().toISOString() });
  return { freezeDir: dir };
}

function unfreeze() {
  writeHome('freeze.json', null);
  return { freezeDir: null };
}

export const alwaysCommands = { freeze, unfreeze, style, 'test-prompt': testPrompt, loop };
