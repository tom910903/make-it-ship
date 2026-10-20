// mis commands of the always-on layer (M6): style level. Run-independent; state lives in home.mjs.
import { currentStyle, setStyle, normalizeStyle } from './style.mjs';
import { globalConfig, setGlobalConfig, homeDir } from './home.mjs';
import { detectKeywords, styleSwitch, learnedSkills, promptContext } from './keywords.mjs';
import { repoRoot } from './tree-hash.mjs';

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

export const alwaysCommands = { style, 'test-prompt': testPrompt };
