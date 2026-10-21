import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT } from '../helpers.mjs';
import { buildCodeMap } from '../../scripts/lib/codemap.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));
const hook = (event, input, env = {}) => {
  const e = { ...process.env }; delete e.CLAUDE_CODE_SESSION_ID; Object.assign(e, env); delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: e });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* none */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json, ctx: json?.hookSpecificOutput?.additionalContext ?? '' };
};

test('SessionStart: skill discipline, always-on rules, style at the session level, and a codebase map', () => {
  const dir = makeRepo({ 'src/util.js': 'export function slugify(s) {}\nexport const MAX = 3;\n', 'test/util.test.js': 'export function hidden() {}\n' });
  const h = home();
  const r = hook('SessionStart', { hook_event_name: 'SessionStart', source: 'startup', cwd: dir }, { MIS_STATE_HOME: h });
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(r.ctx, /make-it-ship:run/);
  assert.match(r.ctx, /Skill tool/);
  assert.match(r.ctx, /failing test/i);
  assert.match(r.ctx, /root cause/i);
  assert.match(r.ctx, /level: full/);
  assert.match(r.ctx, /src\/: slugify, MAX/);
  assert.doesNotMatch(r.ctx, /hidden/, 'test files are not in the map');
  mis(dir, ['style', 'off'], { env: { MIS_STATE_HOME: h, CLAUDE_CODE_SESSION_ID: 'S' } });
  const off = hook('SessionStart', { source: 'startup', cwd: dir, session_id: 'S' }, { MIS_STATE_HOME: h });
  assert.doesNotMatch(off.ctx, /MAKE IT SHIP STYLE/);
  assert.match(off.ctx, /make-it-ship:run/, 'discipline stays even when style is off');
});

test('SessionStart: an active run is announced with the resume command', () => {
  const dir = makeRepo();
  mis(dir, ['start', '--input', 'x']);
  const r = hook('SessionStart', { source: 'resume', cwd: dir }, { MIS_STATE_HOME: home() });
  assert.match(r.ctx, /active Make It Ship run .* PLANNING/i);
  assert.match(r.ctx, /make-it-ship:resume/);
});

test('SubagentStart: style rules reach subagents; subagentMatcher limits them; off injects nothing', () => {
  const h = home();
  assert.match(hook('SubagentStart', { agent_type: 'general-purpose' }, { MIS_STATE_HOME: h }).ctx, /level: full/);
  writeFileSync(join(h, 'config.json'), JSON.stringify({ subagentMatcher: '^make-it-ship:' }));
  assert.equal(hook('SubagentStart', { agent_type: 'general-purpose' }, { MIS_STATE_HOME: h }).out, '');
  assert.match(hook('SubagentStart', { agent_type: 'make-it-ship:implementer' }, { MIS_STATE_HOME: h }).ctx, /level: full/);
  writeFileSync(join(h, 'config.json'), JSON.stringify({ subagentMatcher: '(' }));
  assert.match(hook('SubagentStart', { agent_type: 'x' }, { MIS_STATE_HOME: h }).ctx, /level: full/, 'a bad matcher fails open (inject)');
  mis(makeRepo(), ['style', 'off'], { env: { MIS_STATE_HOME: h, CLAUDE_CODE_SESSION_ID: 'S' } });
  assert.equal(hook('SubagentStart', { agent_type: 'x', session_id: 'S' }, { MIS_STATE_HOME: h }).out, '');
});

test('always-on hooks fail open: bad input or an unknown event exits 0 without blocking', () => {
  for (const [ev, input] of [['SessionStart', '{not json'], ['NoSuchEvent', '{}'], ['SubagentStart', '']]) {
    const r = hook(ev, input, { MIS_STATE_HOME: home() });
    assert.equal(r.code, 0, `${ev}: ${r.err}`);
    assert.doesNotMatch(r.out, /"decision"\s*:\s*"block"/);
  }
});

test('code map: one line per folder, shared folders first, budget respected', () => {
  const dir = makeRepo({ 'a/x.py': 'def alpha():\n  pass\nclass Beta:\n  pass\n', 'lib/y.go': 'package y\nfunc Gamma() {}\n', 'node_modules/z.js': 'export function nope() {}\n' });
  const map = buildCodeMap(dir, 2000);
  assert.match(map, /^lib\/: Gamma$/m);
  assert.match(map, /^a\/: alpha, Beta$/m);
  assert.ok(map.indexOf('lib/') < map.indexOf('a/'), 'shared (lib) listed first');
  assert.doesNotMatch(map, /nope/);
  assert.ok(buildCodeMap(dir, 10).length < 200, 'tiny budget lists nothing but the header');
});

test('UserPromptSubmit: keyword context injected, style phrase persists the level, plain prompts inject nothing', () => {
  const dir = makeRepo(), h = home();
  const r = hook('UserPromptSubmit', { prompt: 'ralph: fix the importer', cwd: dir }, { MIS_STATE_HOME: h });
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(r.ctx, /make-it-ship:loop/);
  const s = hook('UserPromptSubmit', { prompt: 'normal mode', cwd: dir, session_id: 'S' }, { MIS_STATE_HOME: h });
  assert.match(s.ctx, /Style level is now off/);
  assert.equal(mis(dir, ['style'], { env: { MIS_STATE_HOME: h, CLAUDE_CODE_SESSION_ID: 'S' } }).json.level, 'off');
  assert.equal(hook('UserPromptSubmit', { prompt: 'rename the variable', cwd: dir }, { MIS_STATE_HOME: h }).out, '');
});

test('M6 D3: the style level is per session; the default applies to new sessions', () => {
  const dir = makeRepo(), h = home(), env = { MIS_STATE_HOME: h };
  hook('UserPromptSubmit', { prompt: 'normal mode', cwd: dir, session_id: 'A' }, env);
  assert.doesNotMatch(hook('SessionStart', { cwd: dir, session_id: 'A' }, env).ctx, /MAKE IT SHIP STYLE/, 'session A is off');
  assert.match(hook('SessionStart', { cwd: dir, session_id: 'B' }, env).ctx, /level: full/, 'session B gets the default');
  mis(dir, ['style', 'default', 'ultra'], { env });
  assert.match(hook('SessionStart', { cwd: dir, session_id: 'C' }, env).ctx, /level: ultra/);
  // `mis style lite` run by the model in session D (the host exports CLAUDE_CODE_SESSION_ID to Bash) applies to D only
  mis(dir, ['style', 'lite'], { env: { ...env, CLAUDE_CODE_SESSION_ID: 'D' } });
  assert.match(hook('SubagentStart', { cwd: dir, session_id: 'D', agent_type: 'x' }, env).ctx, /level: lite/);
  assert.match(hook('SubagentStart', { cwd: dir, session_id: 'E', agent_type: 'x' }, env).ctx, /level: ultra/);
});

test('M6 D12: an unwritable home does not drop the keyword context', () => {
  const dir = makeRepo(), f = join(home(), 'file');
  writeFileSync(f, 'x');
  const r = hook('UserPromptSubmit', { prompt: 'tdd this', cwd: dir, session_id: 'A' }, { MIS_STATE_HOME: f });
  assert.match(r.ctx, /TDD mode/);
});

test('M6 R2-8: the style notice is only given when the level was really saved', () => {
  const dir = makeRepo(), f = join(home(), 'file');
  writeFileSync(f, 'x');
  const r = hook('UserPromptSubmit', { prompt: 'style lite', cwd: dir, session_id: 'A' }, { MIS_STATE_HOME: f });
  assert.doesNotMatch(r.ctx, /Style level is now/);
});
