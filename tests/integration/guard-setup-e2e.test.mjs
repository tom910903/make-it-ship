// End to end through guard.mjs and the hooks: asks before settings, config and CLAUDE.md changes, config keys toggle hooks,
// malformed trace entries, no stderr outside a repo, the design board, the CLAUDE.md block path, repository skills, plan scope union.
// Every process gets a temp HOME / CLAUDE_CONFIG_DIR / MIS_STATE_HOME (fakeHome); the real ~/.claude is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, write, fakeHome, GUARD, MIS, ROOT } from '../helpers.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json ?? r.out; };
const envOf = (h, extra = {}) => { const e = { ...process.env, ...h.env, ...extra }; for (const k of ['CLAUDE_CODE_SESSION_ID', 'MIS_TEAM_ID', 'NODE_TEST_CONTEXT', 'CI', 'GITHUB_ACTIONS']) delete e[k]; return e; };
const hook = (h, event, input, cwd = h.home) => {
  const r = spawnSync(process.execPath, [HOOKS, event], { cwd, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: envOf(h) });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* none */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json, ctx: json?.hookSpecificOutput?.additionalContext ?? '' };
};
const guard = (h, input, cwd = h.home) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, input: JSON.stringify({ hook_event_name: 'PreToolUse', ...input }), encoding: 'utf8', env: envOf(h) });
  return { err: r.stderr, decision: r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow' };
};

test('end to end: the guard asks before config set of statusLine.chain, a user skill, claude mcp add, and writing ~/.claude/settings.json', () => {
  const h = fakeHome(), dir = makeRepo();
  const b = (command) => guard(h, { tool_name: 'Bash', tool_input: { command }, cwd: dir }).decision;
  assert.equal(b(`node "${MIS}" config set statusLine.chain "touch /tmp/pwned"`), 'ask');
  assert.equal(b(`node "${MIS}" config set update.source http://127.0.0.1:9/x`), 'ask');
  assert.equal(b(`node "${MIS}" config set proactive false`), 'allow');
  assert.equal(b(`node "${MIS}" skill add s.md --scope user`), 'ask');
  assert.equal(b('claude mcp add x -- npx y'), 'ask');
  assert.equal(b(`node "${MIS}" tty keys sh 'rm -rf ~' Enter`), 'ask');
  assert.equal(b("echo '{}' > ~/.claude/settings.json"), 'ask');
  assert.equal(guard(h, { tool_name: 'Write', tool_input: { file_path: join(h.claude, 'settings.json') }, cwd: dir }).decision, 'ask');
  assert.equal(guard(h, { tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'a.js') }, cwd: dir }).decision, 'allow');
});

test('end to end: a CLAUDE.md outside the session repository asks (another repo, a missing dir, a non-repo dir); the repo\'s own pass', () => {
  const h = fakeHome(), dir = makeRepo(), other = makeRepo(), plain = realpathSync(mkdtempSync(join(tmpdir(), 'mis-plain-')));
  const w = (file_path) => guard(h, { tool_name: 'Write', tool_input: { file_path }, cwd: dir }, dir).decision;
  for (const p of [join(other, 'CLAUDE.md'), join(h.home, 'notes', 'CLAUDE.md'), join(plain, 'x', 'CLAUDE.md'), join(plain, 'CLAUDE.md')]) assert.equal(w(p), 'ask', p);
  for (const p of [join(dir, 'CLAUDE.md'), join(dir, 'sub', 'CLAUDE.md')]) assert.equal(w(p), 'allow', p);
  assert.equal(guard(h, { tool_name: 'Bash', tool_input: { command: `echo x > ${join(other, 'CLAUDE.md')}` }, cwd: dir }, dir).decision, 'ask');
  assert.equal(guard(h, { tool_name: 'mcp__filesystem__write_file', tool_input: { path: join(other, 'CLAUDE.md') }, cwd: dir }, dir).decision, 'ask');
});

