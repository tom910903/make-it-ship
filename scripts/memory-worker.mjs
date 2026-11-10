#!/usr/bin/env node
// Detached memory summarizer (started by the Stop hook): node memory-worker.mjs <cwd> <session> <transcript> <model>. Never throws.
import { summarizeTurn } from './lib/summarize.mjs';
import { timelineLog } from './lib/timeline.mjs';

const [cwd, session, transcriptPath, model] = process.argv.slice(2);
try {
  const r = summarizeTurn(cwd, { session, transcriptPath, model: model || undefined });
  if (!r.skipped) timelineLog(cwd, { event: 'memory-summary', session, ...r });
} catch (e) { timelineLog(cwd, { event: 'memory-summary', session, error: String(e?.message ?? e).slice(0, 200) }); }
