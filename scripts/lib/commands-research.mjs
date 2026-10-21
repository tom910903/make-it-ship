// M9-D D2: research loops (absorbs OMC sciomc, autoresearch, self-improve, writer-memory; `omc autoresearch` shim).
// Everything is local files under <repo>/.make-it-ship/. Loops are bounded (max runtime and iterations), the
// autoresearch evaluator has a strict JSON contract, and self-improve only proposes: a change is applied by
// `mis approve proposal <id>`, which the guard always asks the user about.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fail, flag, projectDir, rootOf, readJson, writeJson, slug, stamp, duration, textArg, MIS_CLI_ENV } from './cli-util.mjs';

const now = () => new Date().toISOString();
// shortcut: a timeout kills the `sh` only; grandchildren it started may keep running. Upgrade: spawn detached and kill the group.
// M9 r2 N2: MIS_CLI, as for check scripts: a mis command the evaluator or benchmark calls that the guard would ask about is refused.
const sh = (cmd, cwd, timeout) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, env: MIS_CLI_ENV() });
const lastJson = (out) => { const line = String(out ?? '').trim().split('\n').filter(Boolean).at(-1); try { return JSON.parse(line); } catch { return undefined; } };

// ---------------------------------------------------------------- sciomc: research sessions

const FINDING = /\[FINDING:(\w+)\]\s*(.*?)\n([\s\S]*?)\[\/FINDING\]/g;
const EVIDENCE = /\[EVIDENCE:(\w+)\]([\s\S]*?)\[\/EVIDENCE\]/g;
const CONFIDENCE = /\[CONFIDENCE:(HIGH|MEDIUM|LOW)\]/;

/** Findings of a scientist's output, each checked for the quality bar (evidence and a confidence level). */
export function extractFindings(text) {
  const evidence = {};
  for (const m of text.matchAll(EVIDENCE)) (evidence[m[1]] ??= []).push(m[2].trim());
  return [...text.matchAll(FINDING)].map((m) => {
    const confidence = CONFIDENCE.exec(m[3])?.[1] ?? null;
    const ev = evidence[m[1]] ?? [];
    const problems = [...(ev.length ? [] : ['no [EVIDENCE] block']), ...(confidence ? [] : ['no [CONFIDENCE] level'])];
    return { id: m[1], title: m[2].trim(), body: m[3].trim(), confidence, evidence: ev, problems };
  });
}

const sessionDir = (cwd, id) => {
  const d = join(projectDir(cwd, 'research'), id);
  if (!/^[\w.-]+$/.test(id ?? '') || !existsSync(join(d, 'state.json'))) fail(`no research session "${id}" (mis research list)`);
  return d;
};
const latestSession = (cwd) => readdirSync(projectDir(cwd, 'research')).filter((d) => existsSync(join(projectDir(cwd, 'research'), d, 'state.json'))).sort().at(-1);

