import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, git, write, ROOT } from '../helpers.mjs';
import { stateRoot, loadRun } from '../../scripts/lib/state.mjs';
import { tools } from '../../scripts/mcp/tools/knowledge.mjs';
import { disciplineText } from '../../scripts/lib/discipline.mjs';
import { directiveCandidates, missingDeliverables, mergeHotPaths } from '../../scripts/lib/tracking.mjs';
import { sessionKind } from '../../scripts/lib/timeline.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));
const CC = mkdtempSync(join(tmpdir(), 'mis-cc-')); // CLAUDE_CONFIG_DIR: never the real ~/.claude
const hook = (event, input, env = {}) => {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: CC }; delete e.CLAUDE_CODE_SESSION_ID; delete e.MIS_TEAM_ID; delete e.CI; delete e.GITHUB_ACTIONS; Object.assign(e, env); delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: e });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* none */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json, ctx: json?.hookSpecificOutput?.additionalContext ?? '' };
};
const statusline = (cwd, sid, h) => {
  const env = { ...process.env, MIS_STATE_HOME: h }; delete env.CLAUDE_CODE_SESSION_ID;
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd, session_id: sid }), encoding: 'utf8', env }).stdout;
};

test('F1: SubagentStart/Stop count running agents, 5+ minutes is stale, the status line shows agents and todos', () => {
  const dir = makeRepo(), h = home(), E = { MIS_STATE_HOME: h };
  for (const id of ['a1', 'a2']) assert.equal(hook('SubagentStart', { session_id: 'S', agent_id: id, agent_type: 'explorer', cwd: dir }, E).code, 0);
  assert.match(statusline(dir, 'S', h), / · agents 2 · main\n$/);
  const old = (Date.now() - 6 * 60 * 1000) / 1000;
  utimesSync(join(h, 'agents', 'S', 'a1'), old, old);
  assert.match(statusline(dir, 'S', h), / · agents 2 \(1 stale\) · /);
  hook('SubagentStop', { session_id: 'S', agent_id: 'a1', cwd: dir, last_assistant_message: 'done' }, E);
  assert.match(statusline(dir, 'S', h), / · agents 1 · main/);
  hook('PostToolUse', { session_id: 'S', cwd: dir, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] } }, E);
  assert.equal(statusline(dir, 'S', h), 'MIS ▸ idle · style full · agents 1 · todo 1/3 · main\n');
  assert.equal(statusline(dir, 'OTHER', h), 'MIS ▸ idle · style full · main\n', 'per session');
  writeFileSync(join(h, 'config.json'), JSON.stringify({ style: { default: 'off' } }));
  hook('SubagentStart', { session_id: 'S', agent_id: 'a3', cwd: dir }, E);
  assert.match(statusline(dir, 'S', h), /agents 2/, 'tracked even when the style is off');
  hook('SessionEnd', { session_id: 'S', cwd: dir }, E);
  assert.ok(!existsSync(join(h, 'agents', 'S')), 'session end clears the tracking');
});

test('SubagentStop outside a git repository skips the deliverables check without recording a hook error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mis-nogit-')), h = home();
  const r = hook('SubagentStop', { session_id: 'S', agent_id: 'a1', cwd: dir, last_assistant_message: 'Created src/missing.js' }, { MIS_STATE_HOME: h });
  assert.equal(r.code, 0); assert.equal(r.out, '');
  const trace = existsSync(join(h, 'trace.jsonl')) ? readFileSync(join(h, 'trace.jsonl'), 'utf8') : '';
  assert.doesNotMatch(trace, /"error"/, trace);
});

