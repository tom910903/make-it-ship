#!/usr/bin/env node
// HUD (Spec §14.2 hud, M6 §6.2): the one status line — run progress when a run exists, plus style level, loop,
// subagents (5 min = stale), todos, branch, model, context use and plan usage (5-hour / 7-day limits), and what Claude Code passes in (effort, cost, prompt cache, PR, ...); which parts and in what order is
// statusLine.items (mis hud). Absorbs the OMC HUD core and Ponytail's level badge. Registered by the user as statusLine.
// shortcut: recomputes the tree hash on every refresh; fine for small/medium repos, cache by index mtime if it gets slow.
import { pathToFileURL } from 'node:url';
import { verdict, evidenceStatus } from './lib/verdict.mjs';
import { DEFAULT_HUD_ITEMS, hudItems } from './lib/hud-items.mjs';

const MARK = { PASS: '✓', FAIL: '✗', STALE: '~', BLOCKED: '⊘', MISSING: '·' };
const MARK_COLOR = { PASS: 'green', FAIL: 'red', STALE: 'yellow', BLOCKED: 'red', MISSING: 'dim' };
const VERDICT_COLOR = { VERIFIED: 'green', PARTIAL: 'yellow', BLOCKED: 'red', FAILED: 'red' };
const SGR = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, magenta: 35, cyan: 36 };

