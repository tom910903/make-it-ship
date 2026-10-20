// mis subcommands (Spec §8). Every state change goes through mutate(): lock → change → atomic save + event.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { loadConfig, requiredChecks } from './config.mjs';
import { createRun, loadRun, saveState, withLock, transition, setCurrent, pidAlive, TERMINAL } from './state.mjs';
import { evidenceStatus } from './verdict.mjs';
import { treeHash, repoRoot } from './tree-hash.mjs';
import { validatePlan, hashPlan } from './plan.mjs';
import { maskSecrets } from './mask.mjs';
import { verdict as judge } from './verdict.mjs';
import { changedManifests } from './deps.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderStatus, renderReport } from './render.mjs';
import { REPORT_DIR } from './tree-hash.mjs';
import { detectConfig, writeConfig, doctor as runDoctor } from './setup.mjs';
import { shortcutDebt } from './debt.mjs';
import { planWaves } from './parallel.mjs';
import { detectQa } from './qa.mjs';
import { renderShip } from './ship.mjs';
import { loadRuns, retroMetrics, renderRetro } from './retro.mjs';
import { addLearning, refreshLearnings } from './learn.mjs';
import { bridgeScan, listDevices } from './ios.mjs';
import { stateRoot } from './state.mjs';
import { alwaysCommands } from './commands-always.mjs';
import { readLoop, endLoop } from './loop.mjs';

const TEMPLATE = fileURLToPath(new URL('../../templates/report.md', import.meta.url));

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
    run.state.lastTree = treeHash(cwd); // for `mis resume`: what changed since the last recorded event
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
  const text = arg === '-' ? readFileSync(0, 'utf8') : existsSync(p) ? readFileSync(p, 'utf8') : arg;
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
  if (s.mode === 'full') {
    const product = s.reviews.filter((r) => r.kind === 'product' && r.planHash === s.planHash).at(-1);
    if (!product) fail('full mode: product review of the current plan is missing (mis review add product -)');
    if (product.blocking > 0) fail(`product review has ${product.blocking} blocking issue(s); revise the plan`);
    if (s.plan.ui && !s.notes.some((n) => n.kind === 'design' && n.planHash === s.planHash)) fail('full mode UI project: record the chosen design for the current plan first (design-explore, then mis note design -)');
  }
  const open = openAmbiguities(s, cwd);
  if (open.length) fail(`unresolved ambiguity: ${open.map((q) => `${q.id} (${q.impact}) ${q.question}`).join('; ')}`);
}

