// Observations (user decision 2026-11-10, claude-mem items 1-2): one rule-based record per tool use, BM25 search over them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observation, searchObservations, OBS_MAX_BYTES } from '../../scripts/lib/observe.mjs';

const root = '/repo';
const obs = (tool_name, tool_input, extra = {}) => observation({ tool_name, tool_input, cwd: root, ...extra }, root);

test('observation: type and title from the tool, paths relative to the repository', () => {
  assert.deepEqual(obs('Edit', { file_path: '/repo/src/a.mjs' }), { type: 'change', title: 'Edited src/a.mjs', files: ['src/a.mjs'] });
  assert.deepEqual(obs('Write', { file_path: '/elsewhere/x.md' }), { type: 'change', title: 'Wrote /elsewhere/x.md', files: ['/elsewhere/x.md'] });
  assert.deepEqual(obs('Read', { file_path: '/repo/README.md' }), { type: 'read', title: 'Read README.md', files: ['README.md'] });
  assert.deepEqual(obs('Bash', { command: 'npm test', description: 'Run the suite' }), { type: 'test', title: 'Run the suite', cmd: 'npm test' });
  assert.deepEqual(obs('Bash', { command: 'git commit -qm "fix: parse dates" && git push' }), { type: 'commit', title: 'fix: parse dates', cmd: 'git commit -qm "fix: parse dates" && git push' });
  assert.equal(obs('Bash', { command: 'ls -la' }).type, 'command');
  assert.equal(obs('Bash', { command: 'ls -la' }).title, 'ls -la');
  assert.deepEqual(obs('Agent', { description: 'Verify brainstorm', subagent_type: 'verifier' }), { type: 'agent', title: 'Agent (verifier): Verify brainstorm' });
  assert.deepEqual(obs('Skill', { skill: 'make-it-ship:review' }), { type: 'skill', title: 'Skill make-it-ship:review' });
  assert.equal(obs('TodoWrite', { todos: [] }), null);
});

test('observation: failures keep the first error line; secrets are masked; long text is cut', () => {
  const f = obs('Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuv" https://x' }, { error: 'exit 7\nmore', failed: true });
  assert.equal(f.type, 'failure');
  assert.match(f.title, /^Failed: /);
  assert.match(f.error, /^exit 7$/);
  assert.doesNotMatch(JSON.stringify(f), /abcdefghijklmnopqrstuv/);
  assert.ok(obs('Bash', { command: 'echo ' + 'x'.repeat(1000) }).cmd.length <= 300);
  assert.doesNotMatch(JSON.stringify(obs('Bash', { command: 'export API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234' })), /sk-abcdefghij/);
});

const recs = [
  { id: 'a', at: '2026-11-01T00:00:00Z', type: 'change', title: 'Edited scripts/lib/chart.mjs', files: ['scripts/lib/chart.mjs'] },
  { id: 'b', at: '2026-11-09T00:00:00Z', type: 'test', title: 'Run chart tests', cmd: 'node --test tests/unit/chart.test.mjs' },
  { id: 'c', at: '2026-11-09T01:00:00Z', type: 'command', title: 'List files', cmd: 'ls' },
  { id: 'd', at: '2026-11-10T00:00:00Z', type: 'commit', title: '슬라이드 덱 렌더 수정' },
];

test('searchObservations: BM25 ranks matches, filters by type and age, finds Korean, newest first on ties', () => {
  assert.deepEqual(searchObservations(recs, 'chart').map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(searchObservations(recs, 'chart tests').map((r) => r.id)[0], 'b', 'more matching terms rank higher');
  assert.deepEqual(searchObservations(recs, 'chart', { type: 'change' }).map((r) => r.id), ['a']);
  assert.deepEqual(searchObservations(recs, 'chart', { since: '2026-11-05T00:00:00Z' }).map((r) => r.id), ['b']);
  assert.deepEqual(searchObservations(recs, '슬라이드').map((r) => r.id), ['d']);
  assert.deepEqual(searchObservations(recs, 'nothing-like-this'), []);
  assert.equal(searchObservations(recs, 'chart', { limit: 1 }).length, 1);
  assert.ok(searchObservations(recs, 'chart').every((r) => typeof r.score === 'number'));
  assert.ok(OBS_MAX_BYTES > 0);
});