function research([sub, ...argv], cwd) {
  const args = [...argv];
  if (sub === 'start') {
    const stages = Number(flag(args, '--stages') ?? 3), maxIterations = Number(flag(args, '--max-iterations') ?? 10);
    const maxRuntimeMs = duration(flag(args, '--max-runtime') ?? '2h', '--max-runtime');
    const goal = args.join(' ').trim();
    if (!goal || !Number.isInteger(stages) || stages < 1 || stages > 10 || !Number.isInteger(maxIterations) || maxIterations < 1) fail('usage: mis research start <goal> [--stages 1-10] [--max-iterations N] [--max-runtime 2h]');
    const id = `research-${stamp()}-${slug(goal).slice(0, 20)}`, d = join(projectDir(cwd, 'research'), id);
    mkdirSync(join(d, 'stages'), { recursive: true });
    const state = { id, goal, status: 'in_progress', iteration: 0, maxIterations, deadlineAt: new Date(Date.now() + maxRuntimeMs).toISOString(),
      stages: Array.from({ length: stages }, (_, k) => ({ id: k + 1, status: 'pending', findingsFile: null })), createdAt: now(), updatedAt: now() };
    writeJson(join(d, 'state.json'), state);
    return { ...state, dir: d, next: `Launch ${stages} scientist subagents in ONE message (Agent tool), one per stage; record each with mis research add ${id} <stage> -` };
  }
  if (sub === 'add') {
    const [id, stage, src] = args;
    const d = sessionDir(cwd, id), state = readJson(join(d, 'state.json'));
    if (state.status !== 'in_progress') fail(`session is ${state.status}`);
    if (Date.now() > Date.parse(state.deadlineAt)) { state.status = 'stopped'; state.stopReason = 'max runtime reached'; writeJson(join(d, 'state.json'), state); fail(`STOPPED: max runtime reached (${state.deadlineAt}); write the report with what you have`); }
    if (state.iteration >= state.maxIterations) { state.status = 'stopped'; state.stopReason = 'max iterations reached'; writeJson(join(d, 'state.json'), state); fail(`STOPPED: ${state.maxIterations} iterations used; write the report with what you have`); }
    const st = state.stages.find((s) => s.id === Number(stage));
    if (!st || src === undefined) fail('usage: mis research add <session> <stage-number> <file|->');
    const text = textArg(cwd, src);
    const findings = extractFindings(text);
    const file = join(d, 'stages', `stage-${st.id}.md`);
    writeFileSync(file, text);
    Object.assign(st, { status: 'complete', findingsFile: file, findings: findings.length, completedAt: now() });
    state.iteration++; state.updatedAt = now();
    writeJson(join(d, 'state.json'), state);
    const weak = findings.filter((f) => f.problems.length);
    return { stage: st.id, findings: findings.length, weak: weak.map((f) => ({ id: f.id, problems: f.problems })), remaining: state.stages.filter((s) => s.status !== 'complete').map((s) => s.id),
      ...(findings.length ? {} : { warning: 'no [FINDING:id] ... [/FINDING] blocks: ask the scientist to use the tag format' }) };
  }
  if (sub === 'status') { const id = args[0] ?? latestSession(cwd); return readJson(join(sessionDir(cwd, id), 'state.json')); }
  if (sub === 'list') {
    const base = projectDir(cwd, 'research');
    return { sessions: readdirSync(base).map((d) => readJson(join(base, d, 'state.json'))).filter(Boolean).map(({ id, goal, status, iteration }) => ({ id, goal, status, iteration })) };
  }
  if (sub === 'cancel') {
    const d = sessionDir(cwd, args[0] ?? latestSession(cwd)), state = readJson(join(d, 'state.json'));
    Object.assign(state, { status: 'cancelled', updatedAt: now() });
    writeJson(join(d, 'state.json'), state);
    return { id: state.id, status: state.status };
  }
  if (sub === 'report') {
    const d = sessionDir(cwd, args[0] ?? latestSession(cwd)), state = readJson(join(d, 'state.json'));
    const all = state.stages.filter((s) => s.findingsFile).flatMap((s) => extractFindings(readFileSync(s.findingsFile, 'utf8')).map((f) => ({ ...f, stage: s.id })));
    const verified = all.filter((f) => !f.problems.length), weak = all.filter((f) => f.problems.length);
    const notDone = [...state.stages.filter((s) => s.status !== 'complete').map((s) => `- stage ${s.id}`), ...(state.stopReason ? [`- stopped: ${state.stopReason}`] : [])];
    const md = [`# Research Report: ${state.goal}`, '', `Session ${state.id}: ${state.status}, ${state.iteration}/${state.maxIterations} iterations, stages complete ${state.stages.filter((s) => s.status === 'complete').length}/${state.stages.length}.`, '',
      '## Executive Summary', '', '(Claude: 3-5 sentences from the verified findings only.)', '', '## Key Findings', '',
      ...verified.map((f) => `### ${f.id}: ${f.title} (stage ${f.stage}, ${f.confidence})\n\n${f.body.replace(CONFIDENCE, '').trim()}\n\nEvidence:\n${f.evidence.map((e) => `- ${e.replace(/\n/g, ' ')}`).join('\n')}\n`),
      '## Unverified (missing evidence or confidence)', '', ...(weak.length ? weak.map((f) => `- ${f.id}: ${f.title} — ${f.problems.join(', ')}`) : ['- none']), '',
      '## Not done', '', ...(notDone.length ? notDone : ['- nothing']), ''].join('\n');
    writeFileSync(join(d, 'report.md'), md);
    return { report: join(d, 'report.md'), verified: verified.length, unverified: weak.length };
  }
  return fail('usage: mis research start <goal> [--stages N] [--max-iterations N] [--max-runtime 2h] | add <session> <stage> <file|-> | status [session] | list | report [session] | cancel [session]');
}