/** Move into EXECUTING: quick low-risk runs may skip approval; everything else must be approved already. */
function beginExecution(s, cwd) {
  if (s.state === 'PLANNING' || s.state === 'AWAITING_APPROVAL') {
    if (needsApproval(s)) fail(`plan approval required before execution (mode ${s.mode ?? 'unset'}${s.riskFlags.length ? ', risk flags' : ''}): mis approve plan`);
    executionGates(s, cwd);
    transition(s, 'EXECUTING');
  } else if (s.state === 'VERIFYING') transition(s, 'EXECUTING');
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
  if (sub !== 'set' || !file) fail('usage: mis plan set <json-file|->');
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

/** Block the run because a limit was hit; `mis approve continue` can lift it. */
function limitBlock(s, reason, taskId = null) {
  s.blockedFrom = s.state;
  transition(s, 'BLOCKED');
  Object.assign(s, { blockedReason: reason, blockKind: 'limit', blockedTask: taskId });
  return { event: { type: 'block', reason, limit: true }, result: { state: 'BLOCKED', reason } };
}

const pastDeadline = (s) => s.deadlineAt && Date.now() > Date.parse(s.deadlineAt);
const deadlineBlock = (s) => limitBlock(s, `runtime limit exceeded (deadline ${s.deadlineAt}); ask the user: mis approve continue`);
const limits = (cwd) => loadConfig(repoRoot(cwd)).config?.limits ?? { maxAttemptsPerTask: 2, maxRuntimeMinutes: 120 };

function approve([what], cwd) {
  if (what === 'continue') return approveContinue(cwd);
  if (what === 'config') return approveConfig(cwd);
  if (what !== 'plan') fail('usage: mis approve <plan|continue|config>');
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

/** The user accepts the current .make-it-ship.json after it changed during the run. */
function approveConfig(cwd) {
  return mutate(cwd, (run) => {
    const s = run.state;
    if (TERMINAL.includes(s.state)) fail(`run is ${s.state}`);
    const { configHash } = loadConfig(repoRoot(cwd));
    s.approvals.push({ action: 'config', configHash, at: new Date().toISOString() });
    return { event: { type: 'approve', action: 'config', configHash }, result: { configHash } };
  });
}

/** Lift a limit block (runtime or retries) after the user confirms: extends the deadline, grants one more attempt. */
function approveContinue(cwd) {
  const lim = limits(cwd);
  return mutate(cwd, (run) => {
    const s = run.state;
    if (s.state !== 'BLOCKED' || s.blockKind !== 'limit') fail('approve continue only lifts a runtime/retry limit block');
    if (s.blockedTask) {
      const t = s.plan.tasks.find((x) => x.id === s.blockedTask);
      t.extraAttempts = (t.extraAttempts ?? 0) + 1;
    }
    s.state = s.blockedFrom;
    s.deadlineAt = new Date(Date.now() + lim.maxRuntimeMinutes * 60000).toISOString();
    Object.assign(s, { blockedReason: null, blockKind: null, blockedTask: null, blockedFrom: null });
    s.approvals.push({ action: 'continue', at: new Date().toISOString() });
    return { event: { type: 'approve', action: 'continue' }, result: { state: s.state, deadlineAt: s.deadlineAt } };
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
  if (sub !== 'add' || !REVIEW_KINDS.includes(kind) || !file) fail(`usage: mis review add <${REVIEW_KINDS.join('|')}> <md-file|->`);
  const src = resolve(cwd, file);
  if (file !== '-' && !existsSync(src)) fail(`review file not found: ${file}`);
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8');
  const counts = parseReview(text);
  return mutate(cwd, (run) => {
    const s = run.state;
    if (TERMINAL.includes(s.state)) fail(`run is ${s.state}`);
    const n = s.reviews.length + 1;
    mkdirSync(join(run.dir, 'reviews'), { recursive: true });
    const dest = `reviews/${n}-${kind}.md`;
    writeFileSync(join(run.dir, dest), text);
    const rec = { kind, treeHash: treeHash(cwd), planHash: s.planHash, ...counts, file: dest, at: new Date().toISOString() };
    s.reviews.push(rec);
    return { event: { type: 'review', kind, ...counts }, result: rec };
  });
}

function task([id, action], cwd) {
  if (!id || !['start', 'done', 'fail', 'retry'].includes(action)) fail('usage: mis task <id> <start|done|fail|retry>');
  const lim = limits(cwd);
  return mutate(cwd, (run) => {
    const s = run.state;
    const t = s.plan?.tasks.find((x) => x.id === id);
    if (!t) fail(`no task ${id} in plan`);
    if ((action === 'start' || action === 'retry') && !TERMINAL.includes(s.state) && pastDeadline(s)) return deadlineBlock(s);
    if (action === 'retry') {
      if (t.status !== 'FAILED') fail(`task ${id} is ${t.status}; only a FAILED task can be retried`);
      if (t.attempts >= lim.maxAttemptsPerTask + (t.extraAttempts ?? 0)) {
        return limitBlock(s, `task ${id} hit the retry limit (${t.attempts} attempts, max ${lim.maxAttemptsPerTask}); ask the user: mis approve continue`, id);
      }
      const rc = s.notes.filter((n) => n.kind === 'rootcause' && n.task === id && n.seq > (t.failedSeq ?? 0));
      if (!rc.length) fail(`no root-cause note since task ${id} failed: investigate, then mis note rootcause ${id} - (REPRODUCTION/HYPOTHESIS/EVIDENCE)`);
      if (s.state === 'VERIFYING') transition(s, 'EXECUTING');
      needState(run, ['EXECUTING'], 'task retry');
      t.status = 'IN_PROGRESS';
      t.attempts += 1;
    } else if (action === 'start') {
      beginExecution(s, cwd);
      needState(run, ['EXECUTING'], 'task start');
      if (t.status === 'FAILED') fail(`task ${id} failed before; use mis task ${id} retry after recording a root cause`);
      if (t.status !== 'TODO') fail(`task ${id} is ${t.status}`);
      t.status = 'IN_PROGRESS';
      t.attempts += 1;
    } else {
      needState(run, ['EXECUTING', 'VERIFYING'], `task ${action}`);
      if (t.status !== 'IN_PROGRESS') fail(`task ${id} is ${t.status}, not IN_PROGRESS`);
      t.status = action === 'done' ? 'DONE' : 'FAILED';
      if (action === 'fail') t.failedSeq = s.seq = (s.seq ?? 0) + 1;
    }
    return { event: { type: 'task', id, action, attempts: t.attempts }, result: { id, status: t.status, attempts: t.attempts, state: s.state } };
  });
}

function check([name], cwd) {
  if (!name) fail('usage: mis check <name>');
  const root = repoRoot(cwd);
  const cfg = loadConfig(root);
  if (cfg.errors.length) fail(`.make-it-ship.json invalid: ${cfg.errors.join('; ')}`);
  // 1) reserve an evidence id under the lock; 2) run the command WITHOUT the lock (parallel worktrees);
  // 3) record under the lock. A running/<pid>.json marker lets `mis resume` detect a killed check.
  const pre = mutate(cwd, (run) => {
    const s = run.state;
    if (TERMINAL.includes(s.state)) fail(`run is ${s.state}`);
    if (pastDeadline(s)) return deadlineBlock(s);
    s.evidenceSeq = (s.evidenceSeq ?? s.evidence.length) + 1;
    const id = `E${s.evidenceSeq}`;
    return { event: { type: 'check-start', id, check: name }, result: { id, dir: run.dir } };
  });
  if (pre.state === 'BLOCKED') return pre;
  const { id, dir } = pre;
  const marker = join(dir, 'running', `${process.pid}.json`);
  mkdirSync(join(dir, 'running'), { recursive: true });
  writeFileSync(marker, JSON.stringify({ pid: process.pid, id, check: name, startedAt: new Date().toISOString() }));
  const def = cfg.config?.checks[name];
  const rec = { id, check: name, argv: def?.argv ?? null, exitCode: null, status: 'BLOCKED', reason: null,
    treeHash: treeHash(root), configHash: cfg.configHash, log: `logs/${id}.log`, startedAt: new Date().toISOString(), endedAt: null };
  let output = '';
  if (!def) rec.reason = cfg.exists ? `check "${name}" is not defined in .make-it-ship.json` : 'no .make-it-ship.json (run `mis init`)';
  else {
    // shortcut: spawnSync kills only the direct child on timeout; grandchildren may linger. Upgrade to process groups if that bites.
    const r = spawnSync(def.argv[0], def.argv.slice(1), { cwd: root, encoding: 'utf8', timeout: def.timeoutSec * 1000,
      killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: { CI: '1', ...process.env } });
    output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.error?.code === 'ENOENT') rec.reason = `command not found: ${def.argv[0]}`;
    else if (r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null)) rec.reason = `timed out after ${def.timeoutSec}s`;
    else if (r.error) rec.reason = `could not run: ${r.error.message}`;
    else { rec.exitCode = r.status; rec.status = r.status === 0 ? 'PASS' : 'FAIL'; }
  }
  rec.endedAt = new Date().toISOString();
  const masked = maskSecrets(`$ ${(def?.argv ?? [name]).join(' ')}\n${output}${rec.reason ? `\n[make-it-ship] BLOCKED: ${rec.reason}\n` : ''}`);
  writeFileSync(join(dir, rec.log), masked);
  return mutate(cwd, (run) => {
    const s = run.state;
    s.evidence.push(rec);
    rmSync(marker, { force: true });
    const tail = masked.split('\n').slice(-40).join('\n');
    const warnings = [];
    const manifests = cfg.config?.dependencyManifests ?? [];
    const changed = manifests.length ? changedManifests(root, s.baseCommit, rec.treeHash, manifests) : [];
    if (changed.length && !s.notes.some((n) => n.kind === 'dep')) {
      warnings.push(`dependency manifest changed (${changed.join(', ')}) without a recorded reason: remove the dependency or run mis note dep "<why>"; the verdict stays PARTIAL until then`);
    }
    return { event: { type: 'check', id, check: name, status: rec.status, exitCode: rec.exitCode }, result: { ...rec, warnings, tail } };
  });
}

/** Current hashes + required checks + dependency change, as verdict context. */
export function verdictContext(run, cwd) {
  const root = repoRoot(cwd);
  const cfg = loadConfig(root);
  const tree = treeHash(root);
  const manifests = cfg.config?.dependencyManifests ?? [];
  const changed = manifests.length ? changedManifests(root, run.state.baseCommit, tree, manifests) : [];
  const required = cfg.config ? requiredChecks(cfg.config, run.state.mode) : [];
  const surfaces = detectQa(root, { surfacesOnly: true }).profiles.map(({ profile, surface }) => ({ profile, surface }));
  if (cfg.config && run.state.mode && run.state.mode !== 'quick') {
    for (const p of surfaces) if (!required.includes(`qa-${p.profile}`)) required.push(`qa-${p.profile}`);
  }
  const s = run.state;
  const configChangedUnapproved = s.configHash !== cfg.configHash && !(s.approvals ?? []).some((a) => a.action === 'config' && a.configHash === cfg.configHash);
  return { treeHash: tree, configHash: cfg.configHash, required, surfaces, configChangedUnapproved,
    dependencyChanged: changed.length > 0, changedManifests: changed, configErrors: cfg.errors, configExists: cfg.exists };
}

function verdictCmd(args, cwd) {
  return mutate(cwd, (run) => {
    const s = run.state;
    const ctx = verdictContext(run, cwd);
    const v = judge(s, ctx);
    const cfgProblem = !ctx.configExists ? 'no .make-it-ship.json: no required checks are defined'
      : ctx.configErrors.length ? `.make-it-ship.json invalid: ${ctx.configErrors.join('; ')}` : null;
    if (cfgProblem) { v.reasons.push(cfgProblem); if (v.verdict === 'VERIFIED') v.verdict = 'PARTIAL'; }
    if (s.state === 'EXECUTING') transition(s, 'VERIFYING');
    return { event: { type: 'verdict', verdict: v.verdict, treeHash: ctx.treeHash }, result: { ...v, treeHash: ctx.treeHash, changedManifests: ctx.changedManifests, state: s.state } };
  });
}

function status(args, cwd) {
  const run = requireRun(cwd);
  if (args.includes('--json')) return { state: run.state };
  return renderStatus(run.state, verdictContext(run, cwd));
}

function changedFiles(root, base, tree) {
  const out = execFileSync('git', ['diff', '--name-status', base ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904', tree], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => { const [st, ...p] = l.split('\t'); return { status: st, path: p.join(' → ') }; });
}

function report(args, cwd) {
  return mutate(cwd, (run) => {
    const s = run.state;
    const root = repoRoot(cwd);
    const ctx = verdictContext(run, cwd);
    const v = judge(s, ctx);
    if (!ctx.configExists || ctx.configErrors.length) {
      v.reasons.push(!ctx.configExists ? 'no .make-it-ship.json: no required checks are defined' : `.make-it-ship.json invalid: ${ctx.configErrors.join('; ')}`);
      if (v.verdict === 'VERIFIED') v.verdict = 'PARTIAL';
    }
    if (s.state === 'EXECUTING') transition(s, 'VERIFYING');
    if (s.state === 'VERIFYING') transition(s, 'REPORTED');
    const rel = `${REPORT_DIR}/${s.runId}/report.md`;
    mkdirSync(join(root, REPORT_DIR, s.runId), { recursive: true });
    writeFileSync(join(root, rel), renderReport(TEMPLATE, { state: s, ctx, verdict: v, changes: changedFiles(root, s.baseCommit, ctx.treeHash), debt: shortcutDebt(root), generatedAt: new Date().toISOString() }));
    s.lastReport = { path: rel, verdict: v.verdict, treeHash: ctx.treeHash };
    return { event: { type: 'report', verdict: v.verdict, path: rel }, result: { path: rel, verdict: v.verdict, reasons: v.reasons, state: s.state } };
  });
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

const ROOTCAUSE_PARTS = ['REPRODUCTION', 'HYPOTHESIS', 'EVIDENCE'];

function note([kind, ...rest], cwd) {
  let rec;
  if (kind === 'dep') {
    const text = rest.join(' ').trim();
    if (!text) fail('usage: mis note dep <reason the dependency is needed>');
    rec = { kind, text };
  } else if (kind === 'rootcause') {
    const [taskId, file] = rest;
    if (!taskId || !file) fail('usage: mis note rootcause <task> <md-file|->');
    const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, file), 'utf8');
    const missing = ROOTCAUSE_PARTS.filter((p) => !new RegExp(`^${p}:\\s*\\S`, 'mi').test(text));
    if (missing.length) fail(`root-cause note needs non-empty ${missing.map((p) => `${p}:`).join(', ')} lines`);
    rec = { kind, task: taskId, text };
  } else if (kind === 'design') {
    const [file] = rest;
    if (!file) fail('usage: mis note design <md-file|->');
    const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, file), 'utf8');
    if (!text.trim()) fail('design note is empty: describe the chosen variant and the design system');
    rec = { kind, text };
  } else if (kind === 'second-opinion') {
    const [file] = rest;
    const text = !file ? '' : file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, file), 'utf8');
    if (!text.trim()) fail('usage: mis note second-opinion <file|-> (the other model\'s review, verbatim)');
    rec = { kind, text };
  } else fail('usage: mis note <dep <text>|rootcause <task> <file|->|design <file|->|second-opinion <file|->>');
  return mutate(cwd, (run) => {
    if (TERMINAL.includes(run.state.state)) fail(`run is ${run.state.state}`);
    if (rec.task && !run.state.plan?.tasks.some((t) => t.id === rec.task)) fail(`no task ${rec.task} in plan`);
    if (rec.kind === 'rootcause') rec.seq = run.state.seq = (run.state.seq ?? 0) + 1;
    if (rec.kind === 'design') rec.planHash = run.state.planHash;
    rec.at = new Date().toISOString();
    run.state.notes.push(rec);
    return { event: { type: 'note', kind }, result: rec };
  });
}

