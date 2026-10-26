// Verdict rules (Spec §6). The model never decides the verdict; this function does.

/** Effective status of one evidence record against the current tree/config. */
export function evidenceStatus(e, { treeHash, configHash }) {
  if (e.status === 'BLOCKED') return 'BLOCKED';
  if (e.treeHash !== treeHash || e.configHash !== configHash) return 'STALE';
  return e.status;
}

const latestBy = (items, key) => {
  const m = new Map();
  for (const it of items) m.set(it[key], it);
  return m;
};

export const PLAN_REVIEWS = ['plan-critic', 'product']; // gate plan approval (bound to the plan hash), not the code verdict

/** Latest code review per kind that was made on the current tree. */
export function currentReviews(state, treeHash) {
  return latestBy((state.reviews ?? []).filter((r) => r.treeHash === treeHash && !PLAN_REVIEWS.includes(r.kind)), 'kind');
}

export function requiredReviews(state) {
  const kinds = state.mode === 'quick' ? ['quality'] : ['spec', 'quality'];
  if ((state.riskFlags ?? []).length) kinds.push('security');
  return kinds;
}

/**
 * @param state run state
 * @param ctx {treeHash, configHash, required: string[], dependencyChanged: boolean}
 * @returns {{verdict:'VERIFIED'|'PARTIAL'|'BLOCKED'|'FAILED', reasons:string[], checks:Record<string,string>}}
 */
export function verdict(state, ctx) {
  const latest = latestBy(state.evidence ?? [], 'check');
  const checks = {};
  for (const name of ctx.required) checks[name] = latest.has(name) ? evidenceStatus(latest.get(name), ctx) : 'MISSING';
  const req = Object.entries(checks);
  const blocked = req.filter(([, s]) => s === 'BLOCKED').map(([n]) => n);
  const failed = req.filter(([, s]) => s === 'FAIL').map(([n]) => n);
  const reviews = currentReviews(state, ctx.treeHash);
  const blockingReviews = [...reviews.values()].filter((r) => r.blocking > 0);

  if (state.state === 'BLOCKED') return { verdict: 'BLOCKED', reasons: [`run blocked: ${state.blockedReason ?? 'unknown'}`], checks };
  if (blocked.length && !failed.length) return { verdict: 'BLOCKED', reasons: blocked.map((n) => `required check ${n} could not run`), checks };

  const fails = [
    ...failed.map((n) => `required check ${n} failed`),
    ...blockingReviews.map((r) => `${r.kind} review has ${r.blocking} blocking issue(s)`),
  ];
  if (fails.length) return { verdict: 'FAILED', reasons: fails, checks };

  const partial = [];
  if (!state.mode) partial.push('mode not set');
  if (!ctx.required.length) partial.push('no required checks defined: nothing was machine-verified');
  const tasks = state.plan?.tasks;
  if (!tasks) partial.push('no plan');
  else for (const t of tasks) if (t.status !== 'DONE') partial.push(`task ${t.id} is ${t.status}`);
  for (const [n, s] of req) if (s === 'STALE' || s === 'MISSING') partial.push(`required check ${n} is ${s === 'STALE' ? 'stale (code or config changed)' : 'not run'}`);
  for (const k of requiredReviews(state)) if (!reviews.has(k)) partial.push(`${k} review missing for current code`);
  for (const q of state.interview ?? []) if (q.impact === 'HIGH' && !q.answer) partial.push(`HIGH ambiguity ${q.id} unresolved`);
  for (const [id, w] of Object.entries(state.worktrees ?? {})) {
    if (!w.merged) partial.push(`task ${id} worktree not merged${w.conflicts?.length ? ` (conflicts: ${w.conflicts.join(', ')})` : ''}`);
  }
  if (ctx.configChangedUnapproved) {
    partial.push(state.state === 'REPORTED'
      ? '.make-it-ship.json changed after the report: a reported run is final (only a later code review reopens it) — start a follow-up run (mis start) to verify with the new config'
      : '.make-it-ship.json changed during the run without approval (ask the user: mis approve config)');
  }
  if (ctx.dependencyChanged && !(state.notes ?? []).some((n) => n.kind === 'dep')) partial.push('dependency manifest changed without a recorded reason (mis note dep)');
  if (partial.length) return { verdict: 'PARTIAL', reasons: partial, checks };

  return { verdict: 'VERIFIED', reasons: [], checks };
}
