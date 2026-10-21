#!/usr/bin/env node
// PreToolUse hook entry (Spec §7). Prints a decision only for ask/deny; errors fail closed (ask).
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { classify } from './lib/policy.mjs';
import { loadRun } from './lib/state.mjs';

const TEAM_WORKER = Boolean(process.env.MIS_TEAM_ID);
const out = (permissionDecision, permissionDecisionReason) =>
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));

function context(cwd) {
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const run = loadRun(cwd);
    let currentBranch = null;
    try { currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* detached */ }
    const plan = run?.state.plan;
    // Plan scope applies until the report (incl. a limit BLOCK that may be lifted); after the report, edits are new work
    // (remote writes still ask). In a task worktree (branch mis/<run>/<task>) the scope is that task's files only.
    const inScope = ['PLANNING', 'AWAITING_APPROVAL', 'EXECUTING', 'VERIFYING', 'BLOCKED'].includes(run?.state.state);
    const wt = currentBranch?.match(/^mis\/([^/]+)\/(.+)$/);
    const wtTask = wt && run?.state.runId === wt[1] ? plan?.tasks.find((t) => t.id === wt[2]) : null;
    // Plan scope = top-level plannedFiles plus every task's files (a plan with only task files is scoped too).
    const planFiles = [...(plan?.plannedFiles ?? []), ...(plan?.tasks ?? []).flatMap((t) => t.files ?? [])];
    const plannedFiles = !inScope ? null : wtTask ? (wtTask.files ?? []) : planFiles.length ? planFiles : null;
    // A team worker (MIS_TEAM_ID, set by `mis team` for its worker processes) gets run-level rules: push/PR/install ask.
    return { repoRoot, inRepo: true, activeRun: (!!run && run.state.state !== 'CANCELLED') || TEAM_WORKER, currentBranch, plannedFiles };
  } catch {
    return { repoRoot: cwd, activeRun: TEAM_WORKER, currentBranch: null }; // not a git repo
  }
}

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const cwd = (typeof input.cwd === 'string' && input.cwd) || process.cwd();
  // A file edit is scoped by the worktree that holds the file, not by the session cwd (main session editing a task worktree)
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  let at = file ? resolve(cwd, String(file)) : cwd;
  while (file && !existsSync(at) && dirname(at) !== at) at = dirname(at);
  if (file && existsSync(at) && !statSync(at).isDirectory()) at = dirname(at);
  // only another worktree of the same repo; .git/ internals or a nested repo keep the session's context
  const gitDir = (d) => { try { return execFileSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[1]; } catch { return null; } };
  const own = file ? gitDir(at) : null;
  // A freeze belongs to the repository it was set in (or to non-repo paths when set outside one).
  const ctx = context(own && own === gitDir(cwd) ? at : cwd);
  let freezeDir = null, debugScope = null, sessionRoot = cwd; // the session's repository (CLAUDE.md outside it asks)
  try {
    const f = (await import('./lib/home.mjs')).readHome('freeze.json');
    const { realpathSync } = await import('node:fs');
    // Scope by the session's repository (cwd), not the target file's: a frozen session may not write anywhere else.
    const sessionCtx = context(cwd);
    sessionRoot = sessionCtx.repoRoot;
    const root = sessionCtx.inRepo ? realpathSync(sessionCtx.repoRoot) : null;
    if (f?.dir && (f.root ?? null) === root) freezeDir = f.dir;
    const s = (await import('./lib/home.mjs')).readHome('debug-scope.json');
    if (s?.paths?.length && (s.root ?? null) === root) debugScope = s.paths;
  } catch { /* no home */ }
  // M9-B: scan the commits a push would send for secrets; the result goes into the push ask (never blocks silently).
  let pushScan = null;
  // Parsed commands, not raw text: a heredoc body (a review that mentions git push) must not trigger a git log -p.
  const isPush = (c) => c.argv[0]?.endsWith('git') && c.argv.includes('push');
  if (input.tool_name === 'Bash' && ctx.inRepo && /\bpush\b/.test(String(input.tool_input?.command ?? ''))
      && (await import('./lib/shell.mjs')).commandsOf(String(input.tool_input.command)).commands.some(isPush)) {
    try { pushScan = (await import('./lib/redact.mjs')).prePushScan(ctx.repoRoot); } catch (e) { pushScan = { error: e.message.split('\n')[0].slice(0, 120) }; }
  }
  const r = classify(input, { ...ctx, freezeDir, debugScope, pushScan, sessionRoot });
  try { (await import('./lib/trace.mjs')).appendTrace({ cwd, hook: 'PreToolUse', tool: input.tool_name, decision: r.decision, reason: r.reason }); } catch { /* tracing is optional */ }
  if (r.decision !== 'allow') out(r.decision, r.reason);
} catch (e) {
  out('ask', `make-it-ship guard error (fail-closed): ${e.message}`);
}