test('F2: SubagentStop blocks once when files the agent reports creating are missing', () => {
  const dir = makeRepo({ 'src/a.js': 'x' }), E = { MIS_STATE_HOME: home() };
  const msg = 'Done. Created `src/missing.js` and wrote src/a.js. Also see https://example.com/x.js and /etc/hosts.txt (created).';
  const r = hook('SubagentStop', { session_id: 'S', agent_id: 'x', cwd: dir, last_assistant_message: msg }, E);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /src\/missing\.js/);
  assert.doesNotMatch(r.json.reason, /src\/a\.js|hosts|example/, 'existing, outside-repo and URL paths are not reported');
  assert.equal(hook('SubagentStop', { session_id: 'S', cwd: dir, stop_hook_active: true, last_assistant_message: msg }, E).out, '', 'never twice');
  assert.equal(hook('SubagentStop', { session_id: 'S', cwd: dir, last_assistant_message: 'Looked at src/missing.js; nothing to change.' }, E).out, '', 'only creation claims count');
  const tr = join(dir, '..', `t-${Date.now()}.jsonl`);
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Saved report to `docs/r.md`.' }] } }) + '\n');
  assert.match(hook('SubagentStop', { session_id: 'S', cwd: dir, agent_transcript_path: tr }, E).json.reason, /docs\/r\.md/, 'falls back to the agent transcript');
  assert.deepEqual(missingDeliverables('Created `a.md`', dir, dir), ['a.md']);
  assert.deepEqual(missingDeliverables('Added Node.js support and wrote a socket.io client.', dir, dir), [], 'names are not files');
});

test('F3: PermissionRequest hook allows plain read-only Bash, says nothing otherwise, fails open', () => {
  const dir = makeRepo(), E = { MIS_STATE_HOME: home() };
  const pr = (command) => hook('PermissionRequest', { hook_event_name: 'PermissionRequest', session_id: 'S', cwd: dir, tool_name: 'Bash', tool_input: { command } }, E);
  assert.deepEqual(pr('git status').json, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  for (const c of ['git push', 'ls | sh', 'cat <<EOF\nx\nEOF', 'ls > out', 'rm -rf x']) assert.equal(pr(c).out, '', c);
  const bad = hook('PermissionRequest', '{not json', E);
  assert.equal(bad.code, 0); assert.equal(bad.out, '');
});

test('F4: PreToolUse reminders are context only (never a decision) and fail open', () => {
  const dir = makeRepo(), E = { MIS_STATE_HOME: home() };
  const a = hook('PreToolUse', { session_id: 'S', cwd: dir, tool_name: 'Agent', tool_input: { prompt: 'x' } }, E);
  assert.equal(a.json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(a.json.hookSpecificOutput.permissionDecision, undefined);
  assert.match(a.ctx, /exact files/);
  assert.equal(hook('PreToolUse', { session_id: 'S', cwd: dir, tool_name: 'Agent', tool_input: {} }, E).out, '', 'the hint is once per session');
  for (const id of ['1', '2', '3', '4']) hook('SubagentStart', { session_id: 'S', agent_id: id, cwd: dir }, E);
  assert.match(hook('PreToolUse', { session_id: 'S', cwd: dir, tool_name: 'Task', tool_input: {} }, E).ctx, /4 subagents are already running/);
  hook('PostToolUse', { session_id: 'S', cwd: dir, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'a', status: 'pending' }] } }, E);
  assert.match(hook('PreToolUse', { session_id: 'S', cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, E).ctx, /1 of 1 todos are still open/);
  assert.equal(hook('PreToolUse', { session_id: 'S', cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' } }, E).out, '');
  for (const input of ['{not json', '', JSON.stringify({ tool_name: 'Agent', session_id: {} })]) {
    const r = hook('PreToolUse', input, { MIS_STATE_HOME: '/dev/null/nope' });
    assert.equal(r.code, 0, r.err); assert.doesNotMatch(r.out, /permissionDecision|"decision"/);
  }
  const hj = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.match(hj.PreToolUse[0].hooks[0].command, /guard\.mjs/, 'the guard stays the first, separate PreToolUse hook');
  assert.match(hj.PreToolUse[1].hooks[0].command, /hooks\.mjs" PreToolUse$/);
  assert.match(hj.PermissionRequest[0].hooks[0].command, /hooks\.mjs" PermissionRequest$/);
  assert.equal(hj.PermissionRequest[0].matcher, 'Bash');
  assert.match(hj.SubagentStop[0].hooks[0].command, /hooks\.mjs" SubagentStop$/);
  assert.match(hj.PostToolUse[0].matcher, /TodoWrite/);
});

// A repo with a run in EXECUTING and one required check, edited in session S.
function executingRun() {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { ok: { argv: ['node', '-e', '0'] } } }, 'src/a.js': 'x\n' });
  assert.equal(mis(dir, ['start', '--input', 'x']).code, 0);
  assert.equal(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'], files: ['src/a.js'] }] }) }).code, 0);
  assert.equal(mis(dir, ['mode', 'set', 'quick', '--reason', 'r']).code, 0);
  assert.equal(mis(dir, ['task', 'T1', 'start']).code, 0);
  assert.equal(loadRun(dir).state.state, 'EXECUTING');
  return dir;
}
const edit = (dir, E, sid = 'S', file = 'src/a.js') => {
  write(dir, { [file]: `y${Math.random()}\n` });
  hook('PostToolUse', { session_id: sid, cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, file) } }, E);
};

test('F5: Stop blocks an EXECUTING run with no check on the current code, with a reason and a limit; a check clears it', () => {
  const dir = executingRun(), E = { MIS_STATE_HOME: home() };
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir }, E).out, '', 'a session that edited nothing is not held');
  edit(dir, E);
  const r = hook('Stop', { session_id: 'S', cwd: dir }, E);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /EXECUTING.*mis check/s);
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir, stop_hook_active: true }, E).json?.decision, 'block', 'second time');
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir, stop_hook_active: true }, E).json?.decision, undefined, 'stops after the limit');
  assert.equal(mis(dir, ['check', 'ok']).code, 0);
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir }, E).json?.decision, undefined, 'current evidence: no block');
});

