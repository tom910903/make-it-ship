// Observations end to end (user decision 2026-11-10): PostToolUse/PostToolUseFailure append to <git-common-dir>/make-it-ship/observations.jsonl, mis memory searches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT } from '../helpers.mjs';
import { OBS_MAX_BYTES } from '../../scripts/lib/observe.mjs';

const HOOKS = join(ROOT, 'scripts', 'hooks.mjs');
const hook = (event, input, home) => {
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: JSON.stringify({ hook_event_name: event, session_id: 's1', ...input }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
};
// the one project folder of a test home's global store
const store = (home, f = 'observations.jsonl') => { const root = join(home, 'memory', 'projects'); return join(root, (existsSync(root) && readdirSync(root)[0]) || 'none', f); };
const lines = (home) => existsSync(store(home)) ? readFileSync(store(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];

test('hooks record observations (repeats in a row once), mis memory lists and searches them', () => {
  const dir = makeRepo({ 'src/chart.mjs': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/chart.mjs') }, cwd: dir }, home);
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/chart.mjs') }, cwd: dir }, home);
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run chart tests' }, cwd: dir }, home);
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'node build.mjs' }, error: 'Error: missing dist', cwd: dir }, home);
  const recs = lines(home);
  assert.deepEqual(recs.map((r) => r.type), ['change', 'test', 'failure']);
  assert.ok(recs.every((r) => r.id && r.at && r.session === 's1'));
  const env = { MIS_STATE_HOME: home };
  const s = mis(dir, ['memory', 'search', 'chart'], { env });
  assert.equal(s.code, 0, s.err);
  assert.deepEqual(s.json.map((r) => r.type).sort(), ['change', 'test']);
  assert.deepEqual(mis(dir, ['memory', 'search', 'chart', '--type', 'test'], { env }).json.map((r) => r.type), ['test']);
  assert.match(mis(dir, ['memory', '--last', '2'], { env }).out, /test .*Run chart tests[\s\S]*failure .*missing dist/);
  assert.match(mis(dir, ['memory', 'search'], { env }).err, /usage: mis memory/);
});

test('memory.observe false records nothing; the file is cut to its newer half past the size cap', () => {
  const dir = makeRepo({ 'a.txt': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ memory: { observe: false } }));
  hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home);
  assert.deepEqual(lines(home), []);
  const home2 = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const old = JSON.stringify({ id: 'old', at: '2026-01-01T00:00:00Z', type: 'command', title: 'x'.repeat(200) }) + '\n';
  hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home2);
  writeFileSync(store(home2), old.repeat(Math.ceil(OBS_MAX_BYTES / old.length) + 10));
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home2);
  const after = readFileSync(store(home2), 'utf8');
  assert.ok(after.length <= OBS_MAX_BYTES / 2 + 1000, `cut to half: ${after.length}`);
  assert.equal(JSON.parse(after.trim().split('\n').at(-1)).type, 'change', 'the newest record survives');
  assert.ok(after.split('\n').filter(Boolean).every((l) => JSON.parse(l)), 'no partial line left');
});

// ---- claude-mem quality (user decision 2026-11-10): Stop starts the summarizer, SessionStart shows the result ----
const hookOut = (event, input, home, env = {}) => {
  const e = { ...process.env, MIS_STATE_HOME: home, ...env }; delete e.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HOOKS, event], { input: JSON.stringify({ hook_event_name: event, session_id: 's1', ...input }), encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};
function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), 'mis-fake-claude-')), bin = join(dir, 'claude');
  const result = JSON.stringify({ observations: [{ type: 'feature', title: 'Chart legend added', facts: ['legend only for named series'], narrative: 'Added a legend.' }], summary: { request: 'add a chart legend', completed: 'legend', next_steps: 'docs' } });
  writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\nprintf '%s' ${JSON.stringify(JSON.stringify({ result, usage: { input_tokens: 800, output_tokens: 200 } }))}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
const waitFor = (f, ms = 8000) => { const end = Date.now() + ms; while (!existsSync(f) && Date.now() < end) spawnSync('sleep', ['0.1']); return existsSync(f); };

test('Stop summarizes the turn in the background; SessionStart shows it in claude-mem layout once a notice was given; resume shows none', () => {
  const dir = makeRepo({ 'src/chart.mjs': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { MIS_MEMORY_CLAUDE: fakeClaude(), CLAUDE_CODE_ENTRYPOINT: 'cli', MIS_TEAM_ID: '', MIS_HEADLESS: '' };
  hookOut('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/chart.mjs') }, cwd: dir }, home, env);
  hookOut('Stop', { cwd: dir, transcript_path: '' }, home, env);
  assert.ok(waitFor(store(home, 'memories.jsonl')), 'the worker wrote memories');
  const first = hookOut('SessionStart', { cwd: dir, source: 'startup' }, home, env);
  const ctx = first.hookSpecificOutput.additionalContext;
  assert.match(ctx, /^# \[make-it-ship\] /m);
  assert.match(ctx, /Legend: 🎯session/);
  assert.match(ctx, /\n1 \S+ 🟣 Chart legend added/);
  assert.match(ctx, /\*\*Next Steps\*\*: docs/);
  assert.match(first.systemMessage, /memory\.summarize false/);
  assert.equal(hookOut('SessionStart', { cwd: dir, source: 'startup' }, home, env).systemMessage, undefined, 'the notice shows once');
  assert.doesNotMatch(hookOut('SessionStart', { cwd: dir, source: 'resume' }, home, env).hookSpecificOutput.additionalContext, /Legend: 🎯session/);
  const got = mis(dir, ['memory', 'get', '1', 'S1', 'nope'], { env: { MIS_STATE_HOME: home } }).json;
  assert.deepEqual([got[0].title, got[1].request, got[2].missing], ['Chart legend added', 'add a chart legend', true]);
  assert.equal(mis(dir, ['memory', 'search', 'legend', '--type', 'feature'], { env: { MIS_STATE_HOME: home } }).json[0].id, 1);
});

test('no summarizer for headless or team sessions, with memory.summarize false, or inside the summarizer itself', () => {
  const run = (env, cfg) => {
    const dir = makeRepo({ 'a.txt': '' });
    const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
    if (cfg) writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
    const e = { MIS_MEMORY_CLAUDE: fakeClaude(), CLAUDE_CODE_ENTRYPOINT: 'cli', MIS_TEAM_ID: '', MIS_HEADLESS: '', ...env };
    hookOut('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home, e);
    const out = hookOut('Stop', { cwd: dir }, home, e);
    spawnSync('sleep', ['1.5']);
    return { dir, out, memories: existsSync(store(home, 'memories.jsonl')), observed: existsSync(store(home)) };
  };
  assert.equal(run({ MIS_HEADLESS: '1' }).memories, false);
  assert.equal(run({ MIS_TEAM_ID: 't1' }).memories, false);
  assert.equal(run({}, { memory: { summarize: false } }).memories, false);
  const inner = run({ MIS_MEMORY_WORKER: '1' });
  assert.deepEqual([inner.out, inner.memories, inner.observed], [null, false, false], 'hooks are silent inside the summarizer');
});
