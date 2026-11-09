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

const AGENTS = ['explorer', 'critic', 'spec-reviewer', 'quality-reviewer', 'security-reviewer', 'architect', 'product-reviewer', 'qa-tester', 'analyst', 'planner', 'tracer'];
const REVIEWERS = ['critic', 'spec-reviewer', 'quality-reviewer', 'security-reviewer', 'product-reviewer'];
const PHASES = ['discover', 'interview', 'product-review', 'design', 'design-explore', 'plan', 'plan-critique', 'parallel', 'implement', 'debug', 'verify', 'review', 'simplify', 'qa', 'ship', 'retro'];
const SKILLS = ['run', 'plan', 'status', 'interview', 'brainstorm', 'plan-review', 'review', 'resume', 'debug', 'qa', 'ship', 'retro', 'browse', 'team', 'session', 'skill', 'skillify', 'writing-skills', 'setup', 'cancel',
  'ask', 'research', 'writer-memory', 'deploy', 'ops', 'ios', 'android', 'telemetry', 'gbrain', 'design-images', 'pair-agent', 'help', 'reference'];

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
  // brainstorming on its own, its design handed on as a deck (user decision 2026-11-10)
  assert.match(read('skills/brainstorm/SKILL.md'), /phases\/interview\.md[\s\S]*brainstorming/);
  assert.match(read('skills/run/phases/interview.md'), /\*\*brainstorming\*\*[^\n]*<slug>-design-slides\.md[^\n]*mis slides/);
  assert.match(read('skills/plan-review/SKILL.md'), /phases\/plan-critique\.md/);
  assert.match(read('skills/review/SKILL.md'), /phases\/review\.md/);
  assert.match(read('skills/debug/SKILL.md'), /phases\/debug\.md/);
  assert.match(read('skills/qa/SKILL.md'), /phases\/qa\.md/);
  assert.match(read('skills/ship/SKILL.md'), /phases\/ship\.md/);
  assert.match(read('skills/retro/SKILL.md'), /phases\/retro\.md/);
});

