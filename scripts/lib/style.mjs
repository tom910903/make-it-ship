// Always-on coding style (absorbs Ponytail levels; see THIRD_PARTY_NOTICES.md). Injected by hooks.mjs at
// SessionStart and SubagentStart; the level lives in the per-user home (home.mjs), not in the repo.
import { globalConfig, readHome, writeHome } from './home.mjs';

export const STYLE_LEVELS = ['off', 'lite', 'full', 'ultra'];
const ALIASES = { normal: 'off', stop: 'off', none: 'off', default: 'full', on: 'full' };

export function normalizeStyle(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return STYLE_LEVELS.includes(s) ? s : ALIASES[s] ?? null;
}

const LEVEL_LINE = {
  lite: '- **lite**: build what was asked; when a smaller option exists, name it in one line and let the user pick.',
  full: '- **full**: apply the rules above as written.',
  ultra: '- **ultra**: also question the request itself — before building, push back on any part the need does not justify.',
};

/** Model-facing rules for a level; '' when off. */
export function styleRules(level) {
  const lvl = normalizeStyle(level) ?? 'full';
  if (lvl === 'off') return '';
  return `MAKE IT SHIP STYLE — level: ${lvl}
Switch with \`/make-it-ship:style lite|full|ultra|off\` (or say "normal mode" to turn it off).

Write the smallest complete change. Solve the whole problem with the least new code, and end each reply with one or two lines: what you skipped or did not check, and any risk the user must know.

Before writing: read the task and the code it touches, and list every place the change must reach (callers, tests, fixtures, config, exports) and what it could break for users. That is the scope; extra features are not.

Take the first option that fully works:
1. Does it need to exist? Skip options and flexibility nobody asked for; name them in one line.
2. Already in this codebase? Reuse it the way the surrounding code does.
3. Standard library or platform feature? Use it, unless the project has its own.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. One line a reader gets at a glance? One line.
6. Otherwise the minimum code that works.

- Be lazy about the solution, never about the change: finish callers, tests and fixtures the change breaks.
- No abstraction, wrapper, option, config or "for later" code nobody asked for. Deletion beats addition. Keep the codebase's structure and conventions.
- Comment only the why the code cannot show. A shortcut with a known limit gets \`shortcut: <the limit>, <when to upgrade>\`.
- Bug fix: find every caller first, then fix the root cause once in the shared code.
- New non-trivial logic leaves one small test or assert-based self-check.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything the user asked for.

Level:
${LEVEL_LINE[lvl]}`;
}

/** Session level: explicit `mis style <lvl>` choice, else the configured default. */
export function currentStyle() {
  return normalizeStyle(readHome('style.json')?.level) ?? normalizeStyle(globalConfig().style.default) ?? 'full';
}

export function setStyle(level) {
  const lvl = normalizeStyle(level);
  if (!lvl) throw new Error(`unknown style level "${level}" (use ${STYLE_LEVELS.join('|')})`);
  writeHome('style.json', { level: lvl, at: new Date().toISOString() });
  return lvl;
}
