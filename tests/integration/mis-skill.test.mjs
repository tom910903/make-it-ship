// M9-C: learned-skill management and authoring (mis skill). Every call uses a temp MIS_STATE_HOME; never the real home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync, chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT } from '../helpers.mjs';
import { learnedSkills } from '../../scripts/lib/keywords.mjs';
import { lintSkill, skillTestArgv, dotBlocks } from '../../scripts/lib/skills.mjs';

const FAKE = join(ROOT, 'tests', 'fixtures', 'fake-skill-agent.mjs');
const setup = () => {
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  return { dir: makeRepo(), home, env: { MIS_STATE_HOME: home, MIS_SKILL_TEST_CMD: `"${process.execPath}" "${FAKE}"` } };
};
const skill = (name, { triggers = '[flaky retry, "retry storm"]', desc = 'Use when a test fails only under load.', body = '# Flaky retries\n\nReproduce under load first.\n' } = {}) =>
  `---\nname: ${name}\ndescription: ${desc}\n${triggers === null ? '' : `triggers: ${triggers}\n`}---\n\n${body}`;
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const pluginSkills = () => readdirSync(join(ROOT, 'skills'), { recursive: true }).sort().map((f) => `${f}:${statSync(join(ROOT, 'skills', f)).mtimeMs}`).join('\n');

test('add (project scope, stdin) writes .make-it-ship/skills/<name>/SKILL.md and its triggers match learnedSkills', () => {
  const { dir, home, env } = setup();
  const before = pluginSkills();
  const r = ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('flaky-retries') }));
  const path = join(dir, '.make-it-ship', 'skills', 'flaky-retries', 'SKILL.md');
  assert.equal(r.path, path);
  assert.equal(readFileSync(path, 'utf8'), skill('flaky-retries'));
  assert.deepEqual(learnedSkills('why is there a RETRY STORM in CI?', dir, home).map((s) => s.name), ['flaky-retries']);
  assert.deepEqual(learnedSkills('unrelated prompt', dir, home), []);
  assert.equal(pluginSkills(), before, 'the plugin skills/ directory is never written');
});

test('add --scope user writes under MIS_STATE_HOME/skills (the ~/.make-it-ship/skills location), from a file', () => {
  const { dir, home, env } = setup();
  writeFileSync(join(dir, 'draft.md'), skill('db-migrations', { triggers: '[migration]' }));
  const r = ok(mis(dir, ['skill', 'add', 'draft.md', '--scope', 'user'], { env }));
  assert.equal(r.path, join(home, 'skills', 'db-migrations', 'SKILL.md'));
  assert.deepEqual(learnedSkills('write a migration', null, home).map((s) => s.name), ['db-migrations']);
  assert.match(mis(dir, ['skill', 'add', 'draft.md', '--scope', 'plugin'], { env }).err, /--scope must be project or user/);
});

test('add lints first and writes nothing for an invalid skill; an existing skill is not overwritten', () => {
  const { dir, env } = setup();
  for (const [text, re] of [
    [skill('../escape'), /name must be kebab-case/],
    [skill('blocky', { triggers: '\n  - flaky' }), /triggers must be one line/],
    [skill('no-triggers', { triggers: null }), /triggers missing/],
    [skill('short', { triggers: '[ab]' }), /trigger "ab" is too short/],
    [skill('todo', { body: '# T\n\nTODO: write this\n' }), /placeholder/],
    [skill('empty', { body: '' }), /body is empty/],
  ]) {
    const r = mis(dir, ['skill', 'add', '-'], { env, input: text });
    assert.equal(r.code, 1, text);
    assert.match(r.err, re);
  }
  assert.ok(!existsSync(join(dir, '.make-it-ship')), 'nothing written');
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('dup') }));
  assert.match(mis(dir, ['skill', 'add', '-'], { env, input: skill('dup', { desc: 'Use when other.' }) }).err, /already exists.*mis skill edit/);
});

test('lint: warnings do not fail, errors do; lint with no name checks every learned skill', () => {
  assert.deepEqual(lintSkill(skill('good'), 'good'), { errors: [], warnings: [] });
  assert.match(lintSkill(skill('good', { desc: 'Retries things.' }), 'good').warnings.join(), /start with "Use when"/);
  assert.match(lintSkill(skill('good'), 'other').errors.join(), /does not match its directory/);
  assert.match(lintSkill('no frontmatter', 'x').errors.join(), /frontmatter/);
  const { dir, env } = setup();
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('a-skill') }));
  assert.deepEqual(ok(mis(dir, ['skill', 'lint'], { env })).skills.map((s) => [s.name, s.errors.length]), [['a-skill', 0]]);
  writeFileSync(join(dir, '.make-it-ship', 'skills', 'a-skill', 'SKILL.md'), skill('a-skill', { triggers: null }));
  const r = mis(dir, ['skill', 'lint', 'a-skill'], { env });
  assert.equal(r.code, 1);
  assert.match(r.out, /triggers missing/);
});

test('list and search cover project, user and plugin skills', () => {
  const { dir, env } = setup();
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('proj-one') }));
  ok(mis(dir, ['skill', 'add', '-', '--scope', 'user'], { env, input: skill('user-one', { triggers: '[deploy freeze]', body: '# U\n\nCheck the zebra-quokka dashboard.\n' }) }));
  const list = ok(mis(dir, ['skill', 'list'], { env })).skills;
  assert.deepEqual(list.filter((s) => s.scope !== 'plugin').map((s) => `${s.scope}:${s.name}`), ['project:proj-one', 'user:user-one']);
  assert.ok(list.some((s) => s.scope === 'plugin' && s.name === 'run'));
  assert.deepEqual(ok(mis(dir, ['skill', 'search', 'zebra-quokka'], { env })).skills.map((s) => s.name), ['user-one'], 'body text');
  assert.deepEqual(ok(mis(dir, ['skill', 'search', 'retry storm'], { env })).skills.map((s) => s.name), ['proj-one'], 'triggers');
});

