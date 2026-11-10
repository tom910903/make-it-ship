#!/usr/bin/env node
// Detached memory worker. Stop hook: node memory-worker.mjs <cwd> <session> <transcript> <model> (summarize the turn).
// SessionStart: node memory-worker.mjs --import <cwd> (claude-mem history of this project, once). Never throws.
import { summarizeTurn } from './lib/summarize.mjs';
import { timelineLog } from './lib/timeline.mjs';

if (process.argv[2] === '--import') {
  const cwd = process.argv[3];
  try { timelineLog(cwd, { event: 'claude-mem-import', ...(await (await import('./lib/claude-mem-import.mjs')).importClaudeMem(cwd)) }); } catch (e) { timelineLog(cwd, { event: 'claude-mem-import', error: String(e?.message ?? e).slice(0, 200) }); }
  process.exit(0);
}
const [cwd, session, transcriptPath, model] = process.argv.slice(2);
try {
  const r = summarizeTurn(cwd, { session, transcriptPath, model: model || undefined });
  if (!r.skipped) timelineLog(cwd, { event: 'memory-summary', session, ...r });
} catch (e) { timelineLog(cwd, { event: 'memory-summary', session, error: String(e?.message ?? e).slice(0, 200) }); }