function resume([runId], cwd) {
  const run = loadRun(cwd, runId);
  if (!run) fail(runId ? `no run ${runId}` : 'no run to resume');
  setCurrent(run);
  return mutate(cwd, (r) => {
    const s = r.state;
    const ctx = verdictContext(r, cwd);
    const changed = s.lastTree ? changedFiles(repoRoot(cwd), s.lastTree, ctx.treeHash) : [];
    const staleEvidence = s.evidence.filter((e) => e.status !== 'BLOCKED' && evidenceStatus(e, ctx) === 'STALE').map((e) => ({ id: e.id, check: e.check, was: e.status }));
    const inProgressTasks = (s.plan?.tasks ?? []).filter((t) => t.status === 'IN_PROGRESS').map((t) => t.id);
    const openQuestions = s.interview.filter((q) => !q.answer).map((q) => `${q.id} (${q.impact}) ${q.question}`);
    const interruptedChecks = [];
    const runningDir = join(r.dir, 'running');
    for (const f of existsSync(runningDir) ? readdirSync(runningDir) : []) {
      const m = JSON.parse(readFileSync(join(runningDir, f), 'utf8'));
      if (pidAlive(m.pid)) continue;
      interruptedChecks.push({ id: m.id, check: m.check, startedAt: m.startedAt });
      rmSync(join(runningDir, f), { force: true });
    }
    const next = [];
    for (const c of interruptedChecks) next.push(`check ${c.check} (${c.id}) was killed before finishing; its result was not recorded — re-run it`);
    if (r.reclaimedLock) next.push(`a previous mis process (pid ${r.reclaimedLock.pid}) died mid-command; its result was not recorded — re-run it`);
    if (s.state === 'BLOCKED') next.push(`blocked: ${s.blockedReason}${s.blockKind === 'limit' ? ' (user can lift with mis approve continue)' : ''}`);
    if (s.state === 'AWAITING_APPROVAL') next.push('plan approval: mis approve plan');
    if (changed.length) next.push(`review ${changed.length} file(s) changed since the last recorded step before continuing`);
    if (staleEvidence.length) next.push(`re-run stale checks: ${[...new Set(staleEvidence.map((e) => e.check))].join(', ')}`);
    for (const t of inProgressTasks) next.push(`task ${t} was in progress: verify its state, then continue or mark it`);
    if (!next.length) next.push(TERMINAL.includes(s.state) ? `run is ${s.state}; nothing to resume` : 'continue with the next TODO task');
    return {
      event: { type: 'resume', reclaimedLock: r.reclaimedLock ?? null, interrupted: interruptedChecks.length, changed: changed.length },
      result: { runId: s.runId, state: s.state, reclaimedLock: r.reclaimedLock ?? null, interruptedChecks, changedSinceLastEvent: changed, staleEvidence, inProgressTasks, openQuestions, next },
    };
  });
}

