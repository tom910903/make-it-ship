// Hook trace log (absorbs OMC's agent-replay trace): one JSON line per hook decision, per user, outside any repo.
// Hooks call appendTrace({cwd, hook, ...}); trace_timeline/trace_summary filter by repo root and run time.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir } from './home.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
export const traceFile = () => join(homeDir(), 'trace.jsonl');

/** Append one trace event; never throws (hooks must fail open). Rotates to trace.1.jsonl past 5 MB. */
export function appendTrace(event) {
  try {
    const f = traceFile();
    mkdirSync(homeDir(), { recursive: true });
    if (existsSync(f) && statSync(f).size > MAX_BYTES) renameSync(f, join(homeDir(), 'trace.1.jsonl'));
    // cwd is always a string (a hook's malformed input must not break readers such as mis doctor session)
    appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), ...event, cwd: typeof event.cwd === 'string' ? event.cwd : process.cwd() }) + '\n');
  } catch { /* fail-open */ }
}

/** Trace events (rotated file first), oldest first; unparseable lines skipped. */
export function readTrace() {
  return ['trace.1.jsonl', 'trace.jsonl'].flatMap((n) => {
    const f = join(homeDir(), n);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });
  });
}
