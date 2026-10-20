// Merge readiness gate (absorbs OMC merge_readiness_*): after the work is done, the AI writes a 5-section explanation
// plus multiple-choice questions, the human answers one per round, and code scores the answers objectively.
// Passing means the human can explain the change; it never approves a merge. Same state machine as OMC:
//   start → (blocked: no change signal) | content → questioning → pass | paused; cancel from any active state.
// Make It Ship adaptation: evidence comes from git plus the current run (read-only verdict, checks, reviews).
// State: <git-common-dir>/make-it-ship/merge-readiness/<worktree-key>-<session>.json (shared dir, keyed per worktree).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot, loadRun } from './state.mjs';
import { repoRoot } from './tree-hash.mjs';
import { verdict as judge } from './verdict.mjs';
import { verdictContext } from './commands.mjs';

export const DIMENSIONS = ['why', 'change', 'tradeoff', 'risk', 'team'];
const PROFILES = {
  quick: { threshold: 0.7, max_rounds: 3, required_dimensions: ['why', 'change', 'risk'] },
  standard: { threshold: 0.8, max_rounds: 5, required_dimensions: DIMENSIONS },
  deep: { threshold: 0.9, max_rounds: 8, required_dimensions: DIMENSIONS },
};
export const BOUNDARY = 'Passing means the human can explain the change. It does not approve merge, replace tests, replace review, or accept risk.';
const SECTIONS = ['why', 'whatChanged', 'tradeoffs', 'risksConsidered', 'teamUnderstanding'];

/** Per-worktree key so worktrees sharing one git-common-dir do not share a gate. */
export const worktreeKey = (cwd) => createHash('sha256').update(repoRoot(cwd)).digest('hex').slice(0, 10);

function statePath(cwd, sessionId = 'default') {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('invalid session_id');
  return join(stateRoot(cwd), 'merge-readiness', `${worktreeKey(cwd)}-${sessionId}.json`);
}

export function readGate(cwd, sessionId) {
  const f = statePath(cwd, sessionId);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function save(cwd, sessionId, s) {
  const f = statePath(cwd, sessionId), tmp = `${f}.${process.pid}.tmp`;
  mkdirSync(join(f, '..'), { recursive: true });
  s.updated_at = new Date().toISOString();
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, f);
  return s;
}

const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim(); } catch { return ''; } };
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);

/** The current run's verdict, computed without touching run state (no event, no transition). */
function runEvidence(cwd) {
  let run;
  try { run = loadRun(cwd); } catch { return null; }
  if (!run) return null;
  const s = run.state, ctx = verdictContext(run, cwd), v = judge(s, ctx);
  if (!ctx.configExists) { v.reasons.push('no .make-it-ship.json: no required checks are defined'); if (v.verdict === 'VERIFIED') v.verdict = 'PARTIAL'; }
  return { runId: s.runId, state: s.state, verdict: v.verdict, reasons: v.reasons, checks: v.checks,
    evidence: (s.evidence ?? []).map((e) => `${e.id} ${e.check} ${e.status}`), reviews: (s.reviews ?? []).map((r) => `${r.kind}: ${r.blocking ?? 0} blocking`) };
}

export function collectEvidence(cwd, baseRef) {
  const root = repoRoot(cwd);
  const base = baseRef || git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']) || git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const mb = base ? git(root, ['merge-base', base, 'HEAD']) : '';
  const changedFiles = [...new Set([
    ...lines(git(root, ['diff', '--name-only', 'HEAD'])), ...lines(git(root, ['diff', '--cached', '--name-only'])),
    ...(mb ? lines(git(root, ['diff', '--name-only', `${mb}...HEAD`])) : []),
  ])].sort();
  const untrackedFiles = lines(git(root, ['ls-files', '--others', '--exclude-standard']));
  const status = git(root, ['status', '--short']);
  const diffStat = git(root, ['diff', '--stat', 'HEAD']) || (mb ? git(root, ['diff', '--stat', `${mb}...HEAD`]) : '');
  const run = runEvidence(cwd);
  const missingEvidence = [];
  if (!changedFiles.length && !status) missingEvidence.push('No changed files or git status evidence were detected.');
  if (!diffStat) missingEvidence.push('No diff stat was detected for the current worktree.');
  if (!run) missingEvidence.push('No Make It Ship run: no recorded checks or reviews (mis start / mis check / mis review).');
  else {
    if (!run.evidence.length) missingEvidence.push(`Run ${run.runId} has no recorded checks.`);
    if (!run.reviews.length) missingEvidence.push(`Run ${run.runId} has no recorded reviews.`);
    if (run.verdict !== 'VERIFIED') missingEvidence.push(`Run ${run.runId} verdict is ${run.verdict}: ${run.reasons.join('; ')}`);
  }
  return { changedFiles, untrackedFiles, status, diffStat, base_ref: base || null, run, missingEvidence };
}

