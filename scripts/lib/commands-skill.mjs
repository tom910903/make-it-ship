// mis skill (M9-C): manage and author learned skills in .make-it-ship/skills (project) or ~/.make-it-ship/skills (user).
// Never writes the plugin's own skills/. `mis skill test` runs a scenario through a subagent with and without the skill.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { repoRoot } from './tree-hash.mjs';
import { NAME_RE, PLUGIN_SKILLS, skillBase, scanSkills, lintSkill, parseSkill, skillTestArgv, dotBlocks } from './skills.mjs';

const fail = (msg) => { throw new Error(msg); };
const USAGE = 'usage: mis skill list | search <text> | add <file|-> [--scope project|user] | edit <name> [<file|->] | remove <name> | lint [<name>] | test <name> <scenario.json> | graphs <name>  (edit/remove/lint/test/graphs take --scope too)';
// The lead's Claude Code session vars must not leak into the test subagent (same rule as team workers).
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_CODE_(SESSION_ID|ENTRYPOINT|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+|EXECPATH)|CLAUDE_PID|CMUX_CLAUDE_PID)$/;

function scopeOf(args) {
  const i = args.indexOf('--scope');
  if (i < 0) return 'project';
  const v = args.splice(i, 2)[1];
  if (v !== 'project' && v !== 'user') fail('--scope must be project or user');
  return v;
}
const rootOf = (cwd) => { try { return repoRoot(cwd); } catch { return cwd; } };
const readText = (cwd, arg) => (arg === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(cwd, arg), 'utf8'));

/** Path of an existing learned skill; refuses names that are not kebab-case and plugin-only skills. */
function locate(name, scope, cwd) {
  if (!NAME_RE.test(name ?? '')) fail('skill name must be kebab-case');
  const base = skillBase(scope, rootOf(cwd));
  const dir = resolve(base, name);
  if (!dir.startsWith(base + sep)) fail('skill path escapes its base directory');
  if (!existsSync(join(dir, 'SKILL.md'))) {
    if (existsSync(join(PLUGIN_SKILLS, name, 'SKILL.md'))) fail(`"${name}" is a plugin skill; plugin skills are read-only (copy it with mis skill add to customize)`);
    fail(`no ${scope} skill "${name}"`);
  }
  return { dir, path: join(dir, 'SKILL.md') };
}

function checked(text, dirName) {
  const { errors, warnings } = lintSkill(text, dirName);
  if (errors.length) fail(`skill invalid: ${errors.join('; ')}`);
  return warnings;
}

const all = (cwd) => [...scanSkills(skillBase('project', rootOf(cwd)), 'project'), ...scanSkills(skillBase('user'), 'user'), ...scanSkills(PLUGIN_SKILLS, 'plugin')];

function add(args, cwd) {
  const scope = scopeOf(args);
  if (!args[0]) fail(USAGE);
  const text = readText(cwd, args[0]);
  const name = parseSkill(text)?.name;
  const warnings = checked(text, name);
  const base = skillBase(scope, rootOf(cwd)), path = join(base, name, 'SKILL.md');
  if (existsSync(path)) fail(`${scope} skill "${name}" already exists; change it with mis skill edit ${name} <file|->`);
  mkdirSync(join(base, name), { recursive: true });
  writeFileSync(path, text);
  return { name, scope, path, warnings };
}

function edit(args, cwd) {
  const scope = scopeOf(args);
  const { path } = locate(args[0], scope, cwd);
  if (!args[1]) return { path, note: 'Edit the file, then run mis skill lint ' + args[0] };
  const text = readText(cwd, args[1]);
  const warnings = checked(text, args[0]);
  writeFileSync(path, text);
  return { name: args[0], scope, path, warnings };
}

function remove(args, cwd) {
  const scope = scopeOf(args);
  const { dir } = locate(args[0], scope, cwd);
  rmSync(dir, { recursive: true, force: true });
  return { removed: args[0], scope, dir };
}

function lint(args, cwd) {
  const scope = scopeOf(args);
  const targets = args[0] ? [{ name: args[0], scope, path: locate(args[0], scope, cwd).path }] : all(cwd).filter((s) => s.scope !== 'plugin');
  const skills = targets.map((s) => ({ name: s.name, scope: s.scope, path: s.path, ...lintSkill(readFileSync(s.path, 'utf8'), s.path.split(sep).at(-2)) }));
  const out = { ok: skills.every((s) => !s.errors.length), skills };
  if (!out.ok) { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return undefined; }
  return out;
}

