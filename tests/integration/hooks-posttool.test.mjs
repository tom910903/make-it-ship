import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, ROOT } from '../helpers.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const run = (event, input, home) => {
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: JSON.stringify({ hook_event_name: event, session_id: 's1', ...input }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
};
const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));

test('PostToolUse injects matching non-native rule files once per session (cursor, github instructions)', () => {
  const dir = makeRepo({
    'src/a.py': '', 'web/b.ts': '',
    '.cursor/rules/python.mdc': '---\nglobs: ["**/*.py"]\n---\nUse type hints.',
    '.github/instructions/ts.instructions.md': '---\napplyTo: "web/**"\n---\nNo default exports.',
    '.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\nWrite tests.',
    '.cursor/rules/never.mdc': '---\ndescription: manual only\n---\nManual.',
    '.github/copilot-instructions.md': 'Repo-wide: keep functions small.',
    '.claude/rules/native.md': 'Claude Code loads this itself.',
  });
  const h = home();
  const read = (p) => run('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(dir, p) }, cwd: dir }, h);
  const first = read('src/a.py');
  assert.match(first, /Use type hints/);
  assert.match(first, /Write tests/);
  assert.match(first, /keep functions small/);
  assert.doesNotMatch(first, /No default exports|Manual|loads this itself/);
  const second = read('web/b.ts');
  assert.match(second, /No default exports/);
  assert.doesNotMatch(second, /type hints|Write tests/, 'already injected this session');
  assert.equal(read('src/a.py'), '');
  assert.match(run('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(dir, 'src/a.py') }, cwd: dir, session_id: 's2' }, h), /type hints/, 'new session re-injects');
});

test('PostToolUse reminds to verify after many edits; a test command resets the count', () => {
  const dir = makeRepo(), h = home();
  const edit = () => run('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'x.js') }, cwd: dir }, h);
  for (let i = 1; i < 8; i++) assert.equal(edit(), '');
  assert.match(edit(), /8 edits since the last test run/);
  run('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: dir }, h);
  for (let i = 1; i < 8; i++) assert.equal(edit(), '');
});

test('PostToolUseFailure: the third identical failure asks for root-cause debugging', () => {
  const dir = makeRepo(), h = home();
  const fail = (cmd) => run('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: cmd }, error: 'exit 1', cwd: dir }, h);
  assert.equal(fail('npm run build'), '');
  assert.equal(fail('npm run build'), '');
  assert.match(fail('npm run build'), /failed 3 times.*root cause/is);
  assert.equal(fail('npm run lint'), '', 'a different command has its own count');
});