test('F5/F6 precedence: an active loop owns the stop; drift beats the simplifier; simplifier is opt-in and once per file set', () => {
  const dir = executingRun(), h = home(), E = { MIS_STATE_HOME: h };
  writeFileSync(join(h, 'config.json'), JSON.stringify({ simplifier: { enabled: true } }));
  edit(dir, E);
  assert.equal(mis(dir, ['loop', 'start', 'x'], { env: { ...E, CLAUDE_CODE_SESSION_ID: 'S' } }).code, 0);
  const loop = hook('Stop', { session_id: 'S', cwd: dir }, E);
  assert.match(loop.json.reason, /MAKE IT SHIP LOOP/);
  assert.doesNotMatch(loop.json.reason, /SIMPLIFY|no check has run/);
  assert.equal(mis(dir, ['loop', 'cancel'], { env: { ...E, CLAUDE_CODE_SESSION_ID: 'S' } }).code, 0);
  const drift = hook('Stop', { session_id: 'S', cwd: dir }, E);
  assert.match(drift.json.reason, /no check has run/);
  assert.doesNotMatch(drift.json.reason, /SIMPLIFY/);
  assert.equal(mis(dir, ['check', 'ok']).code, 0);
  const simp = hook('Stop', { session_id: 'S', cwd: dir }, E);
  assert.match(simp.json.reason, /MAKE IT SHIP SIMPLIFY[\s\S]*src\/a\.js[\s\S]*code-simplifier/);
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir }, E).out, '', 'once per set of edited files');
  edit(dir, E, 'S', 'src/b.js');
  assert.match(hook('Stop', { session_id: 'S', cwd: dir }, E).json.reason, /no check has run/, 'a new edit without a check: drift again');
  assert.equal(mis(dir, ['check', 'ok']).code, 0);
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir, stop_hook_active: true }, E).json?.decision, undefined, 'simplifier never on a re-entrant stop');
  assert.match(hook('Stop', { session_id: 'S', cwd: dir }, E).json.reason, /SIMPLIFY[\s\S]*src\/b\.js/, 'a new set of files asks again');
});

test('F6: the simplifier is off by default', () => {
  const dir = makeRepo({ 'a.js': '' }), E = { MIS_STATE_HOME: home() };
  edit(dir, E, 'S', 'a.js');
  assert.equal(hook('Stop', { session_id: 'S', cwd: dir }, E).out, '');
});