// ---------------------------------------------------------------- autoresearch: single mission, strict evaluator

/** The evaluator contract: a shell command that prints JSON {"pass": boolean, "score"?: number} as its last line. */
export function checkEvaluator(e) {
  const errors = [];
  if (!e || typeof e !== 'object') return ['evaluator.json is missing or not JSON'];
  if (typeof e.command !== 'string' || !e.command.trim()) errors.push('"command" must be a non-empty shell command');
  if (!Number.isInteger(e.timeoutSec) || e.timeoutSec < 1) errors.push('"timeoutSec" must be a positive integer');
  if (e.output !== 'json') errors.push('"output" must be "json" (last stdout line: {"pass": boolean, "score"?: number})');
  return errors;
}
export function checkResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'last stdout line is not a JSON object';
  if (typeof r.pass !== 'boolean') return '"pass" must be a boolean';
  if (r.score !== undefined && typeof r.score !== 'number') return '"score" must be a number when present';
  return null;
}

function missionDir(cwd, name, mustExist = true) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? '')) fail('mission name must be kebab-case');
  const d = join(projectDir(cwd, 'autoresearch'), name);
  if (mustExist && !existsSync(join(d, 'mission.md'))) fail(`no mission "${name}" (mis autoresearch init ${name} --mission <text|file> --eval <cmd>)`);
  return d;
}
const currentRun = (d) => { const id = readJson(join(d, 'current.json'))?.runId; return id ? { id, dir: join(d, 'runs', id), state: readJson(join(d, 'runs', id, 'run.json')) } : null; };

function stopRun(run, reason) {
  Object.assign(run.state, { status: 'stopped', stopReason: reason, endedAt: now() });
  writeJson(join(run.dir, 'run.json'), run.state);
  appendFileSync(join(run.dir, 'decision-log.md'), `\n## Stopped (${now()})\n\n${reason}\n`);
}

