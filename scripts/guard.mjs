#!/usr/bin/env node
// PreToolUse hook entry (Spec §7). Prints a decision only for ask/deny; errors fail closed (ask).
import { execFileSync } from 'node:child_process';
import { classify } from './lib/policy.mjs';
import { loadRun } from './lib/state.mjs';

const out = (permissionDecision, permissionDecisionReason) =>
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));

function context(cwd) {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const run = loadRun(cwd);
    let currentBranch = null;
    try { currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* detached */ }
    const plan = run?.state.plan;
    // Plan scope applies while the plan is being executed; after the report, edits are new work (remote writes still ask).
    const executing = ['PLANNING', 'AWAITING_APPROVAL', 'EXECUTING', 'VERIFYING'].includes(run?.state.state);
    const plannedFiles = executing && plan?.plannedFiles ? [...plan.plannedFiles, ...plan.tasks.flatMap((t) => t.files ?? [])] : null;
    return { repoRoot, activeRun: !!run && run.state.state !== 'CANCELLED', currentBranch, plannedFiles };
  } catch {
    return { repoRoot: cwd, activeRun: false, currentBranch: null }; // not a git repo
  }
}

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const cwd = input.cwd || process.cwd();
  const r = classify(input, context(cwd));
  if (r.decision !== 'allow') out(r.decision, r.reason);
} catch (e) {
  out('ask', `make-it-ship guard error (fail-closed): ${e.message}`);
}