test('F7/F11: SessionEnd writes a summary under the state dir and flushes hot paths; PreCompact and compact SessionStart keep todos', () => {
  const dir = makeRepo({ 'src/a.js': 'x', 'src/b.js': 'y' }), E = { MIS_STATE_HOME: home() };
  const elsewhere = makeRepo({ 'scripts/x.mjs': '' });
  hook('PostToolUse', { session_id: 'S1', cwd: dir, tool_name: 'Read', tool_input: { file_path: join(elsewhere, 'scripts/x.mjs') } }, E);
  for (const f of ['src/a.js', 'src/a.js', 'src/b.js']) hook('PostToolUse', { session_id: 'S1', cwd: dir, tool_name: 'Read', tool_input: { file_path: join(dir, f) } }, E);
  edit(dir, E, 'S1');
  hook('PostToolUse', { session_id: 'S1', cwd: dir, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'ship docs', status: 'pending' }, { content: 'x', status: 'completed' }] } }, E);
  const pc = hook('PreCompact', { session_id: 'S1', cwd: dir }, E);
  assert.match(pc.json.systemMessage, /Open todos\n- \[ \] ship docs/);
  assert.match(hook('SessionStart', { source: 'compact', session_id: 'S1', cwd: dir }, E).ctx, /ship docs/);
  assert.equal(hook('SessionEnd', { session_id: 'S1', cwd: dir, reason: 'exit' }, E).code, 0);
  const sum = readFileSync(join(stateRoot(dir), 'session-summaries', 'S1.md'), 'utf8');
  assert.match(sum, /# Session S1/); assert.match(sum, /\(exit\)/); assert.match(sum, /- src\/a\.js/); assert.match(sum, /Todos: 1\/2 done\n- \[ \] ship docs/);
  assert.match(sum, /Most read: src\/a\.js \(2\), src\/b\.js \(1\)/);
  const pm = JSON.parse(readFileSync(join(stateRoot(dir), 'memory', 'project.json'), 'utf8'));
  assert.deepEqual(pm.hotPaths, [{ path: 'src/a.js', count: 2 }, { path: 'src/b.js', count: 1 }], 'reads in another repository are not counted');
  assert.equal(git(dir, 'status', '--porcelain'), 'M src/a.js', 'nothing written into the work tree');
  assert.match(hook('SessionStart', { source: 'startup', session_id: 'S2', cwd: dir }, E).ctx, /often read: src\/a\.js, src\/b\.js/);
  assert.deepEqual(mergeHotPaths([{ path: 'x', count: 5 }], { y: 6, x: 2 }, 1), [{ path: 'x', count: 7 }]);
});

test('F11: a lasting instruction in a prompt is suggested as a directive, never saved', () => {
  const dir = makeRepo(), E = { MIS_STATE_HOME: home() };
  const r = hook('UserPromptSubmit', { prompt: 'Fix the parser. Always use pnpm in this repo.', cwd: dir, session_id: 'S' }, E);
  assert.match(r.ctx, /"Always use pnpm in this repo\."[\s\S]*project_memory_add_directive[\s\S]*do not save it without asking/);
  const pm = join(stateRoot(dir), 'memory', 'project.json');
  assert.ok(!existsSync(pm) || !(JSON.parse(readFileSync(pm, 'utf8')).userDirectives ?? []).length);
  assert.equal(hook('UserPromptSubmit', { prompt: 'what does this function do?', cwd: dir }, E).out, '');
  assert.deepEqual(directiveCandidates('should I always use pnpm?'), [], 'questions are not instructions');
  assert.equal(directiveCandidates('앞으로는 커밋 전에 테스트를 돌려줘').length, 1);
  assert.equal(directiveCandidates('generated 폴더는 절대 수정하지 마').length, 1);
  assert.deepEqual(directiveCandidates('절대 경로로 바꿔줘'), [], 'an absolute path is not a rule');
  assert.deepEqual(directiveCandidates('테스트가 항상 실패해'), [], 'a statement is not an instruction');
});