function autoresearch([sub, name, ...argv], cwd) {
  const args = [...argv];
  if (sub === 'init') {
    const d = missionDir(cwd, name, false);
    if (existsSync(join(d, 'mission.md'))) fail(`mission "${name}" exists; edit ${d}/mission.md or evaluator.json`);
    const mission = flag(args, '--mission'), command = flag(args, '--eval'), timeoutSec = Number(flag(args, '--eval-timeout') ?? 300);
    if (!mission || !command) fail('usage: mis autoresearch init <name> --mission <text|file> --eval "<command printing {\\"pass\\":bool,\\"score\\":n}>" [--eval-timeout sec]');
    const evaluator = { command, timeoutSec, output: 'json' };
    const errors = checkEvaluator(evaluator);
    if (errors.length) fail(`evaluator contract: ${errors.join('; ')}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'mission.md'), `# Mission: ${name}\n\n${textArg(cwd, mission)}\n`);
    writeJson(join(d, 'evaluator.json'), evaluator);
    return { mission: name, dir: d, evaluator };
  }
  const d = missionDir(cwd, name);
  if (sub === 'start') {
    const run = currentRun(d);
    if (run?.state?.status === 'running') fail(`run ${run.id} is still running (mis autoresearch stop ${name})`);
    const errors = checkEvaluator(readJson(join(d, 'evaluator.json')));
    if (errors.length) fail(`evaluator contract: ${errors.join('; ')}`);
    const maxRuntimeMs = duration(flag(args, '--max-runtime') ?? '30m', '--max-runtime'), maxIterations = Number(flag(args, '--max-iterations') ?? 50);
    if (!Number.isInteger(maxIterations) || maxIterations < 1) fail('--max-iterations must be a positive integer');
    const id = `run-${stamp()}`, dir = join(d, 'runs', id);
    mkdirSync(join(dir, 'evaluations'), { recursive: true });
    const state = { runId: id, mission: name, status: 'running', iteration: 0, maxIterations, startedAt: now(), deadlineAt: new Date(Date.now() + maxRuntimeMs).toISOString(), best: null };
    writeJson(join(dir, 'run.json'), state);
    writeJson(join(d, 'current.json'), { runId: id });
    writeFileSync(join(dir, 'decision-log.md'), `# Decision log: ${name} / ${id}\n\nMax runtime until ${state.deadlineAt}, at most ${maxIterations} iterations. Non-passing iterations do not stop the run.\n`);
    return { ...state, dir, next: `Make ONE change, then: mis autoresearch eval ${name} --decision "<what you changed and why>"` };
  }
  if (sub === 'eval') {
    const run = currentRun(d);
    if (run?.state?.status !== 'running') fail(`no running autoresearch run for "${name}" (mis autoresearch start ${name})`);
    const decision = flag(args, '--decision') ?? '(no decision recorded)';
    const remaining = Date.parse(run.state.deadlineAt) - Date.now();
    if (remaining <= 0) { stopRun(run, 'max runtime reached'); return { stopped: true, reason: 'max runtime reached', run: run.state }; }
    if (run.state.iteration >= run.state.maxIterations) { stopRun(run, 'max iterations reached'); return { stopped: true, reason: 'max iterations reached', run: run.state }; }
    const evaluator = readJson(join(d, 'evaluator.json'));
    const errors = checkEvaluator(evaluator);
    const n = ++run.state.iteration, t0 = Date.now();
    let rec;
    if (errors.length) rec = { iteration: n, status: 'contract-error', error: errors.join('; ') };
    else {
      const limit = Math.min(evaluator.timeoutSec * 1000, remaining);
      const r = sh(evaluator.command, rootOf(cwd), limit);
      const killedByDeadline = r.error?.code === 'ETIMEDOUT' && limit === remaining;
      const result = lastJson(r.stdout), bad = r.error ? (r.error.code === 'ETIMEDOUT' ? `evaluator timed out after ${limit} ms` : r.error.message) : checkResult(result);
      rec = bad ? { iteration: n, status: killedByDeadline ? 'stopped-at-deadline' : 'contract-error', error: bad, exit: r.status }
        : { iteration: n, status: result.pass ? 'pass' : 'fail', pass: result.pass, score: result.score ?? null, exit: r.status };
    }
    Object.assign(rec, { decision, ms: Date.now() - t0, at: now() });
    writeJson(join(run.dir, 'evaluations', `iteration-${String(n).padStart(4, '0')}.json`), rec);
    if (rec.status === 'pass' || rec.status === 'fail') {
      const b = run.state.best;
      if (!b || (rec.pass && !b.pass) || (rec.pass === b.pass && (rec.score ?? -Infinity) > (b.score ?? -Infinity))) run.state.best = { iteration: n, pass: rec.pass, score: rec.score };
    }
    appendFileSync(join(run.dir, 'decision-log.md'), `\n## Iteration ${n} — ${rec.status}${rec.score != null ? ` (score ${rec.score})` : ''}\n\n- decision: ${decision}\n${rec.error ? `- evaluator problem: ${rec.error}\n` : ''}- best so far: ${run.state.best ? `iteration ${run.state.best.iteration}` : 'none'}\n`);
    writeJson(join(run.dir, 'run.json'), run.state);
    let stopped = null;
    if (rec.status === 'stopped-at-deadline' || Date.now() >= Date.parse(run.state.deadlineAt)) stopped = 'max runtime reached';
    else if (run.state.iteration >= run.state.maxIterations) stopped = 'max iterations reached';
    if (stopped) stopRun(run, stopped);
    return { ...rec, stopped: !!stopped, ...(stopped ? { reason: stopped } : {}), best: run.state.best, deadlineAt: run.state.deadlineAt };
  }
  if (sub === 'status') { const run = currentRun(d); return { mission: name, evaluator: readJson(join(d, 'evaluator.json')), run: run?.state ?? null, log: run ? join(run.dir, 'decision-log.md') : null }; }
  if (sub === 'stop') {
    const run = currentRun(d);
    if (run?.state?.status !== 'running') fail('no running run');
    stopRun(run, 'cancelled by the user');
    return run.state;
  }
  return fail('usage: mis autoresearch init <name> --mission <text|file> --eval <cmd> | start <name> [--max-runtime 30m] [--max-iterations N] | eval <name> --decision <text> | status <name> | stop <name>');
}

// ---------------------------------------------------------------- self-improve: propose, tournament, apply only on approval

// Process and skill files only: Make It Ship's project files, Claude Code config, skills, agents, hooks, instructions.
const PROCESS_PATHS = /^(\.make-it-ship\/|\.make-it-ship\.json$|\.claude\/|skills\/|agents\/|hooks\/|CLAUDE\.md$|AGENTS\.md$)/;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const proposalsDir = (cwd) => projectDir(cwd, 'self-improve', 'proposals');

/** M9 r2 N3: every path a patch touches, by git apply's own parser (numstat targets plus rename/copy sources), its
 *  sha256 and a short preview of the changed lines. Shared by the guard's ask and by apply. */
export function proposalPatch(root, bytes) {
  const r = spawnSync('git', ['apply', '--numstat', '--summary', '-z', '-'], { cwd: root, input: bytes, encoding: 'utf8' });
  if (r.status !== 0) return { error: (r.stderr || 'not a valid patch').trim() };
  const paths = new Set();
  for (const t of r.stdout.split('\0')) {
    const n = /^[\d-]+\t[\d-]+\t([^]*)$/.exec(t);
    if (n) { paths.add(n[1]); continue; }
    for (const l of t.split('\n')) {
      const m = /^ (?:rename|copy) (.*) \(\d+%\)$/.exec(l);
      if (!m) continue;
      const b = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(m[1]); // a/{x => y}/z
      paths.add(b ? `${b[1]}${b[2]}${b[4]}`.replace(/\/\/+/g, '/') : m[1].split(' => ')[0]);
    }
  }
  const text = Buffer.from(bytes).toString('utf8');
  const preview = text.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).slice(0, 8).join(' | ');
  return { paths: [...paths], sha: createHash('sha256').update(bytes).digest('hex'), preview };
}
function checkPatch(root, patch) {
  const bytes = Buffer.isBuffer(patch) ? patch : readFileSync(patch);
  const x = proposalPatch(root, bytes);
  if (x.error) fail(`not a valid patch: ${x.error}`);
  const outside = x.paths.filter((p) => !PROCESS_PATHS.test(p));
  if (outside.length) fail(`self-improve changes only process and skill files (.make-it-ship/, .claude/, skills/, agents/, hooks/, CLAUDE.md, AGENTS.md); not: ${outside.join(', ')}`);
  const c = spawnSync('git', ['apply', '--check', '-'], { cwd: root, input: bytes, encoding: 'utf8' });
  if (c.status !== 0) fail(`patch does not apply to the current tree: ${c.stderr.trim()}`);
  return { ...x, bytes };
}

