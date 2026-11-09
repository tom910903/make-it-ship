// Observations end to end (user decision 2026-11-10): PostToolUse/PostToolUseFailure append to <git-common-dir>/make-it-ship/observations.jsonl, mis memory searches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const obsFile = (dir) => join(dir, '.git', 'make-it-ship', 'observations.jsonl');
const lines = (dir) => existsSync(obsFile(dir)) ? readFileSync(obsFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];

test('hooks record observations (repeats in a row once), mis memory lists and searches them', () => {
  const dir = makeRepo({ 'src/chart.mjs': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/chart.mjs') }, cwd: dir }, home);
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/chart.mjs') }, cwd: dir }, home);
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run chart tests' }, cwd: dir }, home);
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'node build.mjs' }, error: 'Error: missing dist', cwd: dir }, home);
  const recs = lines(dir);
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
  assert.deepEqual(lines(dir), []);
  const home2 = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const old = JSON.stringify({ id: 'old', at: '2026-01-01T00:00:00Z', type: 'command', title: 'x'.repeat(200) }) + '\n';
  hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home2);
  writeFileSync(obsFile(dir), old.repeat(Math.ceil(OBS_MAX_BYTES / old.length) + 10));
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.txt') }, cwd: dir }, home2);
  const after = readFileSync(obsFile(dir), 'utf8');
  assert.ok(after.length <= OBS_MAX_BYTES / 2 + 1000, `cut to half: ${after.length}`);
  assert.equal(JSON.parse(after.trim().split('\n').at(-1)).type, 'change', 'the newest record survives');
  assert.ok(after.split('\n').filter(Boolean).every((l) => JSON.parse(l)), 'no partial line left');
});
