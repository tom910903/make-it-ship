// HUD items (statusline.mjs): the parts after `MIS ▸ <run or idle>`, in the order of ~/.make-it-ship/config.json
// statusLine.items (set with mis hud). Each part shows only when it has a value; `br` starts a new status line row.
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
// `br` and the parts that came from the OMC HUD are opt-in (mis hud add) until the default set is decided.
const OPT_IN = new Set(['br', 'agents-list', 'bg', 'skill', 'calls', 'repo', 'git', 'apikey', 'prompt']);
export const DEFAULT_HUD_ITEMS = Object.keys(HUD_ITEMS).filter((k) => !OPT_IN.has(k));

/** Items list from config: an array of known names, or the default order. */
export const hudItems = (v) => (Array.isArray(v) ? v.filter((k) => k in HUD_ITEMS) : DEFAULT_HUD_ITEMS);
