#!/usr/bin/env node
// HUD (Spec §14.2 hud, M6 §6.2): the one status line — run progress when a run exists, plus style level, loop,
// subagents (5 min = stale), todos, branch, model, context use and plan usage (5-hour / 7-day limits) (absorbs the OMC HUD core and Ponytail's level badge). Registered by the user as statusLine.
// shortcut: recomputes the tree hash on every refresh; fine for small/medium repos, cache by index mtime if it gets slow.
import { pathToFileURL } from 'node:url';
import { verdict, evidenceStatus } from './lib/verdict.mjs';

const MARK = { PASS: '✓', FAIL: '✗', STALE: '~', BLOCKED: '⊘', MISSING: '·' };

export function renderHud(s, ctx, cost) {
  const tasks = s.plan?.tasks ?? [];
  const latest = new Map((s.evidence ?? []).map((e) => [e.check, e]));
  const checks = ctx.required.map((n) => `${n}${MARK[latest.has(n) ? evidenceStatus(latest.get(n), ctx) : 'MISSING']}`).join(' ');
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const usd = typeof cost?.total_cost_usd === 'number' ? ` · $${cost.total_cost_usd.toFixed(2)}` : '';
  return `MIS ▸ ${s.state} · T${done}/${tasks.length} · ${checks || 'no checks'} · ${verdict(s, ctx).verdict}${usd}`;
}

const pct = (w) => (typeof w?.used_percentage === 'number' ? `${Math.round(w.used_percentage)}%` : null);

export function renderExtras({ style, loop, frozen, agents, todo, branch, model, ctxPct, limits }) {
  return [
    style && style !== 'off' ? `style ${style === 'ultra' ? 'ULTRA' : style}` : null,
    loop?.active ? `loop ${loop.iteration}/${loop.max}` : null,
    frozen ? `frozen ${frozen}` : null,
    agents?.running ? `agents ${agents.running}${agents.stale ? ` (${agents.stale} stale)` : ''}` : null,
    todo?.total ? `todo ${todo.done}/${todo.total}` : null,
    branch || null,
    model || null,
    ctxPct ? `ctx ${ctxPct}%` : null,
    pct(limits?.five_hour) && `5h ${pct(limits.five_hour)}`,
    pct(limits?.seven_day) && `7d ${pct(limits.seven_day)}`,
  ].filter(Boolean).map((p) => ` · ${p}`).join('');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = '';
    for await (const c of process.stdin) raw += c;
    const input = raw ? JSON.parse(raw) : {};
    const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
    const part = async (f) => { try { return await f(); } catch { return null; } };
    const { currentStyle } = await import('./lib/style.mjs');
    const { readLoop } = await import('./lib/loop.mjs');
    const { contextPercent } = await import('./lib/context.mjs');
    const { execFileSync } = await import('node:child_process');
    const run = await part(async () => (await import('./lib/state.mjs')).loadRun(cwd));
    const head = run && run.state.state !== 'CANCELLED'
      ? renderHud(run.state, (await import('./lib/commands.mjs')).verdictContext(run, cwd), input.cost)
      : 'MIS ▸ idle';
    const extras = renderExtras({
      style: await part(() => currentStyle(input.session_id)),
      loop: await part(() => { const l = readLoop(cwd); return !l.session || !input.session_id || l.session === input.session_id ? l : null; }),
      branch: await part(() => execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()),
      agents: await part(async () => (await import('./lib/tracking.mjs')).agentCounts(input.session_id)),
      todo: await part(async () => (await import('./lib/tracking.mjs')).todoCounts((await import('./lib/home.mjs')).readSession(input.session_id).todos)),
      model: input.model?.display_name,
      ctxPct: contextPercent(input.transcript_path),
      limits: input.rate_limits,
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
    const chain = await part(async () => (await import('./lib/home.mjs')).globalConfig().statusLine?.chain);
    let tail = '';
    if (chain && !process.env.MIS_STATUSLINE_CHAINED) {
      const r = await part(() => execFileSync('sh', ['-c', chain], { input: raw, encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, MIS_STATUSLINE_CHAINED: '1' } }));
      if (r?.trim()) tail = ` | ${r.trim().split('\n')[0]}`;
    }
    console.log(head + extras + tail);
  } catch { /* a status line must never break the session; print nothing */ }
}