test('every `mis <command>` mentioned in skills and phases exists', () => {
  const files = [...SKILLS.map((s) => `skills/${s}/SKILL.md`), ...readdirSync(join(ROOT, 'agents')).map((f) => `agents/${f}`), ...readdirSync(join(ROOT, 'skills/run/phases')).map((f) => `skills/run/phases/${f}`)];
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

test('the repository is its own marketplace: the root plugin is listed under the plugin.json name', () => {
  const m = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(m.name, 'make-it-ship');
  assert.ok(m.owner?.name);
  assert.deepEqual(m.plugins.map((p) => [p.name, p.source]), [[JSON.parse(read('.claude-plugin/plugin.json')).name, '.']]);
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

// M9-C C1: the OMC agents that were missing, each with the narrowest tool allowlist for its role.
const M9C_AGENTS = {
  analyst: 'Read, Grep, Glob, Bash', planner: 'Read, Grep, Glob, Bash', tracer: 'Read, Grep, Glob, Bash',
  'document-specialist': 'Read, Grep, Glob, Bash, WebFetch, WebSearch', 'git-master': 'Read, Grep, Glob, Bash',
  executor: 'Read, Write, Edit, Grep, Glob, Bash', debugger: 'Read, Write, Edit, Grep, Glob, Bash', designer: 'Read, Write, Edit, Grep, Glob, Bash',
  'test-engineer': 'Read, Write, Edit, Grep, Glob, Bash', 'code-simplifier': 'Read, Write, Edit, Grep, Glob, Bash', writer: 'Read, Write, Edit, Grep, Glob, Bash',
};
for (const [a, tools] of Object.entries(M9C_AGENTS)) {
  test(`M9-C agent ${a}: allowlist, evidence rule, no push, no run state`, () => {
    const text = read(`agents/${a}.md`);
    const fm = frontmatter(text);
    assert.equal(fm.name, a);
    assert.ok(fm.description.length > 40);
    assert.equal(fm.tools, tools);
    assert.doesNotMatch(fm.tools, /\bAgent\b|mcp__/, 'no nested agents, no MCP');
    if (['analyst', 'planner', 'tracer', 'document-specialist'].includes(a)) assert.doesNotMatch(fm.tools, /Write|Edit/, 'read-only role');
    assert.match(text, /untrusted/i);
    assert.match(text, /mis check/);
    assert.match(text, /never say done, fixed, or passing without the real output/i);
    assert.match(text, /never `git push`|Never `git push`/);
    assert.match(text, /\.git\/make-it-ship\//);
    assert.match(text, new RegExp(`absorbed from OMC ${a}`));
  });
}

test('M9-C role specifics: executor defers to implementer in runs, debugger uses the root-cause gate, document-specialist keeps code out of queries, git-master never rewrites shared history', () => {
  assert.match(read('agents/executor.md'), /`implementer` agent/);
  assert.match(read('agents/debugger.md'), /mis note rootcause/);
  assert.match(read('agents/debugger.md'), /three failed hypotheses.*BLOCKED/s);
  assert.match(read('agents/document-specialist.md'), /Never put repository code.*into a search query/);
  assert.match(read('agents/git-master.md'), /never rewrite commits that exist on a remote/i);
});

test('M9-C C2: qa-tester drives interactive programs with mis tty and leaves only the replay script', () => {
  const t = read('agents/qa-tester.md');
  for (const re of [/mis tty start/, /mis tty expect/, /mis tty send/, /mis tty save <name> qa\//, /mis tty stop/, /BLOCKED if tmux is missing/]) assert.match(t, re);
  assert.match(read('skills/run/phases/qa.md'), /mis tty/);
});

test('M9-C C3: skill authoring skills write only learned-skill locations and test with subagents', () => {
  const skill = read('skills/skill/SKILL.md');
  for (const re of [/mis skill list/, /mis skill search/, /mis skill add/, /mis skill edit/, /mis skill remove/, /mis skill lint/, /read-only/, /triggers: \[/]) assert.match(skill, re);
  const skillify = read('skills/skillify/SKILL.md');
  assert.match(frontmatter(skillify).description, /learner/);
  for (const re of [/mis skill add - --scope/, /mis test-prompt/, /Never write a skill into the plugin/]) assert.match(skillify, re);
  const ws = read('skills/writing-skills/SKILL.md');
  for (const re of [/RED/, /GREEN/, /mis skill test/, /MIS_SKILL_TEST_CMD/, /mis skill lint/, /mis skill graphs/, /Agent tool/, /never launch real claude/]) assert.match(ws, re);
  const readme = read('README.md');
  assert.match(readme, /## Skill authoring/);
  for (const a of Object.keys(M9C_AGENTS)) assert.match(readme, new RegExp(`\`${a}\``), `README lists ${a}`);
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

// M9-B (B0 decision): planning/review/design/doc/audit/release/memory features live in the phase where they apply,
// with a trigger, and are reachable from existing skills; only `plan` is a new skill.
test('M9-B features are blended into phases with triggers, artifact paths and real mis commands', () => {
  const ph = (p) => read(`skills/run/phases/${p}.md`);
  const expect = {
    discover: [/deepinit_manifest/, /action: "save"/, /document-specialist/, /mis health/],
    interview: [/docs\/make-it-ship\/traces\/<slug>\.md/, /docs\/make-it-ship\/specs\/<slug>\.md/, /office-hours/, /\*Startup\*/, /\*Builder\*/, /mis profile/, /mis question log/, /"qid"/, /HIGH items are always asked/, /no code changes/],
    plan: [/docs\/make-it-ship\/plans\/<slug>\.md/, /mis plan check/, /mis start --plan/, /mis goal add/, /\/goal/],
    'product-review': [/## Review: CEO/, /## Review: DX/, /plan-eng-review/, /six decision principles/, /mis decision add/, /Taste decisions/],
    design: [/mis diagram/, /\.excalidraw/, /mis browse screenshot/, /mis decision search/],
    'design-explore': [/mis taste show/, /mis design-board/, /data-choice/, /mis taste approve/, /design-html/, /Outside a run/],
    implement: [/subagent-driven-development/, /spec-reviewer.*then.*quality-reviewer/s],
    debug: [/make-it-ship:tracer/, /same message/, /docs\/make-it-ship\/traces\/<slug>\.md/],
    simplify: [/mis debt/, /review-only|Review-only/, /change nothing/],
    review: [/ponytail-audit/, /cso/, /devex-review/, /mis redact scan --history/, /write no files/],
    verify: [/mis health/],
    ship: [/mis version-bump/, /mis next-version/, /mis diff-scope/, /mis repo-mode/, /release-rules\.md/, /mis redact scan/, /document-generate/, /without a run/],
    retro: [/mis retro --git --since 7d/, /hit rate/, /mis learn search/, /mis learn distill/, /--yes/, /mis decision supersede/, /mis jsonl-merge install/],
    parallel: [/baseline/],
  };
  for (const [p, res] of Object.entries(expect)) for (const re of res) assert.match(ph(p), re, `${p}: ${re}`);
  const plan = read('skills/plan/SKILL.md');
  for (const re of [/docs\/make-it-ship\/plans\/<slug>\.md/, /mis plan check/, /mis start --plan/, /No run is started/]) assert.match(plan, re);
  assert.match(read('skills/loop/SKILL.md'), /Ralphthon[\s\S]*Interview[\s\S]*Loop[\s\S]*Harden/);
  for (const re of [/mis context save/, /mis context restore/, /branch mismatch/, /mis context sessions/]) assert.match(read('skills/resume/SKILL.md'), re);
  for (const [s, re] of [['plan-review', /autoplan/], ['review', /cso/], ['interview', /office hours/i], ['ship', /without a run/], ['retro', /decision/], ['status', /mis health/], ['session', /baseline/]]) assert.match(read(`skills/${s}/SKILL.md`), re, s);
  // every agent a phase dispatches exists
  for (const f of readdirSync(join(ROOT, 'skills/run/phases'))) for (const m of read(`skills/run/phases/${f}`).matchAll(/make-it-ship:([a-z][a-z-]*)/g)) {
    if (['run', 'plan', 'plan-review', 'review', 'interview', 'debug', 'qa', 'ship', 'retro', 'resume', 'team', 'session', 'loop', 'status'].includes(m[1])) continue;
    assert.ok(existsSync(join(ROOT, `agents/${m[1]}.md`)), `${f}: agent ${m[1]}`);
  }
  const run = read('skills/run/SKILL.md');
  assert.match(run, /Situational steps/);
  assert.match(run, /Partial requests/);
  assert.match(read('README.md'), /## Planning, review, design, docs and release inside the flow/);
});

test('M9-D: external-transfer skills say company policy may forbid it; the scientist agent is read-only with python_repl', () => {
  for (const s of ['ask', 'ios', 'android', 'telemetry', 'gbrain', 'design-images', 'pair-agent']) assert.match(read(`skills/${s}/SKILL.md`), /company policy may forbid/i, s);
  for (const [s, re] of [['research', /mis approve proposal/], ['research', /ONE message/], ['deploy', /mis canary/], ['telemetry', /off by default/i], ['gbrain', /BLOCKED/], ['ios', /BLOCKED/], ['android', /BLOCKED/]]) assert.match(read(`skills/${s}/SKILL.md`), re, s);
  const sci = read('agents/scientist.md'), fm = frontmatter(sci);
  assert.equal(fm.tools, 'Read, Grep, Glob, Bash, mcp__plugin_make-it-ship_mis__python_repl');
  for (const re of [/untrusted/i, /\[FINDING:/, /\[EVIDENCE:/, /\[CONFIDENCE:/, /Do not modify/, /\.git\/make-it-ship\//]) assert.match(sci, re);
});

// User decision 2026-10-22: project layout; AI docs in .ai/ (English), human docs in docs/ in every language.
test('layout: the run flow reads .ai/, plans follow the layout, writer and review keep both doc kinds right', () => {
  const ph = (p) => read(`skills/run/phases/${p}.md`);
  for (const re of [/AGENTS\.md/, /\.ai\/index\.md/, /\.ai\/structure\.md/, /\.ai\/modules\//, /mis layout/]) assert.match(ph('discover'), re, `discover: ${re}`);
  for (const re of [/layout/, /mis layout/, /\.ko\.md/, /mis approve config/]) assert.match(ph('plan'), re, `plan: ${re}`);
  for (const re of [/\.ai\//, /\.ko\.md|every language/]) assert.match(ph('review'), re, `review: ${re}`);
  for (const re of [/\.ai\//, /English/, /\.ko\.md/, /separate files/, /decisions\.md/, /tech\.md/]) assert.match(read('agents/writer.md'), re, `writer: ${re}`);
  assert.match(read('skills/setup/SKILL.md'), /mis layout write/);
});
