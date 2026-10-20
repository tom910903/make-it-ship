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
const SKILLS = ['run', 'status', 'interview', 'plan-review', 'review', 'resume', 'debug', 'qa', 'ship', 'retro', 'browse', 'team', 'session'];

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
  assert.doesNotMatch(qa, /bsp/i);
  assert.match(read('skills/run/phases/ship.md'), /mis ios bridge-scan/);
  const readme = read('README.md');
  assert.doesNotMatch(readme, /BSP/);
  for (const re of [/mis bench/, /mis learn/, /second opinion/i, /ios-debug-bridge/, /adapters\/codex/]) assert.match(readme, re);
  for (const m of read('adapters/codex/AGENTS.md').matchAll(/agents\/([a-z-]+)\.md/g)) assert.ok(existsSync(join(ROOT, `agents/${m[1]}.md`)), m[0]);
  assert.match(read('adapters/codex/AGENTS.md'), /spec-reviewer/);
});

test('M6 always-on layer is wired: hooks for every event, skills, notices, README', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
  for (const ev of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'Stop', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'SessionEnd']) {
    const cmd = hooks[ev]?.[0]?.hooks?.[0]?.command ?? '';
    assert.match(cmd, new RegExp(`scripts/hooks\\.mjs" ${ev}$`), ev);
  }
  for (const s of ['loop', 'style', 'cancel']) assert.match(read(`skills/${s}/SKILL.md`), new RegExp(`^---\\nname: ${s}\\n`));
  const notices = read('THIRD_PARTY_NOTICES.md');
  for (const p of ['oh-my-claudecode', 'Superpowers', 'Ponytail', 'gstack']) assert.match(notices, new RegExp(p));
  const readme = read('README.md');
  assert.match(readme, /## Always on/);
  assert.match(readme, /asked about \*\*at any time\*\*/);
});

test('M8-A: web QA uses the built-in browser (report-only, design loop, page benchmark) and the browse skill documents the guard', () => {
  const qa = read('skills/run/phases/qa.md');
  for (const re of [/skills\/browse\/SKILL\.md/, /mis browse perf/, /mis visual-verdict/, /Report-only/i, /\$MIS_CLI/, /handoff/]) assert.match(qa, re);
  assert.doesNotMatch(qa, /BLOCKED reason \(e\.g\. no Playwright/);
  const b = read('skills/browse/SKILL.md');
  for (const re of [/snapshot -i/, /stale ref/, /--remote/, /mis browse cdp/, /mis browse resume/, /mis pdf/, /BLOCKED/]) assert.match(b, re);
  assert.match(read('skills/qa/SKILL.md'), /report only|qa-only/i);
});

test('M8-B: team pipeline, session manager and visual companion are wired into skills, phases and README', () => {
  const team = read('skills/team/SKILL.md');
  for (const re of [/mis team start/, /mis team wait/, /mis team shutdown/, /mis check/, /mis verdict/, /Agent tool/, /plan.*exec.*verify.*fix/is, /mis task <id> retry/, /only when (the user )?explicitly/i, /omc-teams/])
    assert.match(team, re);
  const session = read('skills/session/SKILL.md');
  assert.match(frontmatter(session).description, /psm/);
  for (const re of [/mis session create/, /mis session list/, /mis session remove/, /approv/i]) assert.match(session, re);
  for (const p of ['design-explore', 'interview', 'design']) assert.match(read(`skills/run/phases/${p}.md`), /mis companion start/, p);
  assert.match(read('skills/run/phases/parallel.md'), /skills\/team|\/make-it-ship:team/);
  const readme = read('README.md');
  assert.match(readme, /## Teams and sessions/);
  for (const re of [/mis team/, /mis session/, /mis companion/]) assert.match(readme, re);
});

test('M8 D3: the design review loop and the browse skill make the model look at both images; the pixel score alone never ends it', () => {
  for (const f of ['skills/run/phases/qa.md', 'skills/browse/SKILL.md']) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    assert.match(t, /Read both images/, f);
    assert.match(t, /only an aid/, f);
    assert.doesNotMatch(t, /\(90\+ passes\)/, f);
  }
});

test('M8 D12/D5: every skill that defines the `mis` shorthand gives a function that works in zsh and that the guard sees through', async () => {
  const { classify } = await import('../../scripts/lib/policy.mjs');
  const { spawnSync } = await import('node:child_process');
  const FN = 'mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }';
  const files = readdirSync(join(ROOT, 'skills')).map((s) => `skills/${s}/SKILL.md`).filter((f) => existsSync(join(ROOT, f)))
    .filter((f) => /`mis`( <args>)? (=|means)/.test(read(f)) || /where `mis` =/.test(read(f)));
  assert.ok(files.includes('skills/browse/SKILL.md'));
  for (const f of files) {
    assert.ok(read(f).includes(FN), `${f} defines mis as the function`);
    assert.doesNotMatch(read(f), /`mis`( <args>)? (=|means) `node /, `${f}: no plain-text alias that invites M="node …"; $M`);
  }
  const d = classify({ tool_name: 'Bash', tool_input: { command: `${FN}; mis browse cdp X.y` }, cwd: ROOT }, { repoRoot: ROOT, activeRun: false }).decision;
  assert.equal(d, 'ask');
  // M8 R2-6: agents too: no plain-text `node …` alias for mis (it invites M="node …"; $M, which fails in zsh)
  for (const f of readdirSync(join(ROOT, 'agents')).map((a) => `agents/${a}`)) {
    assert.doesNotMatch(read(f), /`mis`( <args>)? (=|means)[^\n]*`node /, `${f}: mis is the shell function, not a node alias`);
    if (/`mis`( <args>)? (=|means)/.test(read(f))) assert.ok(read(f).includes('mis() {'), `${f} defines mis as the function`);
  }
  const zsh = ['/bin/zsh', '/usr/bin/zsh'].find(existsSync);
  if (!zsh) return; // no zsh on this machine: the bash form is what runs
  const r = spawnSync(zsh, ['-fc', `${FN}; mis browse help`], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /usage: mis browse/);
});
