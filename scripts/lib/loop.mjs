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

/** Decide what the Stop hook does for an active loop. run = loadRun(cwd) or null; v = verdict result or null. */
export function loopDecision(loop, run, v) {
  const state = run?.state.state;
  if (state === 'REPORTED' && v?.verdict === 'VERIFIED') return { end: 'verified', message: `Make It Ship loop finished: run ${run.state.runId} is REPORTED with verdict VERIFIED.` };
  if (state === 'BLOCKED') return { message: `Make It Ship loop paused: run ${run.state.runId} is BLOCKED (${run.state.blockedReason ?? 'needs the user'}). The user must resolve it; the loop resumes on the next stop after that.` };
  if (loop.iteration >= loop.max) return { end: 'limit', message: `Make It Ship loop stopped at its iteration limit (${loop.max}) without a VERIFIED report. Tell the user what is left.` };
  const n = loop.iteration + 1;
  const status = !run || run.state.state === 'CANCELLED'
    ? 'There is no active run yet: invoke /make-it-ship:run with the task.'
    : `Run ${run.state.runId} is ${state}, verdict ${v?.verdict ?? 'unknown'}${v?.reasons?.length ? `: ${v.reasons.slice(0, 5).join('; ')}` : ''}. Continue from there (/make-it-ship:resume if unsure); write the report with mis report once the verdict is VERIFIED.`;
  return { iterate: n, block: `[MAKE IT SHIP LOOP ${n}/${loop.max}] The work is not verified yet, so keep going.\nTask: ${loop.task}\n${status}\nThe loop ends by itself when the run is REPORTED with verdict VERIFIED. If the user asks to stop, run mis loop cancel.` };
}
