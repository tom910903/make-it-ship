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
import { readSession, writeSession } from './lib/home.mjs';
import { timelineLog, sessionKind } from './lib/timeline.mjs';

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
    const parts = [disciplineText(ROOT, { proactive: globalConfig().proactive !== false }), styleRules(currentStyle(input.session_id))];
    if (input.cwd) timelineLog(cwd, { event: 'session-start', session: input.session_id, kind: sessionKind(), source: input.source });
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
      const ds = (await import('./lib/home.mjs')).readHome('debug-scope.json');
      if (ds?.paths?.length && ds.root === realpathSync((await import('./lib/tree-hash.mjs')).repoRoot(cwd))) parts.push(`A debug scope is set (${ds.paths.join(', ')}): the guard asks before Write/Edit outside it. Clear it with mis debug scope --clear when the fix is done.`);
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
      const todos = input.source === 'compact' ? (await import('./lib/tracking.mjs')).todoBlock(readSession(input.session_id).todos) : '';
      parts.push(input.source === 'compact' ? [mem.preCompactContext(cwd), todos, mem.projectContext(cwd)].filter(Boolean).join('\n\n') : mem.memorySessionContext(cwd), wiki.wikiSessionContext(cwd));
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
    // F11: a lasting instruction is only suggested for project memory, never saved without the user.
    const directives = (await import('./lib/tracking.mjs')).directiveCandidates(prompt);
    const hint = directives.length ? `This prompt contains what looks like a lasting instruction:\n${directives.map((d) => `- "${d}"`).join('\n')}\nIf the user wants it kept for future sessions, offer to save it with the project_memory_add_directive tool; do not save it without asking.` : '';
    return context('UserPromptSubmit', [text, hint].filter(Boolean).join('\n\n'));
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
    // No loop owns this stop: workflow drift (F5) first, then the opt-in simplifier (F6), then the context warning.
    const T = await import('./lib/tracking.mjs');
    const sess = readSession(input.session_id);
    try {
      const { loadRun } = await import('./lib/state.mjs');
      const run = loadRun(cwd);
      if (run?.state.state === 'EXECUTING' && sess.files?.length) {
        const d = T.driftDecision(run, (await import('./lib/commands.mjs')).verdictContext(run, cwd), sess);
        if (d?.reset && sess.drift) { delete sess.drift; writeSession(input.session_id, sess); }
        if (d?.reason) { sess.drift = d.save; writeSession(input.session_id, sess); return { decision: 'block', reason: d.reason }; }
      }
    } catch { /* not a repo or no run */ }
    const s = input.stop_hook_active === true ? null : T.simplifyDecision(globalConfig(), sess);
    if (s) { sess.simplified = s.key; writeSession(input.session_id, sess); return { decision: 'block', reason: s.reason }; }
    const pct = contextPercent(input.transcript_path);
    return pct >= 75 ? { systemMessage: `Context is about ${pct}% full. Consider /compact or a fresh session; run state is kept (mis status / /make-it-ship:resume).` } : null;
  },
  async PostToolUse(input) {
    const { matchingRules, isTestCommand, EDIT_REMINDER_EVERY } = await import('./lib/posttool.mjs');
    const T = await import('./lib/tracking.mjs');
    const sess = readSession(input.session_id);
    const ti = input.tool_input ?? {};
    const out = [];
    const file = ti.file_path ?? ti.notebook_path ?? ti.path;
    const isEdit = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name);
    if (file) {
      const { resolve } = await import('node:path');
      const abs = resolve(input.cwd || process.cwd(), String(file));
      if (isEdit) T.noteEdit(sess, abs);
      if (input.tool_name === 'Read') T.noteRead(sess, abs);
      try {
        const { repoRoot } = await import('./lib/tree-hash.mjs');
        const root = repoRoot(dirname(abs));
        const seen = new Set(sess.rules ?? []);
        const fresh = matchingRules(root, abs).filter((r) => !seen.has(r.hash));
        for (const r of fresh) { seen.add(r.hash); out.push(`Project rule (${r.path}):\n${r.body}`); }
        sess.rules = [...seen];
      } catch { /* outside a repo or unreadable rules */ }
    }
    if (input.tool_name === 'TodoWrite') sess.todos = T.todosFrom(ti) ?? sess.todos;
    if (input.tool_name === 'Skill' && ti.skill) {
      sess.skills = [...new Set([...(sess.skills ?? []), String(ti.skill)])].slice(-30);
      if (input.cwd) timelineLog(input.cwd, { event: 'skill', skill: String(ti.skill), session: input.session_id });
    }
    if (isEdit) {
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
    const todos = (await import('./lib/tracking.mjs')).todoBlock(readSession(input.session_id).todos);
    const text = [(await import('./lib/memory.mjs')).preCompactContext(cwd), todos, (await import('./lib/wiki.mjs')).wikiPreCompact(cwd)].filter(Boolean).join('\n\n');
    return text ? { systemMessage: `Make It Ship keeps this across compaction (re-injected at the next session start):\n${text}` } : null;
  },
  async SessionEnd(input) {
    const cwd = input.cwd || process.cwd();
    (await import('./lib/wiki.mjs')).wikiSessionEnd(cwd, input);
    const T = await import('./lib/tracking.mjs');
    const sess = readSession(input.session_id);
    try { T.clearAgents(input.session_id); } catch { /* best effort */ }
    if (!input.cwd) return null; // the summary and timeline belong to the host's project, never to the process cwd
    timelineLog(cwd, { event: 'session-end', session: input.session_id, reason: input.reason });
    try {
      const { stateRoot, loadRun } = await import('./lib/state.mjs');
      const { realpathSync, mkdirSync, writeFileSync } = await import('node:fs');
      const { repoRoot } = await import('./lib/tree-hash.mjs');
      const dir = join(stateRoot(cwd), 'session-summaries');
      mkdirSync(dir, { recursive: true });
      const id = String(input.session_id || 'default').replace(/[^\w.-]/g, '_');
      const root = realpathSync(repoRoot(cwd));
      const reads = T.readsUnder(sess.reads, root); // reads in other repositories are not this project's hot paths
      writeFileSync(join(dir, `${id}.md`), T.sessionSummary({ id, reason: input.reason, sess: { ...sess, reads }, run: loadRun(cwd), root }));
      if (Object.keys(reads).length) {
        const mem = await import('./lib/memory.mjs');
        const m = mem.projectEnsure(cwd);
        mem.projectSave(cwd, { ...m, hotPaths: T.mergeHotPaths(m.hotPaths, reads) });
      }
    } catch { /* outside a repo: the summary needs the repository state dir */ }
    return null;
  },
  async SubagentStop(input) {
    const cwd = input.cwd || process.cwd();
    const T = await import('./lib/tracking.mjs');
    try { T.agentStop(input.session_id, input.agent_id); } catch { /* best effort */ }
    if (input.cwd) timelineLog(cwd, { event: 'subagent-stop', session: input.session_id, agent: input.agent_type });
    if (input.stop_hook_active === true) return null; // asked once already; never hold a subagent twice
    // F2: block once (the finishing subagent is the one who can fix it) when files it reports creating do not exist.
    const { repoRoot } = await import('./lib/tree-hash.mjs');
    const { realpathSync } = await import('node:fs');
    const text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : lastAssistantText(input.agent_transcript_path);
    const missing = T.missingDeliverables(text, cwd, realpathSync(repoRoot(cwd)));
    if (!missing.length) return null;
    return { decision: 'block', reason: `[MAKE IT SHIP] Your report says you created or wrote ${missing.join(', ')}, but ${missing.length > 1 ? 'these files do' : 'that file does'} not exist. Create ${missing.length > 1 ? 'them' : 'it'} now, or correct your report so it names only files that exist.` };
  },
  async PreToolUse(input) {
    // F4: reminders only. guard.mjs is the separate fail-closed hook that decides; this one never returns a decision.
    const T = await import('./lib/tracking.mjs');
    const out = [];
    if (['Agent', 'Task'].includes(input.tool_name)) {
      const { running } = T.agentCounts(input.session_id);
      if (running >= 4) out.push(`${running} subagents are already running in this session: wait for their results before starting more.`);
      const sess = readSession(input.session_id);
      if (!sess.deliverHint) {
        out.push('Name the exact files the subagent must create and ask it to list them in its report; the files it reports are checked when it stops.');
        sess.deliverHint = true; writeSession(input.session_id, sess);
      }
    }
    if (input.tool_name === 'Bash' && /\bgit\s+commit\b/.test(String(input.tool_input?.command ?? ''))) {
      const c = T.todoCounts(readSession(input.session_id).todos);
      if (c && c.done < c.total) out.push(`${c.total - c.done} of ${c.total} todos are still open; commit only what is finished and verified.`);
    }
    return context('PreToolUse', out.join('\n'));
  },
  async PermissionRequest(input) {
    return (await import('./lib/readonly.mjs')).permissionDecision(input);
  },
  async SubagentStart(input) {
    // F1: track first, so the count is right even when the style is off.
    try { (await import('./lib/tracking.mjs')).agentStart(input.session_id, input.agent_id, input.agent_type); } catch { /* best effort */ }
    if (input.cwd) timelineLog(input.cwd, { event: 'subagent-start', session: input.session_id, agent: input.agent_type });
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