function saveProposal(cwd, title, patchFile, extra) {
  const root = rootOf(cwd), { paths, sha, bytes } = checkPatch(root, patchFile);
  const id = `p-${stamp()}-${slug(title).slice(0, 20)}`, d = join(proposalsDir(cwd), id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'change.patch'), bytes);
  const p = { id, title, status: 'proposed', paths, patchSha: sha, createdAt: now(), ...extra };
  writeJson(join(d, 'proposal.json'), p);
  return { ...p, next: `Show the user the patch (${join(d, 'change.patch')}). Only they approve it: mis approve proposal ${id} --sha ${sha.slice(0, 12)} (the guard asks and shows the files the patch touches).` };
}
const loadProposal = (cwd, id) => {
  const d = join(proposalsDir(cwd), id ?? '');
  if (!/^[\w.-]+$/.test(id ?? '') || !existsSync(join(d, 'proposal.json'))) fail(`no proposal "${id}" (mis self-improve list)`);
  return { d, p: readJson(join(d, 'proposal.json')) };
};

function selfImprove([sub, ...argv], cwd) {
  const args = [...argv];
  if (sub === 'propose') {
    const patch = flag(args, '--patch'), why = flag(args, '--why') ?? null, title = args.join(' ').trim();
    if (!title || !patch) fail('usage: mis self-improve propose <title> --patch <file.diff> [--why <reason>]');
    return saveProposal(cwd, title, resolve(cwd, patch), { why });
  }
  if (sub === 'tournament') {
    // Each candidate patch is applied in its own throwaway worktree at HEAD and scored by the benchmark command.
    const bench = flag(args, '--bench'), title = flag(args, '--title') ?? 'tournament winner', timeoutSec = Number(flag(args, '--timeout') ?? 600);
    if (!bench || !args.length) fail('usage: mis self-improve tournament --bench "<cmd printing {\\"score\\":n} or exit 0/1>" <a.patch> <b.patch> ... [--title t]');
    const root = rootOf(cwd), tmp = mkdtempSync(join(tmpdir(), 'mis-tournament-'));
    const results = [];
    try {
      args.forEach((p, k) => {
        const patch = resolve(cwd, p), wt = join(tmp, `c${k}`);
        let score = null, status;
        try { checkPatch(root, patch); } catch (e) { results.push({ patch, status: 'rejected', error: e.message }); return; }
        if (git(root, 'worktree', 'add', '--detach', '-q', wt, 'HEAD').status !== 0) fail('git worktree add failed');
        try {
          git(wt, 'apply', patch);
          const r = sh(bench, wt, timeoutSec * 1000), j = lastJson(r.stdout);
          score = typeof j?.score === 'number' ? j.score : r.status === 0 ? 1 : 0;
          status = r.status === 0 ? 'ok' : `benchmark exit ${r.status ?? r.error?.code}`;
        } finally { git(root, 'worktree', 'remove', '--force', wt); }
        results.push({ patch, status, score });
      });
    } finally { rmSync(tmp, { recursive: true, force: true }); git(root, 'worktree', 'prune'); }
    const ranked = results.filter((r) => r.status === 'ok').sort((a, b) => b.score - a.score);
    if (!ranked.length) return { winner: null, results, note: 'no candidate passed the benchmark; nothing proposed' };
    return { winner: ranked[0].patch, results, proposal: saveProposal(cwd, title, ranked[0].patch, { tournament: results, bench }) };
  }
  if (sub === 'list') {
    const base = proposalsDir(cwd);
    return { proposals: readdirSync(base).map((id) => readJson(join(base, id, 'proposal.json'))).filter(Boolean).map(({ id, title, status, paths }) => ({ id, title, status, paths })) };
  }
  if (sub === 'show') {
    const { d, p } = loadProposal(cwd, args[0]), bytes = readFileSync(join(d, 'change.patch')), x = proposalPatch(rootOf(cwd), bytes);
    return { ...p, touches: x.paths ?? null, sha: x.sha ?? null, ...(x.error ? { patchError: x.error } : {}), patch: bytes.toString('utf8') };
  }
  if (sub === 'reject') {
    const { d, p } = loadProposal(cwd, args[0]);
    if (p.status !== 'proposed') fail(`proposal is ${p.status}`);
    Object.assign(p, { status: 'rejected', rejectedAt: now() });
    writeJson(join(d, 'proposal.json'), p);
    return p;
  }
  return fail('usage: mis self-improve propose <title> --patch f | tournament --bench <cmd> <patch...> | list | show <id> | reject <id>  (apply: mis approve proposal <id>)');
}