/** ANSI painter; with color off it returns the text unchanged, so plain and colored lines read the same. */
const painter = (on) => (c, s) => (on ? `${c.split('+').map((k) => `\x1b[${SGR[k]}m`).join('')}${s}\x1b[0m` : s);
// Thresholds follow the OMC HUD: green below 70%, yellow below 85%, red above.
const level = (p) => (p >= 85 ? 'red' : p >= 70 ? 'yellow' : 'green');

export function renderHud(s, ctx, cost, color = false) {
  const c = painter(color);
  const tasks = s.plan?.tasks ?? [];
  const latest = new Map((s.evidence ?? []).map((e) => [e.check, e]));
  const checks = ctx.required.map((n) => {
    const st = latest.has(n) ? evidenceStatus(latest.get(n), ctx) : 'MISSING';
    return `${n}${c(MARK_COLOR[st], MARK[st])}`;
  }).join(' ');
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const usd = typeof cost?.total_cost_usd === 'number' ? ` · $${cost.total_cost_usd.toFixed(2)}` : '';
  const v = verdict(s, ctx).verdict;
  return `${c('bold+cyan', 'MIS ▸')} ${c('cyan', s.state)} · T${done}/${tasks.length} · ${checks || 'no checks'} · ${c(`${VERDICT_COLOR[v]}+bold`, v)}${usd}`;
}

/** 10-cell bar plus percentage, e.g. `ctx ████░░░░░░ 42%`, colored by threshold. */
function gauge(c, label, p, suffix = '') {
  const n = Math.min(10, Math.max(0, Math.round(p / 10)));
  return `${label} ${c(level(p), '█'.repeat(n))}${c('dim', '░'.repeat(10 - n))} ${c(level(p), `${Math.round(p)}%`)}${suffix}`;
}

/** Time until a rate-limit window resets (`resets_at` is Unix seconds), as `(3h42m)` or `(2d5h)`. */
function untilReset(resetsAt, now) {
  if (typeof resetsAt !== 'number') return '';
  const m = Math.max(0, Math.round((resetsAt * 1000 - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return ` (${d ? `${d}d${h}h` : `${h}h${m % 60}m`})`;
}

const limit = (c, label, w, now) => (typeof w?.used_percentage === 'number' ? gauge(c, label, w.used_percentage, untilReset(w.resets_at, now)) : null);

/** `42m`, `1h05m` from milliseconds. */
function span(ms) {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/**
 * The parts after the head, in `items` order (hud-items.mjs; `br` starts a new row). `host` is the Claude Code
 * statusLine input for the parts read straight from it (effort, cost, prompt cache, PR, ...).
 */
export function renderExtras({ style, loop, frozen, agents, todo, branch, model, ctxPct, limits, host = {}, items = DEFAULT_HUD_ITEMS, color = false, now = Date.now() }) {
  const c = painter(color);
  const cost = host.cost ?? {}, cache = host.prompt_cache, spend = limits?.spend_limit;
  const part = {
    style: () => (style && style !== 'off' ? `style ${c('magenta', style === 'ultra' ? 'ULTRA' : style)}` : null),
    loop: () => (loop?.active ? `loop ${c(level((loop.iteration / loop.max) * 100), `${loop.iteration}/${loop.max}`)}` : null),
    frozen: () => (frozen ? `frozen ${c('yellow', frozen)}` : null),
    agents: () => (agents?.running ? `agents ${c('cyan', agents.running)}${agents.stale ? ` ${c('yellow', `(${agents.stale} stale)`)}` : ''}` : null),
    todo: () => (todo?.total ? `todo ${c(todo.done === todo.total ? 'green' : 'cyan', `${todo.done}/${todo.total}`)}` : null),
    branch: () => (branch ? c('cyan', branch) : null),
    pr: () => (host.pr?.number ? `PR #${host.pr.number}${host.pr.review_state ? ` ${c(/approved/i.test(host.pr.review_state) ? 'green' : /changes/i.test(host.pr.review_state) ? 'red' : 'yellow', host.pr.review_state.toLowerCase().replace(/_/g, ' '))}` : ''}` : null),
    model: () => (model ? c('magenta', model) : null),
    effort: () => (host.effort?.level ? `effort ${c('cyan', host.effort.level)}` : null),
    thinking: () => (host.thinking?.enabled ? c('cyan', 'think') : null),
    fast: () => (host.fast_mode ? c('yellow', 'fast') : null),
    ctx: () => (ctxPct ? gauge(c, 'ctx', ctxPct) : null),
    '5h': () => limit(c, '5h', limits?.five_hour, now),
    '7d': () => limit(c, '7d', limits?.seven_day, now),
    spend: () => (typeof spend?.used_percentage === 'number'
      ? gauge(c, 'spend', spend.used_percentage, `${typeof spend.used_usd === 'number' && typeof spend.limit_usd === 'number' ? ` $${spend.used_usd.toFixed(2)}/$${spend.limit_usd.toFixed(2)}` : ''}${untilReset(spend.resets_at, now)}`)
      : null),
    cost: () => (typeof cost.total_cost_usd === 'number' ? `$${cost.total_cost_usd.toFixed(2)}` : null),
    lines: () => (cost.total_lines_added || cost.total_lines_removed ? `${c('green', `+${cost.total_lines_added ?? 0}`)} ${c('red', `-${cost.total_lines_removed ?? 0}`)}` : null),
    duration: () => (typeof cost.total_duration_ms === 'number' ? span(cost.total_duration_ms) : null),
    // expires_at is Unix seconds; hit_ratio is cache-read tokens over input tokens (0..1)
    cache: () => {
      if (!cache) return null;
      const left = cache.warm && typeof cache.expires_at === 'number' ? Math.max(0, cache.expires_at * 1000 - now) : 0;
      const ratio = typeof cache.hit_ratio === 'number' ? ` ${Math.round(cache.hit_ratio * 100)}%` : '';
      return `cache ${left ? c('green', span(left + 59999)) : c('dim', 'cold')}${ratio}`;
    },
    worktree: () => (host.worktree?.name ? `wt ${c('cyan', host.worktree.name)}` : null),
    session: () => (host.session_name ? c('cyan', host.session_name) : null),
    agent: () => (host.agent?.name ? `@${host.agent.name}` : null),
    vim: () => (host.vim?.mode ? `vim ${host.vim.mode}` : null),
    'output-style': () => (host.output_style?.name && host.output_style.name !== 'default' ? `out ${host.output_style.name}` : null),
  };
  const rows = [[]];
  for (const k of items) {
    if (k === 'br') rows.push([]);
    else { const p = part[k]?.(); if (p) rows.at(-1).push(p); }
  }
  return [rows[0].map((p) => ` · ${p}`).join(''), ...rows.slice(1).filter((r) => r.length).map((r) => r.join(' · '))].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = '';
    for await (const c of process.stdin) raw += c;
    const input = raw ? JSON.parse(raw) : {};
    const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
    const color = !process.env.NO_COLOR; // https://no-color.org
    const part = async (f) => { try { return await f(); } catch { return null; } };
    const { currentStyle } = await import('./lib/style.mjs');
    const { readLoop } = await import('./lib/loop.mjs');
    const { contextPercent } = await import('./lib/context.mjs');
    const { execFileSync } = await import('node:child_process');
    const config = await part(async () => (await import('./lib/home.mjs')).globalConfig());
    const items = hudItems(config?.statusLine?.items);
    const run = await part(async () => (await import('./lib/state.mjs')).loadRun(cwd));
    const head = run && run.state.state !== 'CANCELLED'
      ? renderHud(run.state, (await import('./lib/commands.mjs')).verdictContext(run, cwd), items.includes('cost') ? null : input.cost, color)
      : `${painter(color)('bold+cyan', 'MIS ▸')} idle`;
    const extras = renderExtras({
      style: await part(() => currentStyle(input.session_id)),
      loop: await part(() => { const l = readLoop(cwd); return !l.session || !input.session_id || l.session === input.session_id ? l : null; }),
      branch: await part(() => execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()),
      agents: await part(async () => (await import('./lib/tracking.mjs')).agentCounts(input.session_id)),
      todo: await part(async () => (await import('./lib/tracking.mjs')).todoCounts((await import('./lib/home.mjs')).readSession(input.session_id).todos)),
      model: input.model?.display_name,
      ctxPct: input.context_window?.used_percentage ?? contextPercent(input.transcript_path),
      limits: input.rate_limits,
      host: input,
      items,
      color,
      frozen: await part(async () => {
        const f = (await import('./lib/home.mjs')).readHome('freeze.json');
        const { realpathSync } = await import('node:fs');
        let root = null; try { root = realpathSync((await import('./lib/tree-hash.mjs')).repoRoot(cwd)); } catch { /* outside a repo */ }
        if (!f?.dir || (f.root ?? null) !== root) return null;
        const dir = f.dir;
        const { relative } = await import('node:path');
        const rel = root ? relative(root, dir) : dir;
        return rel && !rel.startsWith('..') ? rel : dir;
      }),
    });
    // statusLine.chain: keep another status line (e.g. the one you had before) after ours, fed the same input.
    const chain = config?.statusLine?.chain;
    let tail = '';
    if (chain && !process.env.MIS_STATUSLINE_CHAINED) {
      const r = await part(() => execFileSync('sh', ['-c', chain], { input: raw, encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, MIS_STATUSLINE_CHAINED: '1' } }));
      if (r?.trim()) tail = ` | ${r.trim().split('\n')[0]}`;
    }
    const [first, ...more] = extras.split('\n');
    console.log([head + first + tail, ...more].join('\n'));
  } catch { /* a status line must never break the session; print nothing */ }
}
