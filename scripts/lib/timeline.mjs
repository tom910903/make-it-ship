// Project timeline (M9-F9, absorbs gstack-timeline-log/read and gstack-session-kind; see THIRD_PARTY_NOTICES.md).
// Events outside a run (session start/end, subagents, skills, `mis timeline log`) go to <git-common-dir>/make-it-ship/timeline.jsonl
// (per-user home outside a repo); trace_timeline merges them with run events and hook traces. Never throws.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot } from './state.mjs';
import { homeDir } from './home.mjs';

export function timelineFile(cwd) {
  let dir;
  try { dir = stateRoot(cwd); } catch { dir = homeDir(); }
  return join(dir, 'timeline.jsonl');
}

/** interactive | headless | team-worker. Only a positive signal makes a session headless (a human is assumed otherwise). */
export function sessionKind(env = process.env) {
  if (env.MIS_TEAM_ID) return 'team-worker';
  if (env.MIS_HEADLESS) return 'headless';
  if (env.CLAUDE_CODE_ENTRYPOINT === 'cli') return 'interactive';
  if (env.CI || env.GITHUB_ACTIONS) return 'headless';
  return 'interactive';
}

export function timelineLog(cwd, event) {
  try {
    const f = timelineFile(cwd);
    mkdirSync(join(f, '..'), { recursive: true });
    appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  } catch { /* fail-open */ }
}

export function readTimeline(cwd) {
  try {
    const f = timelineFile(cwd);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });
  } catch { return []; }
}

export const timelineText = (e) => {
  const { at, event, ...rest } = e;
  return [event, ...Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)].join(' ');
};