/** `mis approve proposal <id>`: the user's approval (the guard always asks) applies the change. */
export function approveProposal(id, cwd, argv = []) {
  const args = [...argv], pin = flag(args, '--sha');
  const { d, p } = loadProposal(cwd, id);
  if (p.status !== 'proposed') fail(`proposal is ${p.status}`);
  if (pin !== undefined && !/^[0-9a-f]{12,64}$/.test(pin)) fail('--sha takes 12 to 64 hex digits of the patch sha256 (shown in the ask)');
  // M9 r2 N3: read the patch once; check, hash and apply these same bytes (a later rewrite of the file cannot slip in)
  const root = rootOf(cwd), x = checkPatch(root, readFileSync(join(d, 'change.patch')));
  if (pin !== undefined && !x.sha.startsWith(pin)) fail(`change.patch (sha256 ${x.sha.slice(0, 12)}) does not match --sha ${pin}; show it again (mis self-improve show ${id})`);
  if (pin === undefined && !p.patchSha) fail(`no recorded patch hash; approve with --sha <sha256 shown in the ask> (mis self-improve show ${id})`);
  if (p.patchSha && p.patchSha !== x.sha) fail(`change.patch changed since it was proposed (sha256 ${p.patchSha.slice(0, 12)} → ${x.sha.slice(0, 12)}); not applied. Propose it again`);
  const r = spawnSync('git', ['apply', '-'], { cwd: root, input: x.bytes, encoding: 'utf8' });
  if (r.status !== 0) fail(`git apply failed: ${r.stderr.trim()}`);
  Object.assign(p, { status: 'applied', approvedAt: now(), appliedSha: x.sha });
  writeJson(join(d, 'proposal.json'), p);
  return { id, status: 'applied', paths: x.paths, sha: x.sha, note: 'Changes are in the working tree, uncommitted; review with git diff.' };
}

