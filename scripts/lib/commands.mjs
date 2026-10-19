// mis subcommands (Spec §8). Every state change goes through mutate(): lock → change → atomic save + event.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { loadConfig, requiredChecks } from './config.mjs';
import { createRun, loadRun, saveState, withLock, transition, TERMINAL } from './state.mjs';
import { treeHash, repoRoot } from './tree-hash.mjs';
import { validatePlan, hashPlan } from './plan.mjs';

const MODES = ['quick', 'standard', 'full'];
const REVIEW_KINDS = ['plan-critic', 'product', 'spec', 'quality', 'security', 'design'];
const LEVEL_ORDER = { HIGH: 3, MED: 2, LOW: 1 };

export const fail = (msg) => { throw new Error(msg); };
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function requireRun(cwd) {
  const run = loadRun(cwd);
  if (!run) fail('no active run (start one with `mis start --input <file|text>`)');
  return run;
}

function mutate(cwd, fn) {
  const run = requireRun(cwd);
  return withLock(run, () => {
    const fresh = loadRun(cwd, run.state.runId); // re-read under lock
    Object.assign(run, fresh, { reclaimedLock: run.reclaimedLock });
    const { event, result } = fn(run);
    saveState(run, event);
    return result;
  });
}

function needState(run, allowed, what) {
  if (!allowed.includes(run.state.state)) fail(`${what} is not allowed in state ${run.state.state}`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

function readJsonArg(cwd, arg) {
  if (!arg) fail('missing JSON argument');
  const p = resolve(cwd, arg);
  const text = existsSync(p) ? readFileSync(p, 'utf8') : arg;
  try { return JSON.parse(text); } catch (e) { return fail(`invalid JSON: ${e.message}`); }
}

const hashes = (cwd) => ({ treeHash: treeHash(cwd), configHash: loadConfig(repoRoot(cwd)).configHash });

function needsApproval(s) { return s.mode !== 'quick' || s.riskFlags.length > 0; }

/** After plan/mode change: raise mode for risk, and settle PLANNING ⇄ AWAITING_APPROVAL. */
function settle(s) {
  if (s.riskFlags.length && s.mode === 'quick') {
    s.mode = 'standard';
    s.modeReasons.push(`raised to standard: risk flags ${s.riskFlags.join(', ')}`);
  }
  const want = s.plan && s.mode && needsApproval(s) ? 'AWAITING_APPROVAL' : 'PLANNING';
  if (s.state !== want) transition(s, want);
}

function openAmbiguities(s, cwd) {
  const cfg = loadConfig(repoRoot(cwd)).config;
  const min = LEVEL_ORDER[cfg?.interview.threshold ?? 'HIGH'];
  return s.interview.filter((q) => !q.answer && LEVEL_ORDER[q.impact] >= min);
}

/** Gates shared by `approve plan` and the quick-mode direct start. */
function executionGates(s, cwd) {
  if (!s.plan) fail('no plan (mis plan set <file>)');
  if (!s.mode) fail('mode not set (mis mode set <quick|standard|full> --reason <text>)');
  if (s.mode !== 'quick') {
    const critic = s.reviews.filter((r) => r.kind === 'plan-critic' && r.planHash === s.planHash).at(-1);
    if (!critic) fail('plan-critic review for the current plan is missing (mis review add plan-critic <file>)');
    if (critic.blocking > 0) fail(`plan-critic review has ${critic.blocking} blocking issue(s); revise the plan`);
  }
  const open = openAmbiguities(s, cwd);
  if (open.length) fail(`unresolved ambiguity: ${open.map((q) => `${q.id} (${q.impact}) ${q.question}`).join('; ')}`);
}

// ---------------------------------------------------------------- commands

function start(args, cwd) {
  const input = flag(args, '--input');
  if (!input) fail('usage: mis start --input <file|text>');
  const root = repoRoot(cwd);
  const prev = loadRun(cwd);
  if (prev && !TERMINAL.includes(prev.state.state)) fail(`active run ${prev.state.runId} is ${prev.state.state}; resume it or \`mis cancel\` first`);
  const cfg = loadConfig(root);
  if (cfg.errors.length) fail(`.make-it-ship.json invalid: ${cfg.errors.join('; ')}`);
  const p = resolve(cwd, input);
  const inp = existsSync(p) && !input.includes('\n')
    ? { kind: 'file', ref: relative(root, p), sha256: sha256(readFileSync(p)) }
    : { kind: 'text', text: input };
  let baseCommit = null;
  try { baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no commits yet */ }
  const run = createRun(cwd, { input: inp, baseCommit, configHash: cfg.configHash, maxRuntimeMinutes: cfg.config?.limits.maxRuntimeMinutes ?? 120 });
  return { runId: run.state.runId, state: run.state.state, config: cfg.exists ? 'ok' : 'missing (run `mis init`)' };
}

function plan([sub, file], cwd) {
  if (sub !== 'set' || !file) fail('usage: mis plan set <json-file>');
  const p = readJsonArg(cwd, file);
  const errs = validatePlan(p);
  if (errs.length) fail(`plan invalid: ${errs.join('; ')}`);
  return mutate(cwd, (run) => {
    const s = run.state;
    needState(run, ['PLANNING', 'AWAITING_APPROVAL'], 'plan set');
    s.plan = { ...p, tasks: p.tasks.map((t) => ({ ...t, status: 'TODO', attempts: 0 })) };
    s.planHash = hashPlan(p);
    s.riskFlags = p.riskFlags ?? [];
    settle(s);
    return { event: { type: 'plan', planHash: s.planHash, tasks: p.tasks.length }, result: { state: s.state, planHash: s.planHash, mode: s.mode } };
  });
}

function mode([sub, m, ...rest], cwd) {
  const reason = flag(rest, '--reason');
  if (sub !== 'set' || !MODES.includes(m)) fail('usage: mis mode set <quick|standard|full> --reason <text>');
  if (!reason) fail('--reason is required');
  return mutate(cwd, (run) => {
    const s = run.state;
    needState(run, ['PLANNING', 'AWAITING_APPROVAL'], 'mode set');
    if (m === 'quick' && s.riskFlags.length) fail(`risk flags (${s.riskFlags.join(', ')}) require standard or full`);
    s.mode = m;
    s.modeReasons = [reason];
    settle(s);
    return { event: { type: 'mode', mode: m, reason }, result: { mode: m, state: s.state } };
  });
}

function interview([sub, ...rest], cwd) {
  if (sub === 'add') {
    const q = readJsonArg(cwd, rest[0]);
    if (typeof q.question !== 'string' || !q.question.trim()) fail('interview item needs "question"');
    if (!LEVEL_ORDER[q.impact]) fail('interview item needs "impact": HIGH|MED|LOW');
    return mutate(cwd, (run) => {
      const s = run.state;
      if (TERMINAL.includes(s.state)) fail(`run is ${s.state}`);
      const item = { id: `Q${s.interview.length + 1}`, question: q.question, impact: q.impact, why: q.why ?? null, answer: null };
      s.interview.push(item);
      return { event: { type: 'interview-add', id: item.id, impact: item.impact }, result: item };
    });
  }
  if (sub === 'resolve') {
    const [id, ...answer] = rest;
    if (!id || !answer.length) fail('usage: mis interview resolve <id> <answer>');
    return mutate(cwd, (run) => {
      const q = run.state.interview.find((x) => x.id === id);
      if (!q) fail(`no interview item ${id}`);
      q.answer = answer.join(' ');
      return { event: { type: 'interview-resolve', id }, result: q };
    });
  }
  return fail('usage: mis interview <add <json>|resolve <id> <answer>>');
}

function approve([what], cwd) {
  if (what !== 'plan') fail('usage: mis approve plan');
  return mutate(cwd, (run) => {
    const s = run.state;
    needState(run, ['PLANNING', 'AWAITING_APPROVAL'], 'approve plan');
    executionGates(s, cwd);
    const h = hashes(cwd);
    s.approvals.push({ action: 'plan', ...h, planHash: s.planHash, at: new Date().toISOString() });
    transition(s, 'EXECUTING');
    return { event: { type: 'approve', action: 'plan', ...h }, result: { state: s.state } };
  });
}

/** Strict review header: `BLOCKING: n` and `MAJOR: n` must each appear exactly once. */
export function parseReview(text) {
  const count = (key) => {
    const m = [...text.matchAll(new RegExp(`^${key}:[ \\t]*(\\d+)[ \\t]*$`, 'gm'))];
    if (m.length !== 1) fail(`review must contain exactly one "${key}: <number>" line (found ${m.length})`);
    return Number(m[0][1]);
  };
  return { blocking: count('BLOCKING'), major: count('MAJOR') };
}

function review([sub, kind, file], cwd) {
  if (sub !== 'add' || !REVIEW_KINDS.includes(kind) || !file) fail(`usage: mis review add <${REVIEW_KINDS.join('|')}> <md-file>`);
  const src = resolve(cwd, file);
  if (!existsSync(src)) fail(`review file not found: ${file}`);
  const counts = parseReview(readFileSync(src, 'utf8'));
  return mutate(cwd, (run) => {
    const s = run.state;
    if (TERMINAL.includes(s.state)) fail(`run is ${s.state}`);
    const n = s.reviews.length + 1;
    mkdirSync(join(run.dir, 'reviews'), { recursive: true });
    const dest = `reviews/${n}-${kind}.md`;
    copyFileSync(src, join(run.dir, dest));
    const rec = { kind, treeHash: treeHash(cwd), planHash: s.planHash, ...counts, file: dest, at: new Date().toISOString() };
    s.reviews.push(rec);
    return { event: { type: 'review', kind, ...counts }, result: rec };
  });
}

function task([id, action], cwd) {
  if (!id || !['start', 'done', 'fail'].includes(action)) fail('usage: mis task <id> <start|done|fail>');
  return mutate(cwd, (run) => {
    const s = run.state;
    const t = s.plan?.tasks.find((x) => x.id === id);
    if (!t) fail(`no task ${id} in plan`);
    if (action === 'start') {
      if (s.state === 'PLANNING' || s.state === 'AWAITING_APPROVAL') {
        if (needsApproval(s)) fail(`plan approval required before execution (mode ${s.mode ?? 'unset'}${s.riskFlags.length ? ', risk flags' : ''}): mis approve plan`);
        executionGates(s, cwd);
        transition(s, 'EXECUTING');
      } else if (s.state === 'VERIFYING') transition(s, 'EXECUTING');
      needState(run, ['EXECUTING'], 'task start');
      if (!['TODO', 'FAILED'].includes(t.status)) fail(`task ${id} is ${t.status}`);
      t.status = 'IN_PROGRESS';
      t.attempts += 1;
    } else {
      needState(run, ['EXECUTING', 'VERIFYING'], `task ${action}`);
      if (t.status !== 'IN_PROGRESS') fail(`task ${id} is ${t.status}, not IN_PROGRESS`);
      t.status = action === 'done' ? 'DONE' : 'FAILED';
    }
    return { event: { type: 'task', id, action, attempts: t.attempts }, result: { id, status: t.status, attempts: t.attempts, state: s.state } };
  });
}

function status(args, cwd) {
  const run = requireRun(cwd);
  if (args.includes('--json')) return { state: run.state };
  return fail('human status not implemented yet');
}

function block(args, cwd) {
  const reason = args.join(' ').trim();
  if (!reason) fail('usage: mis block <reason>');
  return mutate(cwd, (run) => {
    transition(run.state, 'BLOCKED');
    run.state.blockedReason = reason;
    return { event: { type: 'block', reason }, result: { state: 'BLOCKED', reason } };
  });
}

function cancel(args, cwd) {
  return mutate(cwd, (run) => {
    transition(run.state, 'CANCELLED');
    return { event: { type: 'cancel' }, result: { state: 'CANCELLED' } };
  });
}

export const commands = { start, plan, mode, interview, approve, review, task, status, block, cancel };
export { requiredChecks };
