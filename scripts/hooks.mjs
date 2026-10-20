#!/usr/bin/env node
// Always-on hooks (M6): SessionStart, SubagentStart, ... One entry, event name in argv[2].
// Fail-open by design: any error or bad input prints nothing and exits 0 so a session is never blocked.
// (guard.mjs is the separate fail-closed PreToolUse hook.)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleRules, currentStyle } from './lib/style.mjs';
import { globalConfig } from './lib/home.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = (event, text) => text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null;

const handlers = {
  async SessionStart(input) {
    const cwd = input.cwd || process.cwd();
    const { disciplineText } = await import('./lib/discipline.mjs');
    const parts = [disciplineText(ROOT), styleRules(currentStyle())];
    try {
      const { loadRun, TERMINAL } = await import('./lib/state.mjs');
      const run = loadRun(cwd);
      if (run && !TERMINAL.includes(run.state.state)) {
        parts.push(`There is an active Make It Ship run ${run.state.runId} (state ${run.state.state}). To continue it, invoke /make-it-ship:resume; to drop it, run mis cancel.`);
      }
    } catch { /* not a git repo */ }
    const { buildCodeMap } = await import('./lib/codemap.mjs');
    parts.push(buildCodeMap(cwd));
    return context('SessionStart', parts.filter(Boolean).join('\n\n'));
  },
  SubagentStart(input) {
    const rules = styleRules(currentStyle());
    if (!rules) return null;
    let re = null;
    try { if (globalConfig().subagentMatcher) re = new RegExp(globalConfig().subagentMatcher, 'i'); } catch { re = null; }
    if (re && input.agent_type && !re.test(String(input.agent_type))) return null;
    return context('SubagentStart', rules);
  },
};

try {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  let input = {};
  try { input = raw.trim() ? JSON.parse(raw.replace(/^﻿/, '')) : {}; } catch { input = {}; }
  const out = await handlers[process.argv[2]]?.(input);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
} catch { /* fail-open */ }
process.exit(0);
