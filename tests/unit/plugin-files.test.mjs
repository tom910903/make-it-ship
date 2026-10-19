import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers.mjs';
import { commands } from '../../scripts/lib/commands.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'frontmatter present');
  return Object.fromEntries(m[1].split('\n').filter((l) => /^\w[\w-]*:/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

const AGENTS = ['explorer', 'critic', 'spec-reviewer', 'quality-reviewer'];
const REVIEWERS = ['critic', 'spec-reviewer', 'quality-reviewer'];
const PHASES = ['discover', 'interview', 'plan', 'plan-critique', 'implement', 'verify', 'review'];
const SKILLS = ['run', 'status', 'interview', 'plan-review', 'review'];

for (const a of AGENTS) {
  test(`agent ${a}: read-only tools allowlist, untrusted-input warning`, () => {
    const text = read(`agents/${a}.md`);
    const fm = frontmatter(text);
    assert.equal(fm.name, a);
    assert.ok(fm.description.length > 20);
    assert.equal(fm.tools, 'Read, Grep, Glob, Bash', 'ADR-013 allowlist');
    assert.equal(fm.disallowedTools, undefined);
    assert.match(text, /untrusted/i);
    assert.match(text, /do not (modify|change|write)/i);
  });
}
for (const a of REVIEWERS) {
  test(`agent ${a}: output header parsable by mis review add`, () => {
    const text = read(`agents/${a}.md`);
    assert.match(text, /^BLOCKING: <n>$/m);
    assert.match(text, /^MAJOR: <n>$/m);
  });
}

for (const s of SKILLS) {
  test(`skill ${s}: frontmatter and mis usage via plugin root`, () => {
    const text = read(`skills/${s}/SKILL.md`);
    const fm = frontmatter(text);
    assert.equal(fm.name, s);
    assert.ok(fm.description.length > 20);
  });
}

test('run skill references every M1 phase file and phases exist', () => {
  const run = read('skills/run/SKILL.md');
  for (const p of PHASES) {
    assert.ok(existsSync(join(ROOT, `skills/run/phases/${p}.md`)), `phase ${p} exists`);
    assert.ok(run.includes(`phases/${p}.md`), `run references ${p}`);
  }
  assert.match(run, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/mis\.mjs/);
});

test('direct commands use their phase files', () => {
  assert.match(read('skills/interview/SKILL.md'), /phases\/interview\.md/);
  assert.match(read('skills/plan-review/SKILL.md'), /phases\/plan-critique\.md/);
  assert.match(read('skills/review/SKILL.md'), /phases\/review\.md/);
});

test('every `mis <command>` mentioned in skills and phases exists', () => {
  const files = [...SKILLS.map((s) => `skills/${s}/SKILL.md`), ...readdirSync(join(ROOT, 'skills/run/phases')).map((f) => `skills/run/phases/${f}`)];
  for (const f of files) {
    for (const m of read(f).matchAll(/`mis ([a-z-]+)/g)) {
      assert.ok(commands[m[1]], `${f}: unknown mis command "${m[1]}"`);
    }
  }
});

test('phases name the source features they absorb (Spec §14.2)', () => {
  const expect = {
    discover: [/deepinit|explore/i, /health/i], interview: [/deep-interview/i, /office-hours/i, /brainstorming/i],
    plan: [/writing-plans/i, /planner/i], 'plan-critique': [/ralplan|critic/i, /autoplan/i],
    implement: [/test-driven-development/i, /executor/i], verify: [/verification-before-completion/i, /verifier/i],
    review: [/requesting-code-review/i, /ponytail-review/i, /cso|security-reviewer/i],
  };
  for (const [p, res] of Object.entries(expect)) {
    const text = read(`skills/run/phases/${p}.md`);
    for (const re of res) assert.match(text, re, `${p} cites ${re}`);
  }
});

test('the run skill forbids the model from deciding the verdict and from touching run state', () => {
  const run = read('skills/run/SKILL.md');
  assert.match(run, /mis verdict/);
  assert.match(run, /\.git\/make-it-ship/);
});