// ---------------------------------------------------------------- writer-memory

const EMPTY = (name, genre) => ({ version: '1.0', project: { name, genre: genre ?? null, created: now(), lastModified: now() },
  characters: {}, world: { setting: '', rules: [], atmosphere: '', constraints: [], history: '' }, relationships: [], scenes: [], themes: [], synopsis: {} });
const wmFile = (cwd) => join(projectDir(cwd, 'writer-memory'), 'memory.json');
function wmLoad(cwd) { const m = readJson(wmFile(cwd)); if (!m) fail('no writer memory (mis writer-memory init <project-name>)'); return m; }
function wmSave(cwd, m) {
  const dir = projectDir(cwd, 'writer-memory', 'backups');
  if (existsSync(wmFile(cwd))) copyFileSync(wmFile(cwd), join(dir, `memory-${stamp()}.json`));
  m.project.lastModified = now();
  writeJson(wmFile(cwd), m);
  return m;
}
const parseValue = (v) => { try { return JSON.parse(v); } catch { return v; } };
const fields = (args) => { const o = {}; for (let i = 0; i < args.length; i += 2) { if (!args[i]?.startsWith('--')) fail(`expected --field value, got ${args[i]}`); o[args[i].slice(2)] = parseValue(args[i + 1] ?? ''); } return o; };
const relOf = (m, a, b) => m.relationships.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));

