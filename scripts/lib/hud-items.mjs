// HUD items (statusline.mjs): the parts after `MIS ▸ <run or idle>`. Each part shows only when it has a value; `br` starts
// a new status line row. What shows is a preset plus the user's changes to it (statusLine.preset/add/remove in
// ~/.make-it-ship/config.json), or a fixed list (preset `custom` with statusLine.items); mis hud and /make-it-ship:hud set them.
export const HUD_ITEMS = {
  style: 'coding style level (mis style)',
  loop: 'loop iteration / max while a loop runs',
  frozen: 'directory edits are frozen to (mis freeze)',
  agents: 'running subagents of this session (stale after 5 minutes)',
  'agents-list': 'a row per running subagent with its type and running time (3 at most, then +N more)',
  bg: 'background commands and agents still running (until their completion notice)',
  todo: 'todo list done / total',
  skill: 'last skill used this session',
  calls: 'tool / agent / skill calls this session (🔧 🤖 ⚡)',
  repo: 'repository name',
  branch: 'git branch',
  git: 'working tree changes: +staged !modified ?untracked ⇡ahead ⇣behind',
  pr: 'pull request of the branch and its review state',
  model: 'model name',
  effort: 'reasoning effort level (models that support it)',
  thinking: '"think" when the latest reply used extended thinking (before the first reply: while thinking is on)',
  fast: '"fast" while fast mode is on',
  ctx: 'context window use, 10-cell bar',
  '5h': '5-hour plan usage with time to reset',
  '7d': '7-day plan usage with time to reset',
  spend: 'spend limit use with dollars (gateway accounts)',
  apikey: 'where ANTHROPIC_API_KEY comes from (project, global or env), never the key',
  cost: 'session cost in USD',
  lines: 'lines added / removed this session',
  duration: 'session wall time; yellow after 1 hour or 70% context, red after 2 hours or 85%',
  prompt: 'time since the last prompt (as of the last status line refresh)',
  cache: 'prompt cache: time until it goes cold, and hit ratio',
  worktree: 'worktree name when the session runs in one',
  session: 'session name',
  agent: 'agent name when the session runs as one (--agent)',
  vim: 'vim mode when vim keys are on',
  'output-style': 'output style unless default',
  br: 'start a new status line row',
};

// 0.8.0's default (every part Claude Code passes in, one row): renderExtras' order when the caller names no items.
export const ONE_ROW_ITEMS = ['style', 'loop', 'frozen', 'agents', 'todo', 'branch', 'pr', 'model', 'effort', 'thinking', 'fast', 'ctx', '5h', '7d',
  'spend', 'cost', 'lines', 'duration', 'cache', 'worktree', 'session', 'agent', 'vim', 'output-style'];

const rows = (...r) => r.flatMap((row, i) => [...(i ? ['br'] : []), ...row.split(' ')]);
// full holds every part, and its order and rows are where an added part goes (place below). agents-list makes its own rows: last.
export const PRESETS = {
  minimal: rows('model effort fast ctx 5h 7d spend loop frozen agents todo'),
  focused: rows('model effort fast thinking ctx 5h 7d spend', 'branch git pr worktree duration prompt skill calls loop frozen agents bg todo agents-list'),
  full: rows('model effort fast thinking ctx 5h 7d spend cost cache', 'repo branch git pr worktree duration prompt lines skill calls loop frozen agents bg todo',
    'style apikey session agent vim output-style agents-list'),
};
export const DEFAULT_PRESET = 'focused';

// /make-it-ship:hud asks one multi-select question per group: at most 4 parts each (the question tool's limit).
export const HUD_GROUPS = {
  model: ['model', 'effort', 'thinking', 'fast'],
  usage: ['ctx', '5h', '7d', 'spend'],
  cost: ['cost', 'lines', 'cache', 'duration'],
  git: ['repo', 'branch', 'git', 'pr'],
  work: ['loop', 'agents', 'agents-list', 'todo'],
  activity: ['prompt', 'skill', 'calls', 'bg'],
  session: ['worktree', 'session', 'agent', 'output-style'],
  other: ['style', 'frozen', 'vim', 'apikey'],
};

// own names only: `toString` is not a part or a preset
export const isItem = (k) => typeof k === 'string' && Object.hasOwn(HUD_ITEMS, k);
export const isPreset = (p) => typeof p === 'string' && Object.hasOwn(PRESETS, p);

/** A fixed list: preset `custom`, or a 0.8.0 config that has only `items`. */
export const isCustom = (sl) => sl?.preset === 'custom' || (!sl?.preset && Array.isArray(sl?.items));
export const presetName = (sl) => (isCustom(sl) ? 'custom' : isPreset(sl?.preset) ? sl.preset : DEFAULT_PRESET);
const known = (v) => (Array.isArray(v) ? v.filter(isItem) : []);

// [row, position] of each part in the full preset
const SLOT = {};
{ let r = 0, i = 0; for (const k of PRESETS.full) { if (k === 'br') r++; else SLOT[k] = [r, i++]; } }

/** `list` with `k` next to its neighbours in the full preset: after the part before it in the same row, else before the part after it. */
function place(list, k) {
  const [row, pos] = SLOT[k];
  let prev = -1, next = -1;
  list.forEach((x, i) => { if (!SLOT[x]) return; if (SLOT[x][1] < pos) prev = i; else if (next < 0) next = i; });
  const at = prev >= 0 && SLOT[list[prev]][0] === row ? prev + 1
    : next >= 0 && SLOT[list[next]][0] === row ? next
      : prev >= 0 ? prev + 1 : next >= 0 ? next : list.length;
  return [...list.slice(0, at), k, ...list.slice(at)];
}

/** The parts to render, in order, from the statusLine config: the preset without `remove`, with `add` in place; or the custom list. */
export function resolveHudItems(sl) {
  if (isCustom(sl)) return known(sl.items);
  const remove = new Set(known(sl?.remove));
  let list = PRESETS[presetName(sl)].filter((k) => !remove.has(k));
  for (const k of known(sl?.add)) if (k !== 'br' && !remove.has(k) && !list.includes(k)) list = place(list, k);
  return list;
}
