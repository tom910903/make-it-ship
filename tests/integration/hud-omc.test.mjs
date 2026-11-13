// The OMC HUD parts end to end: hooks record, the status line script reads (items opted in through statusLine.items).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, ROOT, write } from '../helpers.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const CC = mkdtempSync(join(tmpdir(), 'mis-cc-'));
const env = (h) => { const e = { ...process.env, MIS_STATE_HOME: h, CLAUDE_CONFIG_DIR: CC, NO_COLOR: '1' }; delete e.CLAUDE_CODE_SESSION_ID; delete e.ANTHROPIC_API_KEY; delete e.NODE_TEST_CONTEXT; return e; };
const hook = (h, event, input) => spawnSync(process.execPath, [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: env(h) });
const statusline = (h, input) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env: env(h) }).stdout;
const items = (h, list) => writeFileSync(join(h, 'config.json'), JSON.stringify({ statusLine: { items: list } }));

test('prompt: UserPromptSubmit records the time, the status line shows the time since then, per session', () => {
  const dir = makeRepo(), h = mkdtempSync(join(tmpdir(), 'mis-home-'));
  items(h, ['prompt']);
  assert.equal(statusline(h, { cwd: dir, session_id: 'S' }), 'MIS ▸ idle\n', 'no prompt yet');
  assert.equal(hook(h, 'UserPromptSubmit', { session_id: 'S', cwd: dir, prompt: 'hello' }).status, 0);
  assert.match(statusline(h, { cwd: dir, session_id: 'S' }), /^MIS ▸ idle · prompt \ds\n$/);
  assert.equal(statusline(h, { cwd: dir, session_id: 'OTHER' }), 'MIS ▸ idle\n');
});

test('agents-list: SubagentStart/Stop drive one row per running subagent', () => {
  const dir = makeRepo(), h = mkdtempSync(join(tmpdir(), 'mis-home-'));
  items(h, ['branch', 'agents-list']);
  hook(h, 'SubagentStart', { session_id: 'S', agent_id: 'a1', agent_type: 'make-it-ship:explorer', cwd: dir });
  hook(h, 'SubagentStart', { session_id: 'S', agent_id: 'a2', agent_type: 'critic', cwd: dir });
  assert.match(statusline(h, { cwd: dir, session_id: 'S' }), /^MIS ▸ idle · main\n├─ (explorer|critic) \ds\n└─ (explorer|critic) \ds\n$/);
  hook(h, 'SubagentStop', { session_id: 'S', agent_id: 'a1', cwd: dir, last_assistant_message: 'done' });
  assert.match(statusline(h, { cwd: dir, session_id: 'S' }), /^MIS ▸ idle · main\n└─ critic \ds\n$/);
});

test('transcript parts, git changes and the repo name in the real script', () => {
  const dir = makeRepo(), h = mkdtempSync(join(tmpdir(), 'mis-home-'));
  items(h, ['repo', 'git', 'skill', 'calls', 'bg', 'thinking']);
  write(dir, { 'new.txt': 'x' });
  const t = join(dir, '..', `t-${process.pid}.jsonl`);
  writeFileSync(t, [
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: '' }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'x', name: 'Skill', input: { skill: 'make-it-ship:qa' } }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'y', name: 'Bash', input: { command: 'sleep 5', run_in_background: true } }] } },
  ].map((o) => JSON.stringify({ timestamp: new Date().toISOString(), ...o }) + '\n').join(''));
  const input = { cwd: dir, session_id: 'S', transcript_path: t, workspace: { current_dir: dir, repo: { host: 'github.com', owner: 'o', name: 'demo' } } };
  assert.equal(statusline(h, input), 'MIS ▸ idle · repo demo · ?1 · skill qa · 🔧2 ⚡1 · bg 1 · think\n');
});