test('F8: mis debug scope makes the guard ask for edits outside the hypothesis; --clear lifts it', () => {
  const dir = makeRepo({ 'src/parser/a.js': '', 'src/other.js': '' }), h = home();
  const env = { ...process.env, MIS_STATE_HOME: h }; delete env.NODE_TEST_CONTEXT; delete env.CLAUDE_CODE_SESSION_ID;
  const guard = (file) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'guard.mjs')], { input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(dir, file) }, cwd: dir }), encoding: 'utf8', env });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  assert.equal(guard('src/other.js'), null);
  assert.deepEqual(mis(dir, ['debug', 'scope', 'src/parser'], { env: { MIS_STATE_HOME: h } }).json.debugScope.length, 1);
  assert.equal(guard('src/parser/a.js'), null);
  assert.match(hook('SessionStart', { source: 'startup', cwd: dir }, { MIS_STATE_HOME: h }).ctx, /debug scope is set .*src\/parser/);
  const o = guard('src/other.js');
  assert.equal(o.permissionDecision, 'ask');
  assert.match(o.permissionDecisionReason, /outside the debug scope/);
  assert.equal(guard('../elsewhere.js')?.permissionDecision, 'ask');
  assert.equal(mis(makeRepo(), ['debug', 'scope'], { env: { MIS_STATE_HOME: h } }).json.debugScope.length, 1);
  const other = makeRepo({ 'b.js': '' });
  const r2 = spawnSync(process.execPath, [join(ROOT, 'scripts', 'guard.mjs')], { input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(other, 'b.js') }, cwd: other }), encoding: 'utf8', env });
  assert.equal(r2.stdout, '', 'another repository is not affected');
  mis(dir, ['debug', 'scope', '--clear'], { env: { MIS_STATE_HOME: h } });
  assert.equal(guard('src/other.js'), null);
  assert.equal(mis(dir, ['debug', 'scope', 'nope'], { env: { MIS_STATE_HOME: h } }).code, 1);
  assert.match(readFileSync(join(ROOT, 'skills', 'run', 'phases', 'debug.md'), 'utf8'), /mis debug scope/);
  assert.match(readFileSync(join(ROOT, 'skills', 'debug', 'SKILL.md'), 'utf8'), /mis debug scope <file\|dir…>[\s\S]*--clear/);
});