function writerMemory([sub, ...a], cwd) {
  if (sub === 'init') {
    if (!a[0]) fail('usage: mis writer-memory init <project-name> [--genre g]');
    if (existsSync(wmFile(cwd))) fail(`writer memory exists: ${wmFile(cwd)}`);
    const args = [...a], genre = flag(args, '--genre');
    return wmSave(cwd, EMPTY(args.join(' '), genre)).project;
  }
  const m = wmLoad(cwd);
  const [x, y, ...rest] = a;
  switch (`${sub} ${x ?? ''}`.trim()) {
    case 'status': return { project: m.project, characters: Object.keys(m.characters).length, relationships: m.relationships.length, scenes: m.scenes.length, themes: m.themes.length };
    case 'char add': if (!y) fail('char add <name> [--field value]...'); if (m.characters[y]) fail(`character ${y} exists`); m.characters[y] = fields(rest); wmSave(cwd, m); return { [y]: m.characters[y] };
    case 'char list': return { characters: Object.keys(m.characters) };
    case 'char update': if (!m.characters[y]) fail(`no character ${y}`); if (rest.length < 2) fail('char update <name> <field> <value>'); m.characters[y][rest[0]] = parseValue(rest.slice(1).join(' ')); wmSave(cwd, m); return { [y]: m.characters[y] };
    case 'char remove': if (!m.characters[y]) fail(`no character ${y}`); delete m.characters[y]; wmSave(cwd, m); return { removed: y };
    case 'rel add': {
      const [c2, t] = rest;
      if (!m.characters[y] || !m.characters[c2] || !t) fail('rel add <char1> <char2> <type> (both characters must exist)');
      if (relOf(m, y, c2)) fail('relationship exists; use rel update');
      const r = { id: `rel_${String(m.relationships.length + 1).padStart(3, '0')}`, from: y, to: c2, type: t, evolution: [], created: now() };
      m.relationships.push(r); wmSave(cwd, m); return r;
    }
    case 'rel update': { const r = relOf(m, y, rest[0]); if (!r || !rest[1]) fail('rel update <char1> <char2> <event>'); r.evolution.push({ timestamp: now(), change: rest.slice(1).join(' ') }); wmSave(cwd, m); return r; }
    case 'rel show': { const r = relOf(m, y, rest[0]); if (!r) fail('no such relationship'); return r; }
    case 'rel remove': { const r = relOf(m, y, rest[0]); if (!r) fail('no such relationship'); m.relationships = m.relationships.filter((q) => q !== r); wmSave(cwd, m); return { removed: r.id }; }
    case 'scene add': { if (!y) fail('scene add <title> [--field value]...'); const s = { id: `scene-${String(m.scenes.length + 1).padStart(3, '0')}`, title: y, ...fields(rest) }; m.scenes.push(s); wmSave(cwd, m); return s; }
    case 'scene list': return { scenes: m.scenes.map(({ id, title }) => ({ id, title })) };
    case 'scene show': { const s = m.scenes.find((q) => q.id === y || q.title === y); if (!s) fail(`no scene ${y}`); return s; }
    case 'scene remove': { const s = m.scenes.find((q) => q.id === y); if (!s) fail(`no scene ${y}`); m.scenes = m.scenes.filter((q) => q !== s); wmSave(cwd, m); return { removed: s.id }; }
    case 'theme add': { if (!y) fail('theme add <name> [--field value]...'); const t = { name: y, ...fields(rest) }; m.themes.push(t); wmSave(cwd, m); return t; }
    case 'world set': if (!y || !rest.length) fail('world set <field> <value>'); m.world[y] = parseValue(rest.join(' ')); wmSave(cwd, m); return m.world;
    default: break;
  }
  if (sub === 'char' && x && m.characters[x]) return { [x]: m.characters[x] };
  if (sub === 'rel' && x && y) { const r = relOf(m, x, y); if (r) return r; }
  if (sub === 'query') {
    const q = a.join(' ').toLowerCase();
    if (!q) fail('query <text>');
    const has = (v) => JSON.stringify(v).toLowerCase().includes(q);
    return { characters: Object.entries(m.characters).filter(([k, v]) => k.toLowerCase().includes(q) || has(v)).map(([k]) => k),
      relationships: m.relationships.filter(has).map((r) => r.id), scenes: m.scenes.filter(has).map((s) => s.id), themes: m.themes.filter(has).map((t) => t.name), world: has(m.world) };
  }
  if (sub === 'export') {
    const md = [`# ${m.project.name}`, '', '## Characters', ...Object.entries(m.characters).map(([k, v]) => `### ${k}\n${Object.entries(v).map(([f, val]) => `- ${f}: ${JSON.stringify(val)}`).join('\n')}`),
      '', '## World', ...Object.entries(m.world).map(([f, v]) => `- ${f}: ${JSON.stringify(v)}`), '', '## Relationships', ...m.relationships.map((r) => `- ${r.from} ↔ ${r.to} (${r.type})${r.evolution.map((e) => `\n  - ${e.change}`).join('')}`),
      '', '## Scenes', ...m.scenes.map((s) => `- ${s.id} ${s.title}`), '', '## Themes', ...m.themes.map((t) => `- ${t.name}`), ''].join('\n');
    const f = join(projectDir(cwd, 'writer-memory', 'exports'), `export-${stamp()}.md`);
    writeFileSync(f, md);
    return { export: f };
  }
  if (sub === 'backup') { const f = join(projectDir(cwd, 'writer-memory', 'backups'), `memory-${stamp()}.json`); copyFileSync(wmFile(cwd), f); return { backup: f }; }
  return fail('usage: mis writer-memory init <name> | status | char add|update|remove|list|<name> | rel add|update|remove|show | scene add|show|list|remove | theme add | world set | query <text> | export | backup');
}

export const researchCommands = { research, autoresearch, 'self-improve': selfImprove, 'writer-memory': writerMemory };
