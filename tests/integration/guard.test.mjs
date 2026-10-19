import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { makeRepo, GUARD, ROOT } from '../helpers.mjs';
import { createRun } from '../../scripts/lib/state.mjs';

const run = (input) => {
  const r = spawnSync(process.execPath, [GUARD], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null };
};
const bash = (cwd, command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd });

test('guard: no active run → push passes silently, forgery denied', () => {
  const dir = makeRepo();
  assert.equal(run(bash(dir, 'git push')).out, null);
  const r = run(bash(dir, 'echo x > .git/make-it-ship/runs/a/state.json'));
  assert.equal(r.out.permissionDecision, 'deny');
  assert.equal(r.out.hookEventName, 'PreToolUse');
});

test('guard: active run → push asks, npm test passes', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  const r = run(bash(dir, 'git push origin feature'));
  assert.equal(r.code, 0);
  assert.equal(r.out.permissionDecision, 'ask');
  assert.match(r.out.permissionDecisionReason, /git push/);
  assert.equal(run(bash(dir, 'npm test')).out, null);
});

test('guard: force push on main without refspec is denied (reads current branch)', () => {
  const dir = makeRepo();
  createRun(dir, { input: { kind: 'text', text: 'x' } });
  assert.equal(run(bash(dir, 'git push --force')).out.permissionDecision, 'deny');
});

test('guard: cwd outside any git repo → no crash, forgery rule still applies', () => {
  assert.equal(run(bash('/', 'ls')).out, null);
});

test('guard: internal error fails closed with ask', () => {
  const r = run('{not json');
  assert.equal(r.out.permissionDecision, 'ask');
  assert.match(r.out.permissionDecisionReason, /guard error/);
});

test('hooks.json wires PreToolUse to guard with the Spec matcher', () => {
  const h = JSON.parse(readFileSync(`${ROOT}/hooks/hooks.json`, 'utf8'));
  const entry = h.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*');
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard\.mjs/);
});
