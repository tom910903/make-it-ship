import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, ROOT } from '../helpers.mjs';
import { mcpSession } from '../helpers-mcp.mjs';
import { notepadRead, projectRead } from '../../scripts/lib/memory.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));
const hook = (event, input, env) => {
  const e = { ...process.env }; delete e.CLAUDE_CODE_SESSION_ID; Object.assign(e, env); delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks.mjs'), event], { input: JSON.stringify({ hook_event_name: event, ...input }), encoding: 'utf8', env: e });
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};

test('M7 D1: workingDirectory outside the session repo is ignored; a missing path is an error', async () => {
  const dir = makeRepo(), other = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    await s.call('notepad_write_working', { content: 'goes to session repo', workingDirectory: other });
    assert.match(JSON.stringify(notepadRead(dir)), /goes to session repo/);
    assert.equal(notepadRead(other), null);
    assert.equal((await s.call('notepad_write_working', { content: 'x', workingDirectory: join(dir, 'no-such-dir') })).isError, true);
  } finally { s.close(); }
});

test('M7 D2: <remember> from an Agent result only (not its prompt), unescaped, without duplicates', () => {
  const dir = makeRepo(), h = home();
  const resp = { content: [{ type: 'text', text: 'done.\n<remember>Line one\n"quoted" two</remember>' }] };
  hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Agent', tool_input: { prompt: 'save <remember>from the prompt</remember>' }, tool_response: resp }, { MIS_STATE_HOME: h });
  hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Agent', tool_input: {}, tool_response: resp }, { MIS_STATE_HOME: h });
  const w = notepadRead(dir).working.map((e) => e.text);
  assert.deepEqual(w, ['Line one\n"quoted" two']);
});

test('M7 D8: SessionStart detects the project once; a passing test command is learned', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'x' }) }), h = home();
  const ctx = hook('SessionStart', { cwd: dir, session_id: 'A', source: 'startup' }, { MIS_STATE_HOME: h }).hookSpecificOutput.additionalContext;
  assert.ok(projectRead(dir), 'project memory created');
  assert.match(ctx, /# Project memory/);
  hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Bash', tool_input: { command: 'npx vitest run' }, tool_response: { stdout: 'ok' } }, { MIS_STATE_HOME: h });
  assert.match(JSON.stringify(projectRead(dir)), /vitest run/);
});

test('M7 D3: guard decisions are traced', () => {
  const dir = makeRepo(), h = home();
  const e = { ...process.env, MIS_STATE_HOME: h }; delete e.NODE_TEST_CONTEXT;
  spawnSync(process.execPath, [join(ROOT, 'scripts', 'guard.mjs')], { input: JSON.stringify({ tool_name: 'mcp__plugin_make-it-ship_mis__wiki_add', tool_input: {}, cwd: dir }), encoding: 'utf8', env: e });
  assert.match(readFileSync(join(h, 'trace.jsonl'), 'utf8'), /"hook":"PreToolUse".*"tool":"mcp__plugin_make-it-ship_mis__wiki_add".*"decision":"allow"/);
});

test('M7 D4: wiki_ingest refuses files inside .git', async () => {
  const dir = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try { assert.equal((await s.call('wiki_ingest', { path: '.git/config' })).isError, true); } finally { s.close(); }
});

test('M7 D5: diagnostics over a directory with nothing checkable is not a success', async () => {
  const dir = makeRepo({ 'notes.txt': 'x' });
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try { assert.equal((await s.call('lsp_diagnostics_directory', { directory: dir })).json.success, false); } finally { s.close(); }
});

test('M7 D6: a python_repl whose process was killed restarts and runs the code', async () => {
  const dir = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    const first = (await s.call('python_repl', { action: 'execute', code: 'import os; print(os.getpid())' })).json;
    process.kill(Number(first.stdout.trim()), 'SIGKILL');
    const again = (await s.call('python_repl', { action: 'execute', code: 'print(6*7)' })).json;
    assert.equal(again.stdout, '42\n', JSON.stringify(again));
  } finally { s.close(); }
});

test('M7 D7: after compaction the priority note is injected once', async () => {
  const dir = makeRepo(), h = home();
  (await import('../../scripts/lib/memory.mjs')).setPriority(dir, 'UNIQUE-PRIORITY-NOTE');
  const ctx = hook('SessionStart', { cwd: dir, session_id: 'A', source: 'compact' }, { MIS_STATE_HOME: h }).hookSpecificOutput.additionalContext;
  assert.equal(ctx.split('UNIQUE-PRIORITY-NOTE').length - 1, 1);
});

test('M7 N1: .git is refused in any case', async () => {
  const dir = makeRepo();
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try { for (const p of ['.GIT/config', '.Git/HEAD']) assert.equal((await s.call('wiki_ingest', { path: p })).isError, true, p); } finally { s.close(); }
});

test('M7 N2: outside a repo SessionStart does not detect or store a project', () => {
  const h = home(), nr = mkdtempSync(join(tmpdir(), 'mis-nr-'));
  write(nr, { 'Cargo.toml': '[package]\nname="x"\n' });
  hook('SessionStart', { cwd: nr, session_id: 'A', source: 'startup' }, { MIS_STATE_HOME: h });
  assert.equal(existsSync(join(h, 'memory', 'project.json')), false);
});

test('M7 N3: after compaction the project block is still injected', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }), h = home();
  hook('SessionStart', { cwd: dir, session_id: 'A', source: 'startup' }, { MIS_STATE_HOME: h });
  const ctx = hook('SessionStart', { cwd: dir, session_id: 'A', source: 'compact' }, { MIS_STATE_HOME: h }).hookSpecificOutput.additionalContext;
  assert.match(ctx, /## Project/);
});

test('M7 N4: only a plain whole-suite test command is learned', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ name: 'x' }) }), h = home();
  const post = (command) => hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Bash', tool_input: { command } }, { MIS_STATE_HOME: h });
  post('pytest tests/test_one.py -k slow');
  post('npm test 2>&1 | tail -5');
  assert.equal(projectRead(dir)?.build?.testCommand ?? null, null);
  post('npm test');
  assert.equal(projectRead(dir).build.testCommand, 'npm test');
});

test('M7 N5: code that kills its own interpreter is not run twice', async () => {
  const dir = makeRepo();
  const f = join(dir, 'count.txt');
  const s = await mcpSession(dir, { MIS_STATE_HOME: home() });
  try {
    const r = (await s.call('python_repl', { action: 'execute', code: `open(${JSON.stringify(f)}, 'a').write('x\\n'); import os; os._exit(1)` })).json;
    assert.match(r.error ?? '', /exited|died/);
    assert.equal(readFileSync(f, 'utf8'), 'x\n');
    assert.equal((await s.call('python_repl', { action: 'execute', code: 'print(1+1)' })).json.stdout, '2\n', 'next call works');
  } finally { s.close(); }
});

test('M7 N2 (rest): outside a repo a passing test command is not learned into a global project', () => {
  const h = home(), nr = mkdtempSync(join(tmpdir(), 'mis-nr-'));
  hook('PostToolUse', { cwd: nr, session_id: 'A', tool_name: 'Bash', tool_input: { command: 'cargo test' } }, { MIS_STATE_HOME: h });
  assert.equal(existsSync(join(h, 'memory', 'project.json')), false);
});