test('edit replaces after lint, prints the path without content; edit/remove refuse plugin skills and bad names', () => {
  const { dir, env } = setup();
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('editme') }));
  const path = join(dir, '.make-it-ship', 'skills', 'editme', 'SKILL.md');
  assert.equal(ok(mis(dir, ['skill', 'edit', 'editme'], { env })).path, path);
  assert.equal(mis(dir, ['skill', 'edit', 'editme', '-'], { env, input: skill('editme', { triggers: null }) }).code, 1);
  assert.equal(readFileSync(path, 'utf8'), skill('editme'), 'invalid edit leaves the file alone');
  ok(mis(dir, ['skill', 'edit', 'editme', '-'], { env, input: skill('editme', { triggers: '[new trigger]' }) }));
  assert.match(readFileSync(path, 'utf8'), /new trigger/);
  assert.match(mis(dir, ['skill', 'edit', 'editme', '-'], { env, input: skill('renamed') }).err, /does not match its directory/);
  const before = pluginSkills();
  assert.match(mis(dir, ['skill', 'edit', 'run'], { env }).err, /plugin skill.*read-only/);
  assert.match(mis(dir, ['skill', 'remove', 'run'], { env }).err, /plugin skill.*read-only/);
  assert.match(mis(dir, ['skill', 'remove', '../..'], { env }).err, /kebab-case/);
  assert.equal(pluginSkills(), before);
  ok(mis(dir, ['skill', 'remove', 'editme'], { env }));
  assert.ok(!existsSync(join(dir, '.make-it-ship', 'skills', 'editme')));
  assert.match(mis(dir, ['skill', 'remove', 'editme'], { env }).err, /no project skill "editme"/);
});

test('test: baseline (no skill) is RED, with the skill GREEN, via an injected agent command (never real claude)', () => {
  const { dir, env } = setup();
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('pick-a', { body: '# Pick A\n\nALWAYS-PICK-A even when time is short.\n' }) }));
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ name: 'time pressure', prompt: 'Deadline in 5 minutes. Choose OPTION A, B or C.', expect: ['OPTION A'], forbid: ['OPTION C'] }));
  const r = ok(mis(dir, ['skill', 'test', 'pick-a', 'scenario.json'], { env }));
  assert.equal(r.status, 'GREEN');
  assert.equal(r.scenarios[0].baseline.pass, false, 'RED: the agent fails without the skill');
  assert.equal(r.scenarios[0].withSkill.pass, true);
  assert.match(r.scenarios[0].baseline.output, /OPTION C/);
  // a scenario the skill does not fix fails the command
  writeFileSync(join(dir, 'bad.json'), JSON.stringify([{ prompt: 'Choose.', expect: ['OPTION B'] }]));
  const bad = mis(dir, ['skill', 'test', 'pick-a', 'bad.json'], { env });
  assert.equal(bad.code, 1);
  assert.equal(bad.json.status, 'FAIL');
  // a scenario that already passes without the skill proves nothing
  writeFileSync(join(dir, 'weak.json'), JSON.stringify([{ prompt: 'Choose.', expect: ['OPTION'] }]));
  assert.equal(ok(mis(dir, ['skill', 'test', 'pick-a', 'weak.json'], { env })).status, 'NO_RED');
  assert.match(mis(dir, ['skill', 'test', 'pick-a', 'scenario.json'], { env: { ...env, MIS_SKILL_TEST_CMD: 'exit 3' } }).err, /agent command failed/);
});

test('test: the default agent is claude in print mode with customizations off and read-only tools', () => {
  const argv = skillTestArgv();
  assert.equal(argv[0], 'claude');
  for (const f of ['-p', '--safe-mode']) assert.ok(argv.includes(f), f);
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
});

test('graphs: extracts ```dot blocks and renders SVG next to the skill; BLOCKED without graphviz', () => {
  assert.deepEqual(dotBlocks('x\n```dot\ndigraph flow { a -> b }\n```\n```dot\ngraph { c }\n```\n').map((b) => b.name), ['flow', 'graph_2']);
  const { dir, env } = setup();
  ok(mis(dir, ['skill', 'add', '-'], { env, input: skill('drawn', { body: '# D\n\n```dot\ndigraph flow { a -> b }\n```\n' }) }));
  const bin = mkdtempSync(join(tmpdir(), 'mis-bin-'));
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  assert.match(mis(dir, ['skill', 'graphs', 'drawn'], { env: { ...env, PATH: bin } }).err, /BLOCKED: graphviz/);
  writeFileSync(join(bin, 'dot'), '#!/bin/sh\necho "<svg>$(cat)</svg>"\n');
  chmodSync(join(bin, 'dot'), 0o755);
  const r = ok(mis(dir, ['skill', 'graphs', 'drawn'], { env: { ...env, PATH: `${bin}:${process.env.PATH}` } }));
  assert.equal(r.files.length, 1);
  assert.match(readFileSync(r.files[0], 'utf8'), /<svg>digraph flow/);
  assert.ok(r.files[0].startsWith(join(dir, '.make-it-ship', 'skills', 'drawn')));
});
