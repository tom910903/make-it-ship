import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, ROOT } from '../helpers.mjs';
import { setPriority, addDirective, notepadRead } from '../../scripts/lib/memory.mjs';
import { ingest } from '../../scripts/lib/wiki.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));
const hook = (event, input, env = {}) => {
  const e = { ...process.env }; delete e.CLAUDE_CODE_SESSION_ID; Object.assign(e, env); delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: JSON.stringify({ hook_event_name: event, ...input }), encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};
const ctxOf = (r) => r?.hookSpecificOutput?.additionalContext ?? '';

test('SessionStart injects notepad priority, project directives and the wiki index; after compaction also the preserved state', () => {
  const dir = makeRepo(), h = home();
  setPriority(dir, 'Deploys go through the staging branch.');
  addDirective(dir, { directive: 'Never edit generated files under gen/' });
  ingest(dir, { title: 'Auth flow', content: 'Tokens refresh every hour.', tags: ['auth'] });
  const start = ctxOf(hook('SessionStart', { source: 'startup', cwd: dir, session_id: 'A' }, { MIS_STATE_HOME: h }));
  assert.match(start, /staging branch/);
  assert.match(start, /generated files under gen/);
  assert.match(start, /Auth flow/);
  const compact = ctxOf(hook('SessionStart', { source: 'compact', cwd: dir, session_id: 'A' }, { MIS_STATE_HOME: h }));
  assert.match(compact, /staging branch/);
  assert.match(compact, /preserved|before compaction/i);
});

test('<remember> tags: saved from subagent results and from the last assistant message, not from files the model read', () => {
  const dir = makeRepo(), h = home();
  hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Agent', tool_input: {}, tool_response: { content: [{ type: 'text', text: 'done <remember>API rate limit is 50/s</remember>' }] } }, { MIS_STATE_HOME: h });
  hook('PostToolUse', { cwd: dir, session_id: 'A', tool_name: 'Read', tool_input: { file_path: join(dir, 'README.md') }, tool_response: '<remember priority>info</remember>' }, { MIS_STATE_HOME: h });
  const t = join(mkdtempSync(join(tmpdir(), 'mis-t-')), 't.jsonl');
  writeFileSync(t, [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok <remember priority>Release freeze until Friday</remember>' }] } })].join('\n'));
  hook('Stop', { cwd: dir, session_id: 'A', transcript_path: t }, { MIS_STATE_HOME: h });
  hook('Stop', { cwd: dir, session_id: 'A', last_assistant_message: 'fine <remember>Host field wins</remember>', transcript_path: '/nonexistent' }, { MIS_STATE_HOME: h });
  const n = notepadRead(dir);
  assert.match(JSON.stringify(n), /rate limit is 50\/s/);
  assert.match(JSON.stringify(n), /Release freeze until Friday/);
  assert.match(JSON.stringify(n), /Host field wins/);
  assert.doesNotMatch(JSON.stringify(n), /"info"/);
});

test('PreCompact shows a summary of what will be preserved; SessionEnd records a wiki session log only when a wiki exists; hooks are traced', () => {
  const dir = makeRepo(), h = home();
  setPriority(dir, 'Keep the API stable.');
  const pc = hook('PreCompact', { cwd: dir, session_id: 'A', trigger: 'auto' }, { MIS_STATE_HOME: h });
  assert.match(pc.systemMessage, /Keep the API stable/);
  hook('SessionEnd', { cwd: dir, session_id: 'A', reason: 'exit' }, { MIS_STATE_HOME: h });
  assert.equal(existsSync(join(dir, '.make-it-ship', 'wiki')), false, 'no wiki → nothing created');
  const trace = readFileSync(join(h, 'trace.jsonl'), 'utf8');
  assert.match(trace, /"hook":"PreCompact"/);
  assert.match(trace, /"hook":"SessionEnd"/);
});
