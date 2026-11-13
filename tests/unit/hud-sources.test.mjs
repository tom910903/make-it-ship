import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCounts, lastInput, rememberInput, repoName, transcriptStats } from '../../scripts/lib/hud-sources.mjs';
import { git, makeRepo, write } from '../helpers.mjs';

test('gitCounts: staged, modified, untracked, ahead and behind from git status; null outside a repository', () => {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), 'mis-origin-')));
  git(origin, 'init', '-q', '--bare');
  const src = makeRepo({ 'a.txt': '1\n', 'b.txt': '1\n' });
  git(src, 'push', '-q', origin, 'main');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mis-clone-')));
  git(dir, 'clone', '-q', origin, '.');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.x'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
  let t = Date.now();
  const counts = (d) => gitCounts(d, t += 61_000); // past the cache: every call runs git status
  assert.deepEqual(counts(dir), { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 });
  write(dir, { 'c.txt': 'new\n' });
  git(dir, 'add', 'c.txt');
  write(dir, { 'a.txt': '2\n', 'u1.txt': 'x', 'u2.txt': 'y' });
  assert.deepEqual(counts(dir), { staged: 1, modified: 1, untracked: 2, ahead: 0, behind: 0 });
  git(dir, 'commit', '-qam', 'local');
  write(src, { 'b.txt': '2\n' });
  git(src, 'commit', '-qam', 'remote');
  git(src, 'push', '-q', origin, 'main');
  git(dir, 'fetch', '-q');
  assert.deepEqual(counts(dir), { staged: 0, modified: 0, untracked: 2, ahead: 1, behind: 1 });
  assert.equal(counts(mkdtempSync(join(tmpdir(), 'mis-nogit-'))), null);
});
test('gitCounts is cached per directory for 5 seconds, and for a minute after git timed out', () => {
  const dir = makeRepo();
  const t = Date.now();
  assert.deepEqual(gitCounts(dir, t), { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 });
  write(dir, { 'n.txt': 'x' });
  assert.equal(gitCounts(dir, t + 4000).untracked, 0, 'within 5 s: the cached counts');
  assert.equal(gitCounts(dir, t + 6000).untracked, 1, 'after 5 s: git status again');
  const bin = mkdtempSync(join(tmpdir(), 'mis-slowgit-')), path = process.env.PATH;
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nsleep 3\n'); chmodSync(join(bin, 'git'), 0o755);
  const slow = makeRepo();
  process.env.PATH = `${bin}:${path}`;
  try { assert.equal(gitCounts(slow, t), null, 'git over 500 ms: nothing'); } finally { process.env.PATH = path; }
  assert.equal(gitCounts(slow, t + 30_000), null, 'a slow repo is not asked again within a minute');
  assert.deepEqual(gitCounts(slow, t + 61_000), { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 });
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

test('transcriptStats reads in chunks and at most a byte budget per call: a long transcript catches up over several calls, with lines and UTF-8 intact', () => {
  const t = join(mkdtempSync(join(tmpdir(), 'mis-tr-')), 't.jsonl');
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(asst(`m${i}`, [{ type: 'text', text: '한글 é 🔧 '.repeat(i % 5) }, { type: 'tool_use', id: `t${i}`, name: i % 10 ? 'Read' : 'Skill', input: { skill: `make-it-ship:s${i}` } }]));
  writeFileSync(t, lines.join(''));
  const whole = transcriptStats(t, 'W');
  assert.deepEqual({ ...whole }, { tools: 40, agents: 0, skills: 4, skill: 's30', bg: 0, think: false });
  let s, calls = 0;
  do { s = transcriptStats(t, 'C', Date.now(), { chunk: 97, budget: 1500 }); calls++; } while (s.tools < 40 && calls < 100);
  assert.ok(calls > 3, `the budget stopped each call early (${calls} calls)`);
  assert.deepEqual({ ...s }, { ...whole }, 'chunk edges inside lines and inside UTF-8 sequences change nothing');
});

test('rememberInput keeps the last status line input for mis hud previews, at most every 5 seconds', () => {
  const now = Date.now();
  rememberInput({ n: 1 }, now);
  assert.deepEqual(lastInput(), { n: 1 });
  rememberInput({ n: 2 }, now + 1000);
  assert.deepEqual(lastInput(), { n: 1 }, 'within 5 s: not written again');
  rememberInput({ n: 3 }, now + 6000);
  assert.deepEqual(lastInput(), { n: 3 });
});

test('a completion notice that came in mid-turn (queue-operation or queued_command attachment, not a user message) ends the background task', () => {
  const t = join(mkdtempSync(join(tmpdir(), 'mis-tr-')), 't.jsonl');
  const notice = (id) => `<task-notification>\n<task-id>b-${id}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
  const line = (o) => JSON.stringify({ timestamp: new Date().toISOString(), ...o }) + '\n';
  writeFileSync(t, [
    asst('m1', [{ type: 'tool_use', id: 'q1', name: 'Bash', input: { command: 'npm test', run_in_background: true } }]),
    asst('m1', [{ type: 'tool_use', id: 'q2', name: 'Bash', input: { command: 'sleep 9', run_in_background: true } }]),
    asst('m1', [{ type: 'tool_use', id: 'q3', name: 'Bash', input: { command: 'sleep 99', run_in_background: true } }]),
  ].join(''));
  assert.equal(transcriptStats(t, 'Q').bg, 3);
  appendFileSync(t, line({ type: 'queue-operation', operation: 'enqueue', content: notice('q1') })
    + line({ type: 'attachment', attachment: { type: 'queued_command', prompt: notice('q2'), commandMode: 'task-notification' } })
    + line({ type: 'attachment', attachment: { type: 'hook_success', toolUseID: 'q3', content: '<task-notification>' } }));
  assert.equal(transcriptStats(t, 'Q').bg, 1, 'q1 and q2 ended; a hook attachment that names q3 is not a notice');
});