const gitOut = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitTry = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function parallel([sub], cwd) {
  if (sub !== 'plan') fail('usage: mis parallel plan');
  const run = requireRun(cwd);
  if (!run.state.plan) fail('no plan');
  return planWaves(run.state.plan.tasks);
}

function mainRoot(cwd) {
  const root = repoRoot(cwd);
  if (resolve(root, gitOut(root, 'rev-parse', '--git-dir')) !== resolve(root, gitOut(root, 'rev-parse', '--git-common-dir'))) {
    fail('run worktree commands from the main working tree, not from a task worktree');
  }
  return root;
}

/** mis worktree add|merge <task>: isolate a task on its own branch, then merge it back (aborting cleanly on conflict). */
function worktree([sub, id], cwd) {
  if (!['add', 'merge'].includes(sub) || !id) fail('usage: mis worktree <add|merge> <task>');
  const root = mainRoot(cwd);
  if (gitOut(root, 'status', '--porcelain')) fail('main working tree has uncommitted changes; commit them first so task worktrees start from the same code');
  return mutate(cwd, (run) => {
    const s = run.state;
    const t = s.plan?.tasks.find((x) => x.id === id);
    if (!t) fail(`no task ${id} in plan`);
    s.worktrees ??= {};
    if (sub === 'add') {
      if (s.worktrees[id]) fail(`task ${id} already has a worktree: ${s.worktrees[id].path}`);
      if (t.status !== 'TODO') fail(`task ${id} is ${t.status}`);
      beginExecution(s, cwd);
      const exclude = join(gitOut(root, 'rev-parse', '--git-common-dir').replace(/^(?!\/)/, `${root}/`), 'info', 'exclude');
      mkdirSync(join(exclude, '..'), { recursive: true });
      if (!(existsSync(exclude) && readFileSync(exclude, 'utf8').split('\n').includes('.worktrees/'))) writeFileSync(exclude, `${existsSync(exclude) ? readFileSync(exclude, 'utf8').replace(/\n?$/, '\n') : ''}.worktrees/\n`);
      const path = join(root, '.worktrees', `${s.runId}-${id}`);
      const branch = `mis/${s.runId}/${id}`;
      const base = gitOut(root, 'rev-parse', 'HEAD');
      gitOut(root, 'worktree', 'add', '-q', '-b', branch, path, base);
      s.worktrees[id] = { path, branch, base, merged: false, conflicts: null };
      return { event: { type: 'worktree-add', task: id, branch }, result: { task: id, path, branch, files: t.files ?? [] } };
    }
    const w = s.worktrees[id];
    if (!w) fail(`task ${id} has no worktree`);
    if (w.merged) fail(`task ${id} is already merged`);
    if (t.status !== 'DONE') fail(`task ${id} is ${t.status}; finish it (mis task ${id} done) before merging`);
    if (gitOut(w.path, 'status', '--porcelain')) fail(`worktree ${w.path} has uncommitted changes; commit them on ${w.branch} first`);
    const m = gitTry(root, 'merge', '--no-ff', '--no-edit', w.branch);
    if (m.status !== 0) {
      const conflicts = gitOut(root, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
      gitTry(root, 'merge', '--abort');
      w.conflicts = conflicts;
      return { event: { type: 'worktree-conflict', task: id, conflicts }, result: { task: id, merged: false, conflicts,
        next: `resolve in ${w.path} (rebase ${w.branch} on the current branch and fix ${conflicts.join(', ')}), then mis worktree merge ${id}` } };
    }
    w.merged = true;
    w.conflicts = null;
    w.mergeCommit = gitOut(root, 'rev-parse', 'HEAD');
    gitTry(root, 'worktree', 'remove', w.path);
    gitTry(root, 'branch', '-d', w.branch);
    return { event: { type: 'worktree-merge', task: id, commit: w.mergeCommit }, result: { task: id, merged: true, commit: w.mergeCommit } };
  });
}

function ship(args, cwd) {
  return mutate(cwd, (run) => {
    const s = run.state;
    const root = repoRoot(cwd);
    const ctx = verdictContext(run, cwd);
    const v = judge(s, ctx);
    if (!ctx.configExists || ctx.configErrors.length) { v.reasons.push('no valid .make-it-ship.json'); if (v.verdict === 'VERIFIED') v.verdict = 'PARTIAL'; }
    const bridge = bridgeScan(root);
    if (bridge.length) { v.reasons.push(`iOS debug bridge code remains in ${bridge.join(', ')} (remove it: templates/ios-debug-bridge/README.md)`); if (v.verdict === 'VERIFIED') v.verdict = 'PARTIAL'; }
    const { ready, markdown } = renderShip({ root, state: s, verdict: v, ctx, changes: changedFiles(root, s.baseCommit, ctx.treeHash), debt: shortcutDebt(root) });
    const rel = `${REPORT_DIR}/${s.runId}/ship.md`;
    mkdirSync(join(root, REPORT_DIR, s.runId), { recursive: true });
    writeFileSync(join(root, rel), markdown + '\n');
    return { event: { type: 'ship', ready, verdict: v.verdict }, result: { ready, verdict: v.verdict, reasons: v.reasons, path: rel } };
  });
}

function retro(args, cwd) {
  const days = flag(args, '--days');
  const root = repoRoot(cwd);
  const metrics = retroMetrics(loadRuns(stateRoot(cwd)), { sinceMs: days ? Date.now() - Number(days) * 86400000 : 0 });
  const date = new Date().toISOString().slice(0, 10);
  const rel = `${REPORT_DIR}/retro-${date}.md`;
  mkdirSync(join(root, REPORT_DIR), { recursive: true });
  writeFileSync(join(root, rel), renderRetro(metrics, date));
  return { path: rel, metrics };
}

function learn([sub, arg], cwd) {
  const root = repoRoot(cwd);
  if (sub === 'list') return { entries: refreshLearnings(root) };
  if (sub === 'add') return { entries: addLearning(root, readJsonArg(cwd, arg)) };
  return fail('usage: mis learn <add <json|->|list>');
}

const OTHER_MODEL_CLIS = ['codex', 'gemini'];

function secondOpinion([sub], cwd) {
  if (sub !== 'detect') fail('usage: mis second-opinion detect');
  const available = [];
  for (const name of OTHER_MODEL_CLIS) {
    for (const d of (process.env.PATH ?? '').split(':')) {
      const p = join(d, name);
      if (d && existsSync(p)) { available.push({ name, path: p }); break; }
    }
  }
  return { available, note: 'Optional. Running another model sends repository content to an external service: ask the user first (the guard also asks while a Make It Ship run is active). Record the result with mis note second-opinion - (it does not change the verdict).' };
}

/** mis bench <check> [--runs N]: wall-clock median of N runs, compared with the run's first measurement of that check. */
function bench(args, cwd) {
  const runs = Number(flag(args, '--runs') ?? 5);
  const [name] = args;
  if (!name || !Number.isInteger(runs) || runs < 1 || runs > 50) fail('usage: mis bench <check> [--runs 1-50]');
  const root = repoRoot(cwd);
  const def = loadConfig(root).config?.checks[name];
  if (!def) fail(`check "${name}" is not defined in .make-it-ship.json`);
  const times = [];
  let failed = null;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(def.argv[0], def.argv.slice(1), { cwd: root, timeout: def.timeoutSec * 1000, killSignal: 'SIGKILL', stdio: 'ignore', env: { CI: '1', ...process.env } });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (r.status !== 0) { failed = r.error?.message ?? `exit ${r.status ?? r.signal}`; break; }
  }
  times.sort((a, b) => a - b);
  const medianMs = Math.round(times[Math.floor(times.length / 2)]);
  return mutate(cwd, (run) => {
    const s = run.state;
    const base = s.notes.find((n) => n.kind === 'bench' && n.check === name && n.status !== 'FAILED');
    const deltaPct = base && !failed ? Math.round(((medianMs - base.medianMs) / base.medianMs) * 100) : null;
    const status = failed ? 'FAILED' : !base ? 'BASELINE' : deltaPct > 50 ? 'REGRESSION' : deltaPct > 20 ? 'WARN' : 'OK';
    const rec = { kind: 'bench', check: name, runs: times.length, medianMs, minMs: Math.round(times[0]), maxMs: Math.round(times.at(-1)),
      baselineMs: base?.medianMs ?? null, deltaPct, status, error: failed, treeHash: treeHash(root), at: new Date().toISOString() };
    s.notes.push(rec);
    return { event: { type: 'bench', check: name, medianMs, status }, result: rec };
  });
}

