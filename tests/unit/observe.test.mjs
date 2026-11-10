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

test('observation r1: secrets in options, env, Basic auth and prose are masked; heredoc bodies are never stored', () => {
  const leaks = {
    'export AWS_SECRET_ACCESS_KEY=abcdefghijklmnop1234': 'abcdefghijklmnop1234',
    'curl -H "Authorization: Basic dXNlcjpwYXNz" https://x': 'dXNlcjpwYXNz',
    'curl -u admin:hunter2pass https://x': 'hunter2pass',
    'mysql -u root -pHunter2pass db': 'Hunter2pass',
    'DB_PASS=hunter2xyz ./run': 'hunter2xyz',
    'node x --token abc123def456': 'abc123def456',
    'node x --password=abc123def456': 'abc123def456',
    'echo "password is hunter2xyz"': 'hunter2xyz',
    'cat > .env <<EOF\nAPI=plainvalue123\nEOF': 'plainvalue123',
  };
  for (const [command, secret] of Object.entries(leaks)) assert.doesNotMatch(JSON.stringify(obs('Bash', { command })), new RegExp(secret), command);
  assert.equal(obs('Bash', { command: 'mkdir -p out && ls' }).cmd, 'mkdir -p out && ls', 'ordinary options stay readable');
});

test('observation r1: Claude Code heredoc commits, git -C and escaped quotes are commits; odd input is skipped', () => {
  const heredoc = `git commit -m "$(cat <<'EOF'\nfeat: add thing\n\nbody\nEOF\n)"`;
  assert.deepEqual([obs('Bash', { command: heredoc }).type, obs('Bash', { command: heredoc }).title], ['commit', 'feat: add thing']);
  assert.equal(obs('Bash', { command: 'git -C sub commit -m "fix \\"quoted\\" bit"' }).title, 'fix \\"quoted\\" bit');
  assert.equal(obs('Write', {}), null);
  const failed = observation({ tool_name: 'Bash', tool_input: { command: 'x' }, error: null, hook_event_name: 'PostToolUseFailure' }, root);
  assert.equal(failed.type, 'failure');
  assert.equal(failed.error, undefined);
  assert.equal(obs('Bash', { command: 'x' }, { error: null }).type, 'command', 'a null error outside the failure hook is not a failure');
});

test('searchObservations: equal scores list the newer record first', () => {
  const same = [{ id: 'old', at: '2026-01-01T00:00:00Z', type: 'read', title: 'Read a.md' }, { id: 'new', at: '2026-02-01T00:00:00Z', type: 'read', title: 'Read a.md' }];
  assert.deepEqual(searchObservations(same, 'a.md').map((r) => r.id), ['new', 'old']);
});
