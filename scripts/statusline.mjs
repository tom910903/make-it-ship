#!/usr/bin/env node
// HUD (Spec §14.2 hud, M6 §6.2): the one status line — run progress when a run exists, plus style level, loop,
// branch, model and context use (absorbs the OMC HUD core and Ponytail's level badge). Registered by the user as statusLine.
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

export function renderExtras({ style, loop, frozen, branch, model, ctxPct }) {
  return [
    style && style !== 'off' ? `style ${style === 'ultra' ? 'ULTRA' : style}` : null,
    loop?.active ? `loop ${loop.iteration}/${loop.max}` : null,
    frozen ? `frozen ${frozen}` : null,
    branch || null,
    model || null,
    ctxPct ? `ctx ${ctxPct}%` : null,
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
      model: input.model?.display_name,
      ctxPct: contextPercent(input.transcript_path),
      frozen: await part(async () => {
        const dir = (await import('./lib/home.mjs')).readHome('freeze.json')?.dir;
        if (!dir) return null;
        const { relative } = await import('node:path');
        const rel = relative((await import('./lib/tree-hash.mjs')).repoRoot(cwd), dir);
        return rel && !rel.startsWith('..') ? rel : dir;
      }),
    });
    // statusLine.chain: keep another status line (e.g. the one you had before) after ours, fed the same input.
    const chain = await part(async () => (await import('./lib/home.mjs')).globalConfig().statusLine?.chain);
    let tail = '';
    if (chain) {
      const r = await part(() => execFileSync('sh', ['-c', chain], { input: raw, encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }));
      if (r?.trim()) tail = ` | ${r.trim().split('\n')[0]}`;
    }
    console.log(head + extras + tail);
  } catch { /* a status line must never break the session; print nothing */ }
}