function minimalEvidence(ev, mode) {
  const diff = ev.changedFiles.length > 0 || Boolean(ev.diffStat) || Boolean(ev.status);
  const artifacts = Boolean(ev.run && (ev.run.evidence.length || ev.run.reviews.length));
  return mode === 'diff' ? diff : mode === 'artifacts' ? artifacts : diff || artifacts;
}

export function startGate(cwd, summary, { sessionId, baseRef } = {}) {
  const prior = readGate(cwd, sessionId);
  if (prior?.result === 'pending') {
    throw new Error(`an active merge-readiness attempt is still in progress (phase: ${prior.phase}, ${prior.answers.length} answer(s)); cancel it with merge_readiness_cancel or finish it first`);
  }
  const profile = /(^|\s)--deep\b/i.test(summary) ? 'deep' : /(^|\s)--quick\b/i.test(summary) ? 'quick' : 'standard';
  const fromDiff = /(^|\s)--from-diff\b/i.test(summary), fromArtifacts = /(^|\s)--from-artifacts\b/i.test(summary);
  const mode = fromDiff ? 'diff' : fromArtifacts ? 'artifacts' : undefined;
  const evidence = collectEvidence(cwd, baseRef);
  const errors = fromDiff && fromArtifacts ? ['--from-diff and --from-artifacts cannot be used together.']
    : !minimalEvidence(evidence, mode) ? ['No minimal evidence for the selected source mode (no diff/change signal, no run checks or reviews).'] : [];
  const now = new Date().toISOString();
  const s = {
    active: true, phase: 'content', profile, ...PROFILES[profile], questions: [], answers: [], awaiting_content: !errors.length,
    evidence, readiness_score: 0, dimension_scores: {}, result: errors.length ? 'blocked' : 'pending',
    ...Object.fromEntries(SECTIONS.map((k) => [k, ''])), started_at: now, source_mode: mode ?? null,
    change_summary: summary.replace(/(^|\s)--(quick|standard|deep|from-diff|from-artifacts)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
    prior_attempts: [...(prior?.prior_attempts ?? []), ...(prior?.completed_at ? [{ ...prior, prior_attempts: undefined, evidence: undefined }] : [])],
  };
  if (errors.length) s.validation_errors = errors;
  return save(cwd, sessionId, s);
}

export function validateContent(c, s) {
  const errors = SECTIONS.filter((k) => !String(c[k] ?? '').trim()).map((k) => `Narrative section '${k}' is required.`);
  const qs = Array.isArray(c.questions) ? c.questions : [];
  if (qs.length > s.max_rounds) errors.push(`Questions exceed the ${s.max_rounds}-question profile limit.`);
  const ids = new Set();
  for (const q of qs) {
    if (!q.id?.trim() || ids.has(q.id)) errors.push('Question ids must be non-empty and unique.');
    ids.add(q.id);
    if (!DIMENSIONS.includes(q.dimension)) errors.push(`Question '${q.id}' has an unknown dimension.`);
    if (!q.stem?.trim()) errors.push(`Question '${q.id}' needs a stem.`);
    const opts = Array.isArray(q.options) ? q.options.map((o) => o?.id) : [];
    if (opts.length < 2) errors.push(`Question '${q.id}' needs at least two options.`);
    if (new Set(opts).size !== opts.length || opts.some((o) => !o?.trim?.())) errors.push(`Question '${q.id}' has invalid option ids.`);
    if (!opts.includes(q.correctOptionId)) errors.push(`Question '${q.id}' correctOptionId must identify an option.`);
  }
  for (const d of s.required_dimensions) if (!qs.some((q) => q.dimension === d)) errors.push(`No question covers required dimension '${d}'.`);
  return errors;
}

const nextQuestion = (s) => {
  const done = new Set(s.answers.map((a) => a.questionId)), open = s.questions.filter((q) => !done.has(q.id));
  return open.find((q) => s.required_dimensions.includes(q.dimension)) ?? open[0];
};

/** @returns {{state:object|null, errors:string[]}} */
export function setContent(cwd, content, { sessionId } = {}) {
  const s = readGate(cwd, sessionId);
  if (!s?.active) return { state: s, errors: ['no active gate (missing or already terminal): call merge_readiness_start first'] };
  if (s.result === 'blocked' || s.result === 'paused') {
    return { state: s, errors: [s.result === 'blocked' ? 'Blocked: no minimal evidence. Produce it and run merge_readiness_start again.'
      : 'Paused: the quiz was not passed. Run merge_readiness_start again; this attempt is kept in the audit history.'] };
  }
  const errors = validateContent(content, s);
  if (errors.length) return { state: save(cwd, sessionId, { ...s, validation_errors: errors, awaiting_content: true, phase: 'content', answers: [] }), errors };
  for (const k of SECTIONS) s[k] = content[k].trim();
  s.questions = content.questions.slice(0, s.max_rounds);
  Object.assign(s, { answers: [], readiness_score: 0, dimension_scores: {}, result: 'pending', awaiting_content: false, phase: 'questioning' });
  delete s.validation_errors;
  s.pending_question = nextQuestion(s);
  return { state: save(cwd, sessionId, s), errors: [] };
}

function finalize(s) {
  const dimOf = (a) => s.questions.find((q) => q.id === a.questionId)?.dimension;
  s.dimension_scores = {};
  for (const d of s.required_dimensions) {
    const as = s.answers.filter((a) => dimOf(a) === d);
    if (as.length) s.dimension_scores[d] = as.filter((a) => a.isCorrect).length / as.length;
  }
  s.readiness_score = s.answers.length ? s.answers.filter((a) => a.isCorrect).length / s.answers.length : 0;
  const covered = s.required_dimensions.every((d) => s.answers.some((a) => dimOf(a) === d));
  if (!covered || s.answers.length < Math.min(s.questions.length, s.max_rounds)) { s.pending_question = nextQuestion(s); return; }
  delete s.pending_question;
  s.phase = 'complete';
  s.completed_at = new Date().toISOString();
  if (s.readiness_score >= s.threshold) { s.result = 'pass'; s.active = false; } else s.result = 'paused'; // paused stays armed
}

/** Record the human's choice for the pending question; null when it does not match the pending question. */
export function recordAnswer(cwd, questionId, optionId, { sessionId } = {}) {
  const s = readGate(cwd, sessionId);
  if (!s?.active || s.phase !== 'questioning' || s.pending_question?.id !== questionId) return null;
  const q = s.questions.find((x) => x.id === questionId), opt = String(optionId).trim();
  if (!q?.options.some((o) => o.id === opt)) return null;
  s.answers = [...s.answers.filter((a) => a.questionId !== questionId), { questionId, selectedOptionId: opt, isCorrect: opt === q.correctOptionId, answeredAt: new Date().toISOString() }];
  finalize(s);
  return save(cwd, sessionId, s);
}

export function cancelGate(cwd, { sessionId } = {}) {
  const s = readGate(cwd, sessionId);
  if (!s?.active) return null;
  Object.assign(s, { active: false, phase: 'complete', result: 'cancelled', cancel_owner: sessionId ?? 'default', completed_at: new Date().toISOString() });
  delete s.pending_question;
  return save(cwd, sessionId, s);
}

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const list = (xs, empty) => (xs?.length ? xs.map((x) => `- ${x}`).join('\n') : empty);

function renderQuestions(qs, answers, revealAll, revealAnswered) {
  if (!qs.length) return '_No quiz questions recorded yet._';
  return qs.map((q, i) => {
    const a = answers.find((x) => x.questionId === q.id), show = revealAll || (revealAnswered && a);
    const opts = q.options.map((o) => {
      const marks = [...(show && o.id === q.correctOptionId ? ['correct'] : []), ...(a?.selectedOptionId === o.id ? ['selected'] : [])];
      return `- [${o.id}] ${o.text}${marks.length ? ` _(${marks.join(', ')})_` : ''}`;
    });
    const verdict = a && show ? `Correct: ${a.isCorrect ? 'yes' : 'no'}` : a ? '_Answered; correctness hidden until completion._' : '_Not answered yet._';
    return [`### ${i + 1}. [${q.dimension}] ${q.stem}`, '', ...opts, '', verdict].join('\n');
  }).join('\n\n');
}

/** Markdown report from state; answer keys and scores stay hidden until pass/paused (cancelled reveals answered only). */
export function renderGate(s) {
  const revealAll = s.result === 'pass' || s.result === 'paused', revealAnswered = s.result === 'cancelled';
  const ev = s.evidence, run = ev.run;
  const runBlock = run
    ? [`Make It Ship run ${run.runId}: ${run.verdict} (state ${run.state})`, '', list(run.reasons, '_No open reasons._'), '',
      '### Checks', '', list(run.evidence, '_No checks recorded._'), '', '### Reviews', '', list(run.reviews, '_No reviews recorded._')].join('\n')
    : '_No Make It Ship run for this repository._';
  const priors = (s.prior_attempts ?? []).map((p, i) => [`### Attempt ${i + 1}: ${p.result}`,
    `- Profile: ${p.profile} | threshold ${pct(p.threshold)}`, `- Readiness score: ${revealAll || revealAnswered ? pct(p.readiness_score) : 'hidden until the current attempt completes'}`,
    `- Change summary: ${p.change_summary || '_none_'}`, `- Completed: ${p.completed_at}`].join('\n'));
  return [
    '# Merge Readiness Report', '',
    '## Why', '', s.why || '_Not yet generated._', '',
    '## What Changed', '', s.whatChanged || '_Not yet generated._', '',
    '## Tradeoffs', '', s.tradeoffs || '_Not yet generated._', '',
    '## Risks Considered', '', s.risksConsidered || '_Not yet generated._', '',
    '## Team Understanding', '', s.teamUnderstanding || '_Not yet generated._', '',
    '## Change Summary', '', s.change_summary || '_No change summary provided._', '',
    '## Evidence Collected', '',
    '### Changed Files', '', list([...ev.changedFiles, ...ev.untrackedFiles.map((f) => `${f} (untracked)`)], '_No changed files detected._'), '',
    '### Diff Stat', '', ev.diffStat || '_No diff stat output._', '',
    '### Run Evidence', '', runBlock, '',
    '### Missing Evidence', '', list(ev.missingEvidence, '_No missing evidence recorded._'), '',
    '## Human Explainability Quiz', '',
    'This quiz checks whether the human can explain the change. It does not replace tests, review, or maintainer approval.', '',
    renderQuestions(s.questions, s.answers, revealAll, revealAnswered), '',
    '## Pending Question', '', s.pending_question ? `- [${s.pending_question.dimension}] ${s.pending_question.stem}` : '_No pending question._', '',
    '## Readiness', '',
    `Result: ${s.result}`, ...(s.validation_errors?.length ? ['', list(s.validation_errors)] : []), '',
    revealAll || revealAnswered ? `Correctness rate: ${pct(s.readiness_score)} / threshold ${pct(s.threshold)}` : `Correctness rate: hidden until completion / threshold ${pct(s.threshold)}`, '',
    'Dimension coverage:', '', revealAll || revealAnswered ? s.required_dimensions.map((d) => `- ${d}: ${pct(s.dimension_scores[d])}`).join('\n') : '_Available after the attempt completes._', '',
    ...(priors.length ? ['## Prior Attempts', '', priors.join('\n\n'), ''] : []),
    '## Merge Boundary', '', BOUNDARY, '',
  ].join('\n');
}
