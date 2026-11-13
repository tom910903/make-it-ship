import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers.mjs';
import { commands } from '../../scripts/lib/commands.mjs';

// Every `/make-it-ship:<skill>` and `mis <command>` named in a README or the manual checks must exist. Scanning the whole text (not only code)
// is a superset of code blocks and inline code; `mis.mjs <cmd>` counts too; lowercase-only names skip MIS_CLI and Korean prose.
function unknownNames(text) {
  const skills = [...text.matchAll(/\/make-it-ship:([a-z0-9-]+)/g)].map((m) => m[1]).filter((s) => !existsSync(join(ROOT, 'skills', s, 'SKILL.md')));
  const cmds = [...text.matchAll(/\bmis(?:\.mjs)? ([a-z][a-z0-9-]*)/g)].map((m) => m[1]).filter((c) => !Object.hasOwn(commands, c));
  return { skills: [...new Set(skills)], commands: [...new Set(cmds)] };
}

test('the checker reports a wrong skill and a wrong mis command', () => {
  assert.deepEqual(unknownNames('run `mis nosuch`, `node scripts/mis.mjs nothere` or /make-it-ship:nope, but `mis check` and /make-it-ship:run are real'), { skills: ['nope'], commands: ['nosuch', 'nothere'] });
});

for (const f of ['README.md', 'README.ko.md', 'docs/manual-checks.md']) {
  test(`${f}: every /make-it-ship:<skill> and mis <command> it names exists`, () => {
    assert.ok(existsSync(join(ROOT, f)), `${f} exists`);
    assert.deepEqual(unknownNames(readFileSync(join(ROOT, f), 'utf8')), { skills: [], commands: [] });
  });
}

test('README.md and README.ko.md link to each other', () => {
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /\]\(README\.ko\.md\)/);
  assert.match(readFileSync(join(ROOT, 'README.ko.md'), 'utf8'), /\]\(README\.md\)/);
});

test('both READMEs give every PARTIAL reason, say rejecting approval stops the run, and match each other', () => {
  const en = readFileSync(join(ROOT, 'README.md'), 'utf8'), ko = readFileSync(join(ROOT, 'README.ko.md'), 'utf8');
  const row = (t) => t.split('\n').find((l) => l.startsWith('| `PARTIAL`'));
  assert.match(row(en), /unmerged task worktrees/); assert.match(row(en), /no required checks defined/);
  assert.match(row(ko), /병합하지 않은 task worktree/); assert.match(row(ko), /필수 check가 정의되지 않음/);
  assert.match(en, /declining stops the run/i); assert.match(ko, /거절하면 그 자리에서 멈춥니다/);
  assert.match(en, /Going over `limits` makes the run `BLOCKED`/); assert.match(ko, /`limits`를 넘으면/);
  assert.match(en, /written in Korean/); assert.match(ko, /한국어로 작성/);
  for (const t of [en, ko]) assert.match(t, /mis init --layout --write/);
});
