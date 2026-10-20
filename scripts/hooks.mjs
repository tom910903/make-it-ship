#!/usr/bin/env node
// Always-on hooks (M6): SessionStart, SubagentStart, ... One entry, event name in argv[2].
// Fail-open by design: any error or bad input prints nothing and exits 0 so a session is never blocked.
// (guard.mjs is the separate fail-closed PreToolUse hook.)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleRules, currentStyle } from './lib/style.mjs';
import { globalConfig } from './lib/home.mjs';
import { contextPercent } from './lib/context.mjs';

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
  async UserPromptSubmit(input) {
    const { detectKeywords, styleSwitch, learnedSkills, promptContext } = await import('./lib/keywords.mjs');
    const { homeDir } = await import('./lib/home.mjs');
    const prompt = String(input.prompt ?? '');
    const style = styleSwitch(prompt);
    if (style) { const { setStyle } = await import('./lib/style.mjs'); setStyle(style); }
    let root = null;
    try { const { repoRoot } = await import('./lib/tree-hash.mjs'); root = repoRoot(input.cwd || process.cwd()); } catch { /* not a repo */ }
    const text = promptContext(detectKeywords(prompt, { disabled: globalConfig().keywords.disabled }), style, learnedSkills(prompt, root, homeDir()));
    return context('UserPromptSubmit', text);
  },
  async Stop(input) {
    const cwd = input.cwd || process.cwd();
    const { readLoop, writeLoop, endLoop, loopDecision } = await import('./lib/loop.mjs');
    const loop = readLoop(cwd);
    if (loop.active) {
      let run = null, v = null;
      try {
        const { loadRun } = await import('./lib/state.mjs');
        run = loadRun(cwd);
        if (run) {
          const { verdictContext } = await import('./lib/commands.mjs');
          const { verdict } = await import('./lib/verdict.mjs');
          v = verdict(run.state, verdictContext(run, cwd));
        }
      } catch { /* not a repo or no run */ }
      const d = loopDecision(loop, run, v);
      if (d.end) endLoop(cwd, d.end);
      if (d.iterate) { writeLoop(cwd, { ...loop, iteration: d.iterate }); return { decision: 'block', reason: d.block }; }
      return { systemMessage: d.message };
    }
    const pct = contextPercent(input.transcript_path);
    return pct >= 75 ? { systemMessage: `Context is about ${pct}% full. Consider /compact or a fresh session; run state is kept (mis status / /make-it-ship:resume).` } : null;
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