function ios([sub], cwd) {
  if (sub === 'bridge-scan') {
    const files = bridgeScan(repoRoot(cwd));
    return { files, clean: files.length === 0 };
  }
  if (sub === 'devices') return listDevices();
  return fail('usage: mis ios <bridge-scan|devices>');
}

function qa([sub], cwd) {
  if (sub !== 'detect') fail('usage: mis qa detect');
  return detectQa(repoRoot(cwd));
}

function cancel(args, cwd) {
  return mutate(cwd, (run) => {
    transition(run.state, 'CANCELLED');
    try { if (readLoop(cwd).active) endLoop(cwd, 'cancelled'); } catch { /* no loop */ }
    return { event: { type: 'cancel' }, result: { state: 'CANCELLED' } };
  });
}

function init(args, cwd) {
  const root = repoRoot(cwd);
  const r = detectConfig(root);
  r.hud = {
    statusLine: { type: 'command', command: `node "${fileURLToPath(new URL('../statusline.mjs', import.meta.url))}"` },
    how: 'Optional HUD: with the user\'s OK, set this as "statusLine" in ~/.claude/settings.json (plugins cannot register it themselves), then restart Claude Code.',
  };
  if (args.includes('--write')) {
    if (!r.config) fail(r.message);
    return { written: writeConfig(root, r.config), config: r.config };
  }
  return r;
}

const doctor = (args, cwd) => runDoctor(cwd);

export const commands = { init, doctor, start, plan, mode, interview, approve, review, task, check, verdict: verdictCmd, status, report, note, resume, parallel, worktree, qa, ship, retro, learn, 'second-opinion': secondOpinion, bench, ios, block, cancel, ...alwaysCommands };
export { requiredChecks };
