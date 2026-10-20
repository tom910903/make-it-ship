// M9-D D1: other-model executors with stub CLIs only (PATH is the stub dir + /usr/bin:/bin; no real codex/gemini/claude).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis, fakeHome } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
function stubs(names, body = (n) => `echo "${'$'}{0##*/} says: $*"`) {
  const h = fakeHome();
  for (const n of names) { writeFileSync(join(h.bin, n), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${n} 9.9"; exit 0; fi\n${body(n)}\n`); chmodSync(join(h.bin, n), 0o755); }
  const env = { ...h.env, PATH: `${h.bin}:/usr/bin:/bin`, CODEX_HOME: join(h.home, '.codex'), OPENAI_API_KEY: '', CODEX_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', ANTHROPIC_API_KEY: '' };
  return { ...h, env };
}

test('mis ask runs the provider CLI and writes second-opinion-*.md; the verdict does not change', () => {
  const h = stubs(['codex']);
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  ok(mis(dir, ['start', '--input', 'x'], { env: h.env }));
  const before = ok(mis(dir, ['verdict'], { env: h.env }));
  const r = ok(mis(dir, ['ask', 'codex', 'review', 'the', 'diff'], { env: h.env }));
  assert.match(r.file, /\.make-it-ship\/ask\/second-opinion-codex-review-the-diff-.*\.md$/);
  const md = readFileSync(r.file, 'utf8');
  assert.match(md, /codex says: exec review the diff/);
  assert.match(md, /company policy may forbid/i);
  assert.deepEqual(ok(mis(dir, ['verdict'], { env: h.env })).reasons, before.reasons);
});

test('mis ask: a missing CLI is BLOCKED, an unknown provider is refused, --file adds context', () => {
  const h = stubs(['gemini']);
  const dir = makeRepo({ 'notes.md': 'CONTEXT-LINE' });
  const r = mis(dir, ['ask', 'codex', 'q'], { env: h.env });
  assert.equal(r.code, 1); assert.match(r.err, /BLOCKED: codex CLI is not on PATH/);
  assert.match(mis(dir, ['ask', 'gpt9', 'q'], { env: h.env }).err, /unknown provider/);
  const g = ok(mis(dir, ['ask', 'gemini', 'summarize', '--file', 'notes.md'], { env: h.env }));
  assert.match(readFileSync(g.file, 'utf8'), /gemini says: -p summarize[\s\S]*CONTEXT-LINE/);
});

test('mis ccg combines both advisors into one synthesis file; with one missing it says so; with none it is BLOCKED', () => {
  const both = stubs(['codex', 'gemini']);
  const dir = makeRepo();
  const r = ok(mis(dir, ['ccg', 'is', 'this', 'safe'], { env: both.env }));
  const md = readFileSync(r.file, 'utf8');
  assert.match(md, /## codex[\s\S]*codex says[\s\S]*## gemini[\s\S]*gemini says[\s\S]*## Synthesis/);
  assert.equal(r.advisors.length, 2);
  for (const a of r.advisors) assert.ok(existsSync(a.file));
  const one = ok(mis(dir, ['ccg', 'x'], { env: stubs(['gemini']).env }));
  assert.deepEqual(one.missing, ['codex']);
  assert.match(readFileSync(one.file, 'utf8'), /Missing perspective: codex/);
  assert.match(mis(dir, ['ccg', 'x'], { env: stubs([]).env }).err, /BLOCKED/);
});

test('mis second-opinion probe reports version and login state without running a prompt', () => {
  const h = stubs(['codex', 'gemini'], () => 'echo PROMPT-RAN >> "$HOME/ran"');
  mkdirSync(join(h.home, '.codex'), { recursive: true });
  writeFileSync(join(h.home, '.codex', 'auth.json'), '{}');
  const dir = makeRepo();
  const p = Object.fromEntries(ok(mis(dir, ['second-opinion', 'probe'], { env: h.env })).providers.map((x) => [x.name, x]));
  assert.equal(p.codex.version, 'codex 9.9');
  assert.equal(p.codex.auth, 'AUTH_OK (file)');
  assert.equal(p.gemini.auth, 'AUTH_MISSING');
  assert.equal(p.claude.installed, false);
  assert.equal(ok(mis(dir, ['second-opinion', 'probe'], { env: { ...h.env, GEMINI_API_KEY: 'k' } })).providers[1].auth, 'AUTH_OK (env)');
  assert.equal(existsSync(join(h.home, 'ran')), false, 'no prompt was sent');
});

test('mis benchmark-models: one row per model with status, time and exit; missing models are unavailable', () => {
  const h = stubs(['codex', 'claude'], (n) => (n === 'claude' ? 'exit 3' : 'echo fine'));
  const dir = makeRepo();
  const r = ok(mis(dir, ['benchmark-models', 'write', 'a', 'haiku', '--models', 'codex,gemini,claude'], { env: h.env }));
  const rows = Object.fromEntries(r.rows.map((x) => [x.model, x]));
  assert.equal(rows.codex.status, 'ok');
  assert.ok(Number.isInteger(rows.codex.ms));
  assert.equal(rows.gemini.status, 'unavailable');
  assert.equal(rows.claude.status, 'failed (3)');
  assert.match(readFileSync(r.file, 'utf8'), /\| codex \| ok \|/);
});

test('mis interop splits one tmux window into Claude and Codex panes; without tmux it is BLOCKED', () => {
  const h = stubs([]);
  const dir = makeRepo();
  assert.match(mis(dir, ['interop'], { env: h.env }).err, /BLOCKED: tmux is not installed/);
  writeFileSync(join(h.bin, 'tmux'), `#!/bin/sh\necho "$*" >> "$HOME/tmux.log"\n`); chmodSync(join(h.bin, 'tmux'), 0o755);
  const r = ok(mis(dir, ['interop', '--session', 'pair1'], { env: { ...h.env, MIS_INTEROP_CLAUDE_CMD: 'echo L', MIS_INTEROP_CODEX_CMD: 'echo R' } }));
  assert.equal(r.session, 'pair1');
  const log = readFileSync(join(h.home, 'tmux.log'), 'utf8');
  assert.match(log, /new-session -d -s pair1 .* echo L/);
  assert.match(log, /split-window -h -t pair1 .* echo R/);
});
