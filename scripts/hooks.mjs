#!/usr/bin/env node
// Always-on hooks (M6): SessionStart, SubagentStart, ... One entry, event name in argv[2].
// Fail-open by design: any error or bad input prints nothing and exits 0 so a session is never blocked.
// (guard.mjs is the separate fail-closed PreToolUse hook.)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleRules, currentStyle } from './lib/style.mjs';
import { globalConfig } from './lib/home.mjs';
import { contextPercent } from './lib/context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const context = (event, text) => text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null;

/** Text of the last assistant message in a transcript (for <remember> tags). */
function lastAssistantText(path) {
  if (!path) return '';
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 50; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e.type === 'assistant') return (e.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    } catch { /* partial line */ }
  }
  return '';
}

const handlers = {
  async SessionStart(input) {
    const cwd = input.cwd || process.cwd();
    const { disciplineText } = await import('./lib/discipline.mjs');
    const parts = [disciplineText(ROOT), styleRules(currentStyle(input.session_id))];
    try {
      const { loadRun, TERMINAL } = await import('./lib/state.mjs');
      const run = loadRun(cwd);
      if (run && !TERMINAL.includes(run.state.state)) {
        parts.push(`There is an active Make It Ship run ${run.state.runId} (state ${run.state.state}). To continue it, invoke /make-it-ship:resume; to drop it, run mis cancel.`);
      }
      const f = (await import('./lib/home.mjs')).readHome('freeze.json');
      const { realpathSync } = await import('node:fs');
      const frozen = f?.dir && f.root && f.root === realpathSync((await import('./lib/tree-hash.mjs')).repoRoot(cwd)) ? f.dir : null;
      if (frozen) parts.push(`Edits are frozen to ${frozen}: Write/Edit outside it are denied until the user runs mis unfreeze.`);
      const loop = (await import('./lib/loop.mjs')).readLoop(cwd);
      if (loop.active && (!loop.session || loop.session === input.session_id)) parts.push(`There is an active Make It Ship loop: "${loop.task}" (${loop.iteration}/${loop.max} continues used). Keep working toward a REPORTED, VERIFIED run, or ask the user and run mis loop cancel.`);
    } catch {
      try { const f = (await import('./lib/home.mjs')).readHome('freeze.json'); if (f?.dir && !f.root) parts.push(`Edits are frozen to ${f.dir}: Write/Edit outside it are denied until the user runs mis unfreeze.`); } catch { /* no home */ }
    }
    try { (await import('./lib/posttool.mjs')).pruneSessions(); } catch { /* best effort */ }
    // M9-A: daily cleanup of finished state, config check, update notice (cache only), status-line hint. Each fails open.
    try { (await import('./lib/update.mjs')).dailyMaintenance((await import('./lib/state.mjs')).stateRoot(cwd)); } catch { /* outside a repo */ }
    try {
      const { loadConfig } = await import('./lib/config.mjs');
      const c = loadConfig((await import('./lib/tree-hash.mjs')).repoRoot(cwd));
      if (c.exists && c.errors.length) parts.push(`.make-it-ship.json is invalid (${c.errors.slice(0, 3).join('; ')}): mis start and mis check refuse it until it is fixed. Tell the user.`);
    } catch { /* outside a repo */ }
    try { parts.push((await import('./lib/update.mjs')).updateNotice()); } catch { /* fail-open */ }
    try { parts.push((await import('./lib/install.mjs')).statusLineNotice()); } catch { /* fail-open */ }
    try {
      const mem = await import('./lib/memory.mjs'), wiki = await import('./lib/wiki.mjs');
      try { (await import('./lib/state.mjs')).stateRoot(cwd); mem.projectEnsure(cwd); } catch { /* outside a repo: nothing to detect */ }
      // After compaction the preserved block already carries the priority notes and directives; add only the project facts.
      parts.push(input.source === 'compact' ? [mem.preCompactContext(cwd), mem.projectContext(cwd)].filter(Boolean).join('\n\n') : mem.memorySessionContext(cwd), wiki.wikiSessionContext(cwd));
      if (input.source === 'compact') parts.push(wiki.wikiPreCompact(cwd));
    } catch { /* memory and wiki are optional context */ }
    const { buildCodeMap } = await import('./lib/codemap.mjs');
    parts.push(buildCodeMap(cwd));
    return context('SessionStart', parts.filter(Boolean).join('\n\n'));
  },
  async UserPromptSubmit(input) {
    const { detectKeywords, styleSwitch, learnedSkills, promptContext } = await import('./lib/keywords.mjs');
    const { homeDir } = await import('./lib/home.mjs');
    const prompt = String(input.prompt ?? '');
    let style = styleSwitch(prompt);
    if (style) { try { (await import('./lib/style.mjs')).setStyle(style, input.session_id || 'default'); } catch { style = null; /* unwritable home: no notice, keep the rest */ } }
    let root = null;
    try { const { repoRoot } = await import('./lib/tree-hash.mjs'); root = repoRoot(input.cwd || process.cwd()); } catch { /* not a repo */ }
    const text = promptContext(detectKeywords(prompt, { disabled: globalConfig().keywords.disabled }), style, learnedSkills(prompt, root, homeDir()));
    return context('UserPromptSubmit', text);
  },
  async Stop(input) {
    const cwd = input.cwd || process.cwd();
    try { (await import('./lib/memory.mjs')).extractRemember(typeof input.last_assistant_message === 'string' ? input.last_assistant_message : lastAssistantText(input.transcript_path), cwd); } catch { /* best effort */ }
    const { loopForSession, writeLoop, endLoop, loopDecision, freshEvidence } = await import('./lib/loop.mjs');
    const loop = loopForSession(cwd, input.session_id);
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
      const d = loopDecision(loop, run, v, input.stop_hook_active === true, run ? freshEvidence(run, loop.startedAt) : false);
      if (d.end) endLoop(cwd, d.end);
      else if (d.save || d.iterate) writeLoop(cwd, { ...loop, ...d.save, ...(d.iterate ? { iteration: d.iterate } : {}) });
      if (d.iterate) return { decision: 'block', reason: d.block };
      return { systemMessage: d.message };
    }
    const pct = contextPercent(input.transcript_path);
    return pct >= 75 ? { systemMessage: `Context is about ${pct}% full. Consider /compact or a fresh session; run state is kept (mis status / /make-it-ship:resume).` } : null;
  },
  async PostToolUse(input) {
    const { readSession, writeSession, matchingRules, isTestCommand, EDIT_REMINDER_EVERY } = await import('./lib/posttool.mjs');
    const sess = readSession(input.session_id);
    const ti = input.tool_input ?? {};
    const out = [];
    const file = ti.file_path ?? ti.notebook_path ?? ti.path;
    if (file) {
      try {
        const { resolve } = await import('node:path');
        const { repoRoot } = await import('./lib/tree-hash.mjs');
        const abs = resolve(input.cwd || process.cwd(), String(file));
        const seen = new Set(sess.rules ?? []);
        const fresh = matchingRules(repoRoot(dirname(abs)), abs).filter((r) => !seen.has(r.hash));
        for (const r of fresh) { seen.add(r.hash); out.push(`Project rule (${r.path}):\n${r.body}`); }
        sess.rules = [...seen];
      } catch { /* outside a repo or unreadable rules */ }
    }
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) {
      sess.edits = (sess.edits ?? 0) + 1;
      if (sess.edits % EDIT_REMINDER_EVERY === 0) out.push(`${sess.edits} edits since the last test run: run the tests (or mis check) and read the output before claiming progress.`);
    }
    if (input.tool_name === 'Bash' && isTestCommand(ti.command)) {
      sess.edits = 0; sess.failures = {};
      try { (await import('./lib/memory.mjs')).learnTestCommand(input.cwd || process.cwd(), ti.command); } catch { /* best effort */ }
    }
    // <remember> tags count only in subagent results (the model's own words), never in files or command output it read.
    if (['Agent', 'Task'].includes(input.tool_name)) {
      const r = input.tool_response;
      const text = typeof r === 'string' ? r : Array.isArray(r?.content) ? r.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : typeof r?.result === 'string' ? r.result : '';
      try { (await import('./lib/memory.mjs')).extractRemember(text, input.cwd || process.cwd()); } catch { /* best effort */ }
    }
    // M9-D telemetry: a no-op unless the user turned it on (mis telemetry on); local file only.
    if (input.tool_name === 'Skill') (await import('./lib/telemetry.mjs')).logEvent({ event: 'skill_run', skill: String(ti.skill ?? ti.command ?? ''), outcome: 'invoked' });
    try { writeSession(input.session_id, sess); } catch { /* unwritable home */ }
    return context('PostToolUse', out.join('\n\n'));
  },
  async PostToolUseFailure(input) {
    const { readSession, writeSession } = await import('./lib/posttool.mjs');
    const sess = readSession(input.session_id);
    const key = `${input.tool_name}:${String(input.tool_input?.command ?? input.tool_input?.file_path ?? '').slice(0, 200)}`;
    sess.failures = { ...sess.failures, [key]: (sess.failures?.[key] ?? 0) + 1 };
    writeSession(input.session_id, sess);
    const n = sess.failures[key];
    return n >= 3 && n % 3 === 0
      ? context('PostToolUseFailure', `This exact ${input.tool_name} call has failed ${n} times. Stop retrying it: find the root cause first (reproduce, read the full error, test one hypothesis at a time; /make-it-ship:debug).`)
      : null;
  },
  async PreCompact(input) {
    const cwd = input.cwd || process.cwd();
    const text = [(await import('./lib/memory.mjs')).preCompactContext(cwd), (await import('./lib/wiki.mjs')).wikiPreCompact(cwd)].filter(Boolean).join('\n\n');
    return text ? { systemMessage: `Make It Ship keeps this across compaction (re-injected at the next session start):\n${text}` } : null;
  },
  async SessionEnd(input) {
    (await import('./lib/wiki.mjs')).wikiSessionEnd(input.cwd || process.cwd(), input);
    return null;
  },
  SubagentStart(input) {
    const rules = styleRules(currentStyle(input.session_id));
    if (!rules) return null;
    let re = null;
    try { if (globalConfig().subagentMatcher) re = new RegExp(globalConfig().subagentMatcher, 'i'); } catch { re = null; }
    if (re && input.agent_type && !re.test(String(input.agent_type))) return null;
    return context('SubagentStart', rules);
  },
};

let input = {};
try {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  try { input = raw.trim() ? JSON.parse(raw.replace(/^﻿/, '')) : {}; } catch { input = {}; }
  try { (await import('./lib/trace.mjs')).appendTrace({ cwd: input.cwd, hook: process.argv[2], tool: input.tool_name }); } catch { /* tracing is optional */ }
  const out = await handlers[process.argv[2]]?.(input);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
} catch (e) {
  // fail-open; recorded so `mis doctor session` can show recent hook errors
  try { (await import('./lib/trace.mjs')).appendTrace({ cwd: input?.cwd || process.cwd(), hook: process.argv[2], error: String(e?.message ?? e).slice(0, 300) }); } catch { /* nothing */ }
}
process.exit(0);