function search(args, cwd) {
  const q = args.join(' ').toLowerCase();
  if (!q) fail('usage: mis skill search <text>');
  return { skills: all(cwd).filter((s) => [s.name, s.description, ...s.triggers, readFileSync(s.path, 'utf8')].some((t) => t.toLowerCase().includes(q))) };
}

/** RED/GREEN for skills: each scenario runs once without the skill (baseline) and once with its text in the prompt. */
function testSkill(args, cwd) {
  const scope = scopeOf(args);
  const { path } = locate(args[0], scope, cwd);
  if (!args[1]) fail('usage: mis skill test <name> <scenario.json>');
  let list;
  try { list = [JSON.parse(readFileSync(resolve(cwd, args[1]), 'utf8'))].flat(); } catch (e) { fail(`scenario file: ${e.message}`); }
  for (const s of list) if (typeof s?.prompt !== 'string' || !(s.expect?.length || s.forbid?.length)) fail('each scenario needs "prompt" and at least one "expect" or "forbid" regex');
  const skill = readFileSync(path, 'utf8');
  // An empty cwd and state home: the subagent sees neither project nor user learned skills, only what the prompt gives it.
  const sandbox = mkdtempSync(join(tmpdir(), 'mis-skill-test-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
  Object.assign(env, { MIS_STATE_HOME: join(sandbox, 'home') });
  const run = (prompt, s) => {
    const cmd = process.env.MIS_SKILL_TEST_CMD;
    const argv = cmd ? ['sh', '-c', cmd] : skillTestArgv();
    const r = spawnSync(argv[0], argv.slice(1), { cwd: sandbox, env, input: prompt, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) fail(`agent command failed (${r.error?.message ?? `exit ${r.status}`}): ${String(r.stderr).slice(-500)}`);
    const output = r.stdout;
    const pass = (s.expect ?? []).every((re) => new RegExp(re, 'i').test(output)) && !(s.forbid ?? []).some((re) => new RegExp(re, 'i').test(output));
    return { pass, output: output.slice(-2000) };
  };
  try {
    const scenarios = list.map((s, i) => ({
      name: s.name ?? `scenario ${i + 1}`,
      baseline: run(s.prompt, s),
      withSkill: run(`You have this skill. Follow it when it applies.\n\n<skill>\n${skill}\n</skill>\n\n${s.prompt}`, s),
    }));
    const status = scenarios.some((s) => !s.withSkill.pass) ? 'FAIL' : scenarios.some((s) => s.baseline.pass) ? 'NO_RED' : 'GREEN';
    const out = { status, skill: path, scenarios,
      note: { GREEN: 'Every scenario fails without the skill and passes with it.', NO_RED: 'Passes with the skill, but some scenario also passes without it: that scenario does not show the skill is needed; make it harder.', FAIL: 'The agent still fails with the skill: close the loophole in the skill text and run again.' }[status] };
    if (status === 'FAIL') { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return undefined; }
    return out;
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
}

/** Render the skill's ```dot blocks to SVG files beside it (graphviz `dot`). */
function graphs(args, cwd) {
  const scope = scopeOf(args);
  const { dir, path } = locate(args[0], scope, cwd);
  const blocks = dotBlocks(readFileSync(path, 'utf8'));
  if (!blocks.length) fail('no ```dot blocks in ' + path);
  if (spawnSync('dot', ['-V']).error) fail('BLOCKED: graphviz is not installed (command -v dot failed). Install graphviz to render ```dot blocks.');
  const files = blocks.map((b) => {
    const r = spawnSync('dot', ['-Tsvg'], { input: b.src, encoding: 'utf8' });
    if (r.status !== 0) fail(`dot failed on ${b.name}: ${r.stderr.trim()}`);
    const f = join(dir, `${b.name}.svg`);
    writeFileSync(f, r.stdout);
    return f;
  });
  return { files };
}

function skill([sub, ...args], cwd) {
  const fn = { list: () => ({ skills: all(cwd) }), search, add, edit, remove, lint, test: testSkill, graphs }[sub];
  if (!fn) fail(USAGE);
  return fn(args, cwd);
}

export const skillCommands = { skill };
