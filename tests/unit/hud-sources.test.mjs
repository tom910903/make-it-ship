import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCounts, repoName, transcriptStats } from '../../scripts/lib/hud-sources.mjs';
import { git, makeRepo, write } from '../helpers.mjs';

test('gitCounts: staged, modified, untracked, ahead and behind from git status; null outside a repository', () => {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), 'mis-origin-')));
  git(origin, 'init', '-q', '--bare');
  const src = makeRepo({ 'a.txt': '1\n', 'b.txt': '1\n' });
  git(src, 'push', '-q', origin, 'main');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mis-clone-')));
  git(dir, 'clone', '-q', origin, '.');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.x'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
  assert.deepEqual(gitCounts(dir), { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 });
  write(dir, { 'c.txt': 'new\n' });
  git(dir, 'add', 'c.txt');
  write(dir, { 'a.txt': '2\n', 'u1.txt': 'x', 'u2.txt': 'y' });
  assert.deepEqual(gitCounts(dir), { staged: 1, modified: 1, untracked: 2, ahead: 0, behind: 0 });
  git(dir, 'commit', '-qam', 'local');
  write(src, { 'b.txt': '2\n' });
  git(src, 'commit', '-qam', 'remote');
  git(src, 'push', '-q', origin, 'main');
  git(dir, 'fetch', '-q');
  assert.deepEqual(gitCounts(dir), { staged: 0, modified: 0, untracked: 2, ahead: 1, behind: 1 });
  assert.equal(gitCounts(mkdtempSync(join(tmpdir(), 'mis-nogit-'))), null);
});

test('repoName: Claude Code\'s workspace.repo first, else the origin remote\'s last path segment (never the credentials)', () => {
  const dir = makeRepo();
  assert.equal(repoName({ host: 'github.com', owner: 'o', name: 'from-host' }, dir), 'from-host');
  assert.equal(repoName(undefined, dir), null, 'no remote');
  git(dir, 'remote', 'add', 'origin', 'https://user:s3cret@github.com/o/my-repo.git');
  assert.equal(repoName(undefined, dir), 'my-repo');
  git(dir, 'remote', 'set-url', 'origin', 'git@github.com:o/other.git');
  assert.equal(repoName(null, dir), 'other');
  assert.equal(repoName(null, mkdtempSync(join(tmpdir(), 'mis-nogit-'))), null);
});

const line = (o) => JSON.stringify(o) + '\n';
const asst = (id, blocks, extra = {}) => line({ type: 'assistant', message: { id, content: blocks }, timestamp: new Date().toISOString(), ...extra });
const user = (content, extra = {}) => line({ type: 'user', message: { role: 'user', content }, timestamp: new Date().toISOString(), ...extra });

test('transcriptStats: tool / agent / skill calls, last skill (tool or slash-typed), background tasks until their notice, and whether the latest reply thought', () => {
  const t = join(mkdtempSync(join(tmpdir(), 'mis-tr-')), 't.jsonl');
  writeFileSync(t, [
    user('<command-message>make-it-ship:hud</command-message>\n<command-name>/make-it-ship:hud</command-name>'),
    user([{ type: 'text', text: 'Base directory for this skill: /x/skills/hud\n\n...' }], { isMeta: true }),
    user('<command-name>/effort</command-name>'), // a built-in command: no skill text follows
    asst('m1', [{ type: 'thinking', thinking: '', signature: 's' }]),
    asst('m1', [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'sleep 9', run_in_background: true } }]),
    asst('m1', [{ type: 'tool_use', id: 'ta', name: 'Agent', input: { prompt: 'x' } }]),
    asst('m1', [{ type: 'tool_use', id: 'tf', name: 'Agent', input: { prompt: 'y' } }]),
    user([{ type: 'tool_result', tool_use_id: 'ta', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a1' }] }]),
    user([{ type: 'tool_result', tool_use_id: 'tf', content: [{ type: 'text', text: 'foreground result' }] }]),
    asst('m2', [{ type: 'tool_use', id: 'ts', name: 'Skill', input: { skill: 'make-it-ship:review' } }]),
    user([{ type: 'tool_result', tool_use_id: 'ts', content: 'Launching skill: make-it-ship:review' }]),
    user([{ type: 'text', text: 'Base directory for this skill: /x/skills/review' }], { isMeta: true }),
    asst('s1', [{ type: 'tool_use', id: 'side', name: 'Read', input: {} }, { type: 'thinking', thinking: '' }], { isSidechain: true }),
  ].join(''));
  const s = transcriptStats(t, 'S1');
  assert.deepEqual({ ...s }, { tools: 4, agents: 2, skills: 2, skill: 'review', bg: 2, think: false });
  appendFileSync(t, user('<task-notification>\n<task-id>bx</task-id>\n<tool-use-id>tb</tool-use-id>\n<status>completed</status>\n</task-notification>'));
  appendFileSync(t, asst('m3', [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ok' }]));
  const half = asst('m4', [{ type: 'tool_use', id: 'half', name: 'Read', input: {} }]);
  appendFileSync(t, half.slice(0, 40));
  assert.deepEqual({ ...transcriptStats(t, 'S1') }, { tools: 4, agents: 2, skills: 2, skill: 'review', bg: 1, think: true }, 'read on from the cached offset; a half-written line waits');
  appendFileSync(t, half.slice(40) + user('<task-notification>\n<tool-use-id>ta</tool-use-id>\n<status>killed</status>\n</task-notification>'));
  assert.deepEqual({ ...transcriptStats(t, 'S1') }, { tools: 5, agents: 2, skills: 2, skill: 'review', bg: 0, think: false });
  assert.equal(transcriptStats(t, 'S1').tools, 5, 'cached counts are stable');
  assert.ok(existsSync(join(process.env.MIS_STATE_HOME, 'sessions', 'S1.hud.json')));
  const old = join(mkdtempSync(join(tmpdir(), 'mis-tr-')), 'old.jsonl');
  writeFileSync(old, asst('o', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { run_in_background: true } }], { timestamp: new Date(Date.now() - 7 * 3600e3).toISOString() }));
  assert.equal(transcriptStats(old, 'S2').bg, 0, 'a background task without a notice for 6 hours no longer counts');
  assert.equal(transcriptStats(join(tmpdir(), 'missing.jsonl'), 'S3'), null);
  assert.equal(transcriptStats(undefined, 'S3'), null);
});