test('F9: run-less events go to the project timeline with the session kind, and trace_timeline reads them', async () => {
  const dir = makeRepo(), h = home(), E = { MIS_STATE_HOME: h };
  hook('SessionStart', { source: 'startup', session_id: 'S', cwd: dir }, { ...E, CLAUDE_CODE_ENTRYPOINT: 'cli' });
  hook('SessionStart', { source: 'startup', session_id: 'W', cwd: dir }, { ...E, MIS_TEAM_ID: 't1' });
  hook('PostToolUse', { session_id: 'S', cwd: dir, tool_name: 'Skill', tool_input: { skill: 'make-it-ship:review' } }, E);
  assert.equal(mis(dir, ['timeline', 'log', 'deploy', 'env=staging'], { env: E }).code, 0);
  const lines = readFileSync(join(stateRoot(dir), 'timeline.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.event), ['session-start', 'session-start', 'skill', 'deploy']);
  assert.equal(lines[0].kind, 'interactive'); assert.equal(lines[1].kind, 'team-worker'); assert.equal(lines[3].env, 'staging');
  assert.match(mis(dir, ['timeline', '--last', '1'], { env: E }).out, /deploy .*env=staging/);
  const prev = process.env.MIS_STATE_HOME; process.env.MIS_STATE_HOME = h;
  try {
    const tl = tools.find((t) => t.name === 'trace_timeline').handler({}, { cwd: dir });
    assert.match(tl, /TL\s+session-start .*kind=interactive/);
    assert.match(tl, /TL\s+skill skill=make-it-ship:review/);
    assert.doesNotMatch(tools.find((t) => t.name === 'trace_timeline').handler({ filter: 'timeline' }, { cwd: dir }), /HOOK/);
  } finally { if (prev === undefined) delete process.env.MIS_STATE_HOME; else process.env.MIS_STATE_HOME = prev; }
  assert.equal(sessionKind({ CI: '1' }), 'headless');
  assert.equal(sessionKind({ CI: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'interactive');
  assert.equal(sessionKind({ MIS_HEADLESS: '1' }), 'headless');
  assert.equal(sessionKind({}), 'interactive', 'no positive signal: a human is assumed');
});

test('F10: mis setup routing shows a diff and writes nothing; --write replaces the section once (idempotent)', () => {
  const gstack = '# Project\n\nIntro.\n\n## Skill routing\n\n- bugs → invoke investigate\n- ship → invoke ship\n\n## Other\nkeep me\n';
  const dir = makeRepo({ 'CLAUDE.md': gstack });
  const hash = () => createHash('sha256').update(readFileSync(join(dir, 'CLAUDE.md'))).digest('hex');
  const before = hash();
  const dry = mis(dir, ['setup', 'routing']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /dry run, nothing written/);
  assert.match(dry.out, /^- - bugs → invoke investigate$/m);
  assert.match(dry.out, /^\+ - a bug, failing test or unexpected behavior → \/make-it-ship:debug$/m);
  assert.equal(hash(), before, 'dry run leaves the file untouched');
  assert.equal(mis(dir, ['setup', 'routing', '--write']).json.replaced, true);
  const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(after, /^# Project\n\nIntro\.\n\n## Skill routing\n/);
  assert.match(after, /\n## Other\nkeep me\n$/);
  assert.doesNotMatch(after, /investigate/);
  assert.equal((after.match(/## Skill routing/g) ?? []).length, 1);
  assert.match(mis(dir, ['setup', 'routing']).out, /already current/);
  assert.match(mis(dir, ['setup', 'routing', '--write']).out, /already current/);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), after);
  const fresh = makeRepo();
  mis(fresh, ['setup', 'routing', '--write']);
  assert.match(readFileSync(join(fresh, 'CLAUDE.md'), 'utf8'), /^## Skill routing\n/);
  for (const m of after.matchAll(/\/make-it-ship:([a-z-]+)/g)) assert.ok(existsSync(join(ROOT, 'skills', m[1], 'SKILL.md')), m[0]);
  assert.equal(mis(dir, ['setup', 'other']).code, 1);
});

test('F10: SessionStart discipline has the question format and the next-skill suggestion (proactive can be turned off)', () => {
  const t = disciplineText(ROOT);
  assert.match(t, /restate the decision in one line, give your recommendation and why, then 2-4 concrete options/);
  assert.match(t, /suggest in one line the one skill that fits next/);
  assert.doesNotMatch(disciplineText(ROOT, { proactive: false }), /fits next/);
  const dir = makeRepo(), h = home();
  writeFileSync(join(h, 'config.json'), JSON.stringify({ proactive: false }));
  const r = hook('SessionStart', { source: 'startup', cwd: dir }, { MIS_STATE_HOME: h });
  assert.match(r.ctx, /restate the decision/);
  assert.doesNotMatch(r.ctx, /fits next/);
});

test('M9-F hooks write timeline and summaries only for the host cwd, never for the process cwd', () => {
  const dir = makeRepo(), E = { MIS_STATE_HOME: home() };
  const e = { ...process.env, ...E }; delete e.NODE_TEST_CONTEXT;
  for (const ev of ['SessionStart', 'SubagentStart', 'SubagentStop', 'SessionEnd']) spawnSync(process.execPath, [HOOKS, ev], { cwd: dir, input: JSON.stringify({ session_id: 'S', agent_id: 'a' }), encoding: 'utf8', env: e });
  assert.ok(!existsSync(join(stateRoot(dir), 'timeline.jsonl')));
  assert.ok(!existsSync(join(stateRoot(dir), 'session-summaries')));
});

test('M9-F hooks stay fail-open with an unwritable home', () => {
  for (const ev of ['SubagentStart', 'SubagentStop', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd', 'PreCompact']) {
    const r = hook(ev, { session_id: 'S', cwd: '/', agent_id: 'a', tool_name: 'TodoWrite', tool_input: { todos: [] } }, { MIS_STATE_HOME: '/dev/null/nope' });
    assert.equal(r.code, 0, `${ev}: ${r.err}`);
    assert.doesNotMatch(r.out, /"decision"\s*:\s*"block"|permissionDecision/, ev);
  }
});
