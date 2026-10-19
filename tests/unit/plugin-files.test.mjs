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

const AGENTS = ['explorer', 'critic', 'spec-reviewer', 'quality-reviewer', 'security-reviewer', 'architect', 'product-reviewer', 'qa-tester'];
const REVIEWERS = ['critic', 'spec-reviewer', 'quality-reviewer', 'security-reviewer', 'product-reviewer'];
const PHASES = ['discover', 'interview', 'product-review', 'design', 'design-explore', 'plan', 'plan-critique', 'parallel', 'implement', 'debug', 'verify', 'review', 'simplify', 'qa', 'ship', 'retro'];
const SKILLS = ['run', 'status', 'interview', 'plan-review', 'review', 'resume', 'debug', 'qa', 'ship', 'retro'];

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
  assert.match(read('skills/debug/SKILL.md'), /phases\/debug\.md/);
  assert.match(read('skills/qa/SKILL.md'), /phases\/qa\.md/);
  assert.match(read('skills/ship/SKILL.md'), /phases\/ship\.md/);
  assert.match(read('skills/retro/SKILL.md'), /phases\/retro\.md/);
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
    'product-review': [/plan-ceo-review/i, /plan-design-review/i, /plan-devex-review/i], design: [/architect/i, /plan-eng-review/i, /diagram/i],
    'design-explore': [/design-consultation/i, /design-shotgun/i, /design-html/i, /designer/i], parallel: [/ultrawork|team/i, /dispatching-parallel-agents/i, /using-git-worktrees/i],
    qa: [/gstack qa|\bqa-only/i, /browse/i, /benchmark/i, /ios-qa/i, /qa-tester/i, /visual-verdict/i],
    ship: [/document-release/i, /document-generate/i, /finishing-a-development-branch/i, /merge-readiness/i, /git-master/i],
    retro: [/gstack retro|\bretro\b/i, /\blearn\b/i, /learner|skillify/i, /writing-skills/i],
    debug: [/systematic-debugging/i, /investigate/i, /tracer|trace/i], simplify: [/ponytail-debt/i, /ai-slop-cleaner/i, /code-simplifier/i],
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

test('security reviewer covers OWASP, secrets, dependencies and exploit scenarios', () => {
  const t = read('agents/security-reviewer.md');
  for (const re of [/OWASP/, /secret/i, /dependenc/i, /exploit/i, /file:line/]) assert.match(t, re);
});

test('debug phase enforces the root-cause gate through mis', () => {
  const t = read('skills/run/phases/debug.md');
  assert.match(t, /mis note rootcause/);
  assert.match(t, /mis task <id> retry/);
  assert.match(t, /REPRODUCTION:/);
});

test('implementer agent: may write but has no Agent tool and no MCP (allowlist)', () => {
  const fm = frontmatter(read('agents/implementer.md'));
  assert.equal(fm.name, 'implementer');
  assert.equal(fm.tools, 'Read, Write, Edit, Grep, Glob, Bash');
  assert.match(read('agents/implementer.md'), /untrusted/i);
});

test('ship phase never pushes on its own and the qa phase reports BLOCKED instead of faking results', () => {
  assert.match(read('skills/run/phases/ship.md'), /mis ship/);
  assert.match(read('skills/run/phases/ship.md'), /approv/i);
  assert.match(read('skills/run/phases/qa.md'), /mis qa detect/);
  assert.match(read('skills/run/phases/qa.md'), /BLOCKED/);
});

test('Codex adapter: mis-based flow, honest about missing guard hooks, only real mis commands', () => {
  const t = read('adapters/codex/AGENTS.md');
  assert.match(t, /no PreToolUse|guard hooks? (do|does) not run|not enforced/i);
  assert.match(t, /mis approve plan/);
  for (const m of t.matchAll(/`mis ([a-z-]+)/g)) assert.ok(commands[m[1]], `unknown mis command ${m[1]}`);
  for (const m of t.matchAll(/skills\/run\/phases\/([a-z-]+)\.md/g)) assert.ok(existsSync(join(ROOT, `skills/run/phases/${m[1]}.md`)), m[0]);
});

test('ship file edits happen before verify; after the report only drafts and branch finishing (M4 D1)', () => {
  const run = read('skills/run/SKILL.md');
  assert.ok(run.indexOf('ship, part A') < run.indexOf('**verify**'), 'part A is listed before verify');
  assert.match(read('skills/run/phases/ship.md'), /Part B — after the report.*no more file edits/s);
  assert.match(read('skills/run/phases/ship.md'), /follow-up run/);
});

test('M5 features are reachable from the flow and docs (M5 D-2, L-2, L-6)', () => {
  const qa = read('skills/run/phases/qa.md');
  assert.match(qa, /mis ios devices/);
  assert.match(qa, /ios-debug-bridge/);
  assert.match(qa, /bsp/);
  assert.match(read('skills/run/phases/ship.md'), /mis ios bridge-scan/);
  const readme = read('README.md');
  for (const re of [/mis bench/, /mis learn/, /BSP|bsp/, /second opinion/i, /ios-debug-bridge/, /adapters\/codex/]) assert.match(readme, re);
  for (const m of read('adapters/codex/AGENTS.md').matchAll(/agents\/([a-z-]+)\.md/g)) assert.ok(existsSync(join(ROOT, `agents/${m[1]}.md`)), m[0]);
  assert.match(read('adapters/codex/AGENTS.md'), /spec-reviewer/);
});