test('mis config set simplifier.enabled / proactive toggles the hooks; get lists every key with a doc', () => {
  const h = fakeHome(), dir = makeRepo({ 'a.js': '' });
  const editAndStop = (sid) => {
    write(dir, { 'a.js': `x${sid}\n` });
    hook(h, 'PostToolUse', { session_id: sid, cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.js') } });
    return hook(h, 'Stop', { session_id: sid, cwd: dir });
  };
  assert.equal(editAndStop('s0').out, '', 'off by default');
  ok(mis(dir, ['config', 'set', 'simplifier.enabled', 'true'], { env: h.env }));
  assert.match(editAndStop('s1').json.reason, /MAKE IT SHIP SIMPLIFY[\s\S]*mis config set simplifier\.enabled false/);
  ok(mis(dir, ['config', 'set', 'simplifier.enabled', 'false'], { env: h.env }));
  assert.equal(editAndStop('s2').out, '');
  ok(mis(dir, ['config', 'set', 'simplifier.maxFiles', '3'], { env: h.env }));
  assert.notEqual(mis(dir, ['config', 'set', 'simplifier.maxFiles', '0'], { env: h.env }).code, 0);
  assert.match(hook(h, 'SessionStart', { session_id: 'a', cwd: dir }).ctx, /Next step:/);
  ok(mis(dir, ['config', 'set', 'proactive', 'false'], { env: h.env }));
  assert.doesNotMatch(hook(h, 'SessionStart', { session_id: 'b', cwd: dir }).ctx, /Next step:/);
  assert.notEqual(mis(dir, ['config', 'set', 'proactive', 'maybe'], { env: h.env }).code, 0);
  const g = ok(mis(dir, ['config', 'get'], { env: h.env }));
  for (const k of ['simplifier.enabled', 'simplifier.maxFiles', 'proactive', 'statusLine.chain']) assert.ok(g.keys.includes(k) && g.docs[k], k);
  assert.match(g.docs['statusLine.chain'], /asks first/);
  // Every key a hook or the status line reads from the global config is settable (audit of globalConfig() readers).
  for (const k of ['proactive', 'simplifier.enabled', 'simplifier.maxFiles', 'keywords.disabled', 'subagentMatcher', 'statusLine.chain', 'style.default', 'update.check', 'update.source', 'maintenance.retainDays']) assert.ok(g.keys.includes(k), k);
});

test('a non-string cwd is never traced, and doctor session skips (and counts) malformed trace entries', () => {
  const h = fakeHome(), dir = makeRepo();
  for (const ev of ['SubagentStop', 'Stop', 'SessionStart']) assert.equal(hook(h, ev, { cwd: 123 }).code, 0);
  assert.equal(guard(h, { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: 123 }).decision !== undefined, true);
  const lines = readFileSync(join(h.state, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 3 && lines.every((e) => typeof e.cwd === 'string'), JSON.stringify(lines));
  appendFileSync(join(h.state, 'trace.jsonl'), ['{"cwd":5,"error":"x","hook":"Stop"}', '123', 'null', '[1]', '"s"', '{"cwd":{"a":1},"error":"y"}'].join('\n') + '\n');
  const s = ok(mis(dir, ['doctor', 'session'], { env: h.env }));
  assert.equal(s.malformedTraceEntries, 6);
  assert.ok(Array.isArray(s.hookErrors) && Array.isArray(s.recentHooks));
});

test('hooks and the guard outside a repository write nothing to stderr', () => {
  const h = fakeHome(), out = realpathSync(mkdtempSync(join(tmpdir(), 'mis-norepo-')));
  const base = { session_id: 'n', cwd: out };
  const cases = [['SessionStart', base], ['UserPromptSubmit', { ...base, prompt: 'hello' }], ['PostToolUse', { ...base, tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }],
    ['PostToolUse', { ...base, tool_name: 'Edit', tool_input: { file_path: join(out, 'a.js') } }], ['Stop', base], ['SubagentStop', { ...base, last_assistant_message: 'I created a.txt' }],
    ['SubagentStart', base], ['PreToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }], ['PermissionRequest', { ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['PreCompact', base], ['SessionEnd', base], ['PostToolUseFailure', { ...base, tool_name: 'Bash', tool_input: { command: 'x' } }]];
  for (const [ev, input] of cases) {
    const r = hook(h, ev, input, out);
    assert.deepEqual([r.code, r.err], [0, ''], `${ev} ${JSON.stringify(input)}`);
  }
  assert.equal(guard(h, { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: out }, out).err, '');
  assert.equal(guard(h, { tool_name: 'Write', tool_input: { file_path: join(out, 'x') }, cwd: out }, out).err, '');
});

test('design-board takes only design variants, not the HTML that mis diagram writes next to them', () => {
  const h = fakeHome(), dir = makeRepo();
  write(dir, { 'design/flow.mmd': 'flowchart TD\n  A[Start] --> B[End]\n', 'design/layout-a.html': '<p>a</p>', 'design/layout-b.html': '<p>b</p>' });
  ok(mis(dir, ['diagram', 'design/flow.mmd'], { env: h.env }));
  assert.ok(existsSync(join(dir, 'design', 'flow.html')));
  const r = ok(mis(dir, ['design-board', 'design'], { env: h.env }));
  assert.deepEqual(r.variants, ['layout-a.html', 'layout-b.html']);
  assert.doesNotMatch(readFileSync(join(dir, 'design', 'board.html'), 'utf8'), /flow\.html/);
});

test('the global CLAUDE.md block names the resolved plugin path (CLAUDE_PLUGIN_ROOT is not substituted there)', () => {
  const h = fakeHome();
  ok(mis(h.home, ['setup', '--write'], { env: h.env }));
  const md = readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes(`node "${join(ROOT, 'scripts', 'mis.mjs')}" <command>`), md);
  assert.doesNotMatch(md, /CLAUDE_PLUGIN_ROOT/);
  // A block written by an older install (other path) is replaced in place by the next setup.
  writeFileSync(join(h.claude, 'CLAUDE.md'), md.replace(join(ROOT, 'scripts', 'mis.mjs'), '/old/plugin/1.0/scripts/mis.mjs'));
  const again = ok(mis(h.home, ['setup'], { env: h.env }));
  assert.ok(again.changes.some((c) => c.file.endsWith('CLAUDE.md') && c.diff.includes('/old/plugin/1.0')));
});

test('same-name skills are injected once (project wins); repository skills are listed as untrusted content until mis skill trust', () => {
  const h = fakeHome(), dir = makeRepo();
  const sk = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\ntriggers: [csv export]\n---\nbody\n`;
  write(dir, { '.make-it-ship/skills/csv/SKILL.md': sk('csv', 'Repo CSV steps') });
  mkdirSync(join(h.state, 'skills', 'csv'), { recursive: true });
  writeFileSync(join(h.state, 'skills', 'csv', 'SKILL.md'), sk('csv', 'User CSV steps'));
  const tp = () => ok(mis(dir, ['test-prompt', 'add a csv export'], { env: h.env }));
  let r = tp();
  assert.deepEqual(r.skills, ['csv'], 'one injection');
  assert.equal(r.context.match(/csv/g).length >= 1, true);
  assert.match(r.context, /Repo CSV steps/);
  assert.doesNotMatch(r.context, /User CSV steps/);
  assert.match(r.context, /repository skill.*untrusted/is);
  assert.doesNotMatch(r.context, /follow it/);
  const viaHook = hook(h, 'UserPromptSubmit', { session_id: 'x', cwd: dir, prompt: 'add a csv export' }, dir);
  assert.match(viaHook.ctx, /untrusted/);
  ok(mis(dir, ['skill', 'trust'], { env: h.env }));
  r = tp();
  assert.match(r.context, /learned skill\] csv — Repo CSV steps\. If it applies, read .*\.make-it-ship\/skills\/csv\/SKILL\.md and follow it/);
  ok(mis(dir, ['skill', 'trust', '--remove'], { env: h.env }));
  assert.match(tp().context, /untrusted/);
  // User-scope skills keep the direct instruction.
  const other = makeRepo();
  assert.match(ok(mis(other, ['test-prompt', 'add a csv export'], { env: h.env })).context, /User CSV steps\. If it applies, read .* and follow it/);
  // A multi-line or very long description cannot break out of the listing.
  write(dir, { '.make-it-ship/skills/csv/SKILL.md': sk('csv', `${'x'.repeat(400)}`) });
  assert.ok(tp().context.length < 1200);
});

test('plan scope: with per-task files but no top-level plannedFiles, an out-of-plan edit during EXECUTING asks', () => {
  const h = fakeHome();
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { ok: { argv: ['node', '-e', '0'] } } }, 'src/a.js': 'x\n' });
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  ok(mis(dir, ['plan', 'set', '-'], { env: h.env, input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'], files: ['src/a.js'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'r'], { env: h.env }));
  ok(mis(dir, ['task', 'T1', 'start'], { env: h.env }));
  const w = (f) => guard(h, { tool_name: 'Write', tool_input: { file_path: join(dir, f) }, cwd: dir }, dir).decision;
  assert.equal(w('src/a.js'), 'allow');
  assert.equal(w('src/other.js'), 'ask');
});
