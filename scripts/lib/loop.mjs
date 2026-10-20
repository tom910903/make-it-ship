// Persistent loop mode (absorbs OMC ralph/autopilot persistence; see THIRD_PARTY_NOTICES.md).
// The Stop hook keeps the session working until the run is REPORTED with verdict VERIFIED, the run is BLOCKED
// (needs the user), the iteration limit is hit, or the user cancels. Ending is evidence-based, never self-declared.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot } from './state.mjs';
import { homeDir } from './home.mjs';

function loopPath(cwd) {
  let dir;
  try { dir = stateRoot(cwd); } catch { dir = homeDir(); }
  return join(dir, 'loop.json');
}

export function readLoop(cwd) {
  try { return JSON.parse(readFileSync(loopPath(cwd), 'utf8')); } catch { return { active: false }; }
}

export function writeLoop(cwd, s) {
  const p = loopPath(cwd);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(s, null, 2) + '\n');
  renameSync(`${p}.tmp`, p);
  return s;
}

export function startLoop(cwd, task, max = 20) {
  if (!task) throw new Error('usage: mis loop start [--max N] <task>');
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a positive integer');
  if (readLoop(cwd).active) throw new Error('a loop is already active (mis loop status / mis loop cancel)');
  return writeLoop(cwd, { active: true, task, iteration: 0, max, startedAt: new Date().toISOString() });
}

export function endLoop(cwd, why) {
  const s = readLoop(cwd);
  return existsSync(loopPath(cwd)) ? writeLoop(cwd, { ...s, active: false, endedAt: new Date().toISOString(), endReason: why }) : { active: false };
}

export const STALL_LIMIT = 3;

/** Decide what the Stop hook does for an active loop. run = loadRun(cwd) or null; v = verdict result or null;
 *  reentrant = the host's stop_hook_active (the model already continued once because of this hook). */
export function loopDecision(loop, run, v, reentrant = false) {
  const state = run?.state.state;
  if (state === 'REPORTED' && v?.verdict === 'VERIFIED') return { end: 'verified', message: `Make It Ship loop finished: run ${run.state.runId} is REPORTED with verdict VERIFIED.` };
  if (state === 'BLOCKED') return { message: `Make It Ship loop paused: run ${run.state.runId} is BLOCKED (${run.state.blockedReason ?? 'needs the user'}). The user must resolve it; the loop resumes on the next stop after that.` };
  if (state === 'AWAITING_APPROVAL') return { message: `Make It Ship loop paused: run ${run.state.runId} is waiting for the user to approve the plan (mis approve plan). The loop resumes after that.` };
  if (loop.iteration >= loop.max) return { end: 'limit', message: `Make It Ship loop stopped at its iteration limit (${loop.max}) without a VERIFIED report. Tell the user what is left.` };
  // No progress between re-entrant stops → pause instead of nagging (the host also caps consecutive blocks).
  const sig = JSON.stringify([run?.state.runId, state, run?.state.plan?.tasks?.map((t) => t.status), run?.state.evidence?.length, run?.state.reviews?.length, v?.verdict, v?.reasons]);
  const stall = reentrant && loop.sig === sig ? (loop.stall ?? 0) + 1 : 0;
  if (stall >= STALL_LIMIT) return { save: { sig, stall: 0 }, message: `Make It Ship loop paused: no progress after ${STALL_LIMIT} continues (run ${state ?? 'not started'}, verdict ${v?.verdict ?? 'n/a'}). Tell the user what blocks progress; the loop resumes on the next stop after a change, or cancel it with mis loop cancel.` };
  const n = loop.iteration + 1;
  const status = !run || run.state.state === 'CANCELLED'
    ? 'There is no active run yet: invoke /make-it-ship:run with the task.'
    : `Run ${run.state.runId} is ${state}, verdict ${v?.verdict ?? 'unknown'}${v?.reasons?.length ? `: ${v.reasons.slice(0, 5).join('; ')}` : ''}. Continue from there (/make-it-ship:resume if unsure); write the report with mis report once the verdict is VERIFIED.`;
  return { iterate: n, save: { sig, stall }, block: `[MAKE IT SHIP LOOP ${n}/${loop.max}] The work is not verified yet, so keep going.\nTask: ${loop.task}\n${status}\nThe loop ends by itself when the run is REPORTED with verdict VERIFIED. If the user asks to stop, run mis loop cancel.` };
}
