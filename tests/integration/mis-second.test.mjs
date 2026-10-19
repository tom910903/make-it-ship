import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis } from '../helpers.mjs';
import { classify } from '../../scripts/lib/policy.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('second-opinion detect finds other model CLIs on PATH', () => {
  const bin = mkdtempSync(join(tmpdir(), 'mis-bin-'));
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho codex 1.0\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const dir = makeRepo();
  const r = ok(mis(dir, ['second-opinion', 'detect'], { env: { PATH: `${bin}:/usr/bin:/bin` } }));
  assert.deepEqual(r.available.map((a) => a.name), ['codex']);
  assert.match(r.note, /external/);
  const none = ok(mis(dir, ['second-opinion', 'detect'], { env: { PATH: '/usr/bin:/bin' } }));
  assert.deepEqual(none.available, []);
});

test('calling another model CLI asks first (repository content leaves the machine)', () => {
  const ctx = { repoRoot: '/r', activeRun: true, currentBranch: 'f' };
  for (const c of ['codex exec "review the diff"', 'gemini -p "review"', 'cat diff.txt | codex exec -', 'omc ask codex "x"']) {
    assert.equal(classify({ tool_name: 'Bash', tool_input: { command: c }, cwd: '/r' }, ctx).decision, 'ask', c);
  }
  assert.equal(classify({ tool_name: 'Bash', tool_input: { command: 'codex --version' }, cwd: '/r' }, ctx).decision, 'allow');
});

test('a second opinion is recorded as a note shown in the report, without affecting the verdict', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  ok(mis(dir, ['start', '--input', 'x']));
  const before = ok(mis(dir, ['verdict']));
  ok(mis(dir, ['note', 'second-opinion', '-'], { input: 'codex: GATE PASS, no P1 findings' }));
  const after = ok(mis(dir, ['verdict']));
  assert.deepEqual(after.reasons, before.reasons);
  const md = readFileSync(join(dir, ok(mis(dir, ['report'])).path), 'utf8');
  assert.match(md, /second opinion.*codex: GATE PASS/i);
});
