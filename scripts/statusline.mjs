#!/usr/bin/env node
// HUD (Spec §14.2 hud): one status line for the current run. Registered by the user as settings.json statusLine.
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = '';
    for await (const c of process.stdin) raw += c;
    const input = raw ? JSON.parse(raw) : {};
    const cwd = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
    const { loadRun } = await import('./lib/state.mjs');
    const run = loadRun(cwd);
    if (run && run.state.state !== 'CANCELLED') {
      const { verdictContext } = await import('./lib/commands.mjs');
      console.log(renderHud(run.state, verdictContext(run, cwd), input.cost));
    }
  } catch { /* a status line must never break the session; print nothing */ }
}
