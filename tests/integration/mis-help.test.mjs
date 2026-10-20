// M9-A4: help, info, capabilities, gain. Every list must come from the live registries, and none of these may
// write anything except the capabilities lockfile inside the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, makeRepo, mis, fakeHome, git, write } from '../helpers.mjs';
import { commands } from '../../scripts/lib/commands.mjs';
import { catalog, helpCommands, LOCKFILE } from '../../scripts/lib/commands-help.mjs';
import { loadTools } from '../../scripts/mcp/registry.mjs';
import { STYLE_LEVELS } from '../../scripts/lib/style.mjs';

const ls = (dir, ext = '') => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext));
const skillNames = () => ls('skills').filter((d) => statSync(join(ROOT, 'skills', d)).isDirectory());
const agentNames = () => ls('agents', '.md').map((f) => f.slice(0, -3));

/** path → sha256 of every file under dir (to prove nothing was written). */
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
}

test('mis help lists every command, skill, agent, keyword, MCP tool, hook event and style level from the code', async () => {
  const repo = makeRepo();
  const r = mis(repo, ['help']);
  assert.equal(r.code, 0, r.err);
  for (const c of Object.keys(commands)) assert.match(r.out, new RegExp(`\\b${c}\\b`), `command ${c}`);
  for (const s of skillNames()) assert.ok(r.out.includes(`/make-it-ship:${s}`), `skill ${s}`);
  for (const a of agentNames()) assert.ok(r.out.includes(`make-it-ship:${a}`), `agent ${a}`);
  for (const t of await loadTools()) assert.ok(r.out.includes(t.name), `tool ${t.name}`);
  for (const k of (await catalog()).keywords) assert.ok(r.out.includes(`\`${k.name}\``), `keyword ${k.name}`);
  for (const e of Object.keys(JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks)) assert.ok(r.out.includes(e), `hook ${e}`);
  for (const l of STYLE_LEVELS) assert.ok(r.out.includes(l));
  assert.match(r.out, /ralph/i);
  assert.match(r.out, /ralph\\s\*:/, 'the ralph prefix rule is printed from the live regex');
  assert.match(r.out, /loop-hint/);
});

test('mis help <topic> narrows the output; unknown topic exits 1 and names the topics', () => {
  const repo = makeRepo();
  const r = mis(repo, ['help', 'agents']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /make-it-ship:explorer/);
  assert.doesNotMatch(r.out, /MCP tools/);
  const bad = mis(repo, ['help', 'nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /commands.*skills.*agents.*keywords.*mcp.*hooks/);
});

test('a command added to the registry shows up in help and makes capabilities --check fail', async () => {
  const repo = makeRepo();
  await helpCommands.capabilities(['--write'], repo);
  commands['zz-fake-cmd'] = () => 'fake';
  try {
    const text = await helpCommands.help(['commands'], repo);
    assert.match(text, /zz-fake-cmd/);
    const info = await helpCommands.info([], repo);
    assert.equal(info.commands, Object.keys(commands).length);
    await assert.rejects(helpCommands.capabilities(['--check'], repo), /\+ commands: zz-fake-cmd/);
  } finally { delete commands['zz-fake-cmd']; }
  assert.match(await helpCommands.capabilities(['--check'], repo), /match/);
});

test('catalog reads skills, agents and hook events from the plugin root it is given', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mis-cat-'));
  write(root, {
    'skills/zz-skill/SKILL.md': '---\nname: zz-skill\ndescription: A fake skill for the catalog test.\n---\nbody\n',
    'agents/zz-agent.md': '---\nname: zz-agent\ndescription: A fake agent for the catalog test.\ntools: Read\n---\nbody\n',
    'hooks/hooks.json': { hooks: { ZzEvent: [{ matcher: 'Bash', hooks: [] }] } },
  });
  const c = await catalog({ root });
  assert.deepEqual(c.skills.map((s) => s.name), ['zz-skill']);
  assert.deepEqual(c.agents.map((a) => a.name), ['zz-agent']);
  assert.deepEqual(c.hooks, { ZzEvent: ['Bash'] });
});

test('mis info: version, agents, MCP tool count from the registry, hooks wired', async () => {
  const repo = makeRepo();
  const { json, code, err } = mis(repo, ['info']);
  assert.equal(code, 0, err);
  assert.equal(json.name, 'make-it-ship');
  assert.equal(json.version, JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.equal(json.mcpTools, (await loadTools()).length);
  assert.deepEqual(json.agents, agentNames().sort());
  assert.equal(json.skills, skillNames().length);
  assert.deepEqual(Object.keys(json.hooks).sort(), Object.keys(JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks).sort());
});

test('capabilities: --check fails without a lockfile, --write is idempotent and the only change, drift exits 1', () => {
  const repo = makeRepo();
  const h = fakeHome();
  const home0 = snapshot(h.home);
  const env = { env: h.env };
  const none = mis(repo, ['capabilities', '--check'], env);
  assert.equal(none.code, 1);
  assert.match(none.err, /no lockfile/);
  assert.equal(mis(repo, ['capabilities', '--write'], env).code, 0);
  const lockPath = join(repo, LOCKFILE);
  const first = readFileSync(lockPath, 'utf8');
  assert.equal(mis(repo, ['capabilities', '--write'], env).code, 0);
  assert.equal(readFileSync(lockPath, 'utf8'), first, 'deterministic');
  assert.equal(git(repo, 'status', '--porcelain', '-uall'), `?? ${LOCKFILE}`);
  assert.equal(mis(repo, ['capabilities', '--check'], env).code, 0);
  const lock = JSON.parse(first);
  assert.deepEqual(Object.keys(lock), ['version', 'commands', 'skills', 'agents', 'mcpTools', 'hookEvents']);
  lock.skills = lock.skills.filter((s) => s !== 'run');
  lock.mcpTools.push('zz_gone_tool');
  writeFileSync(lockPath, JSON.stringify(lock));
  const d = mis(repo, ['capabilities', '--check'], env);
  assert.equal(d.code, 1);
  assert.match(d.err, /\+ skills: run/);
  assert.match(d.err, /- mcpTools: zz_gone_tool/);
  assert.deepEqual(snapshot(h.home), home0, 'nothing written to the home directory');
});

test('this repository\'s committed capabilities lockfile matches the code', () => {
  const r = mis(ROOT, ['capabilities', '--check']);
  assert.equal(r.code, 0, `${r.err}\nRun: node scripts/mis.mjs capabilities --write`);
});

test('help, info, gain and capabilities (no flag) write nothing', () => {
  const repo = makeRepo({ 'README.md': '# demo\n', 'a.js': '// shortcut: no cache, add one past 1k items\n' });
  const h = fakeHome();
  const home0 = snapshot(h.home), repo0 = snapshot(repo);
  for (const args of [['help'], ['info'], ['gain'], ['gain', '--json'], ['capabilities']]) {
    const r = mis(repo, args, { env: h.env });
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
  }
  assert.deepEqual(snapshot(h.home), home0);
  assert.deepEqual(snapshot(repo), repo0);
});

test('mis gain shows only measured local data and BLOCKED for missing benchmark results', () => {
  const repo = makeRepo({ 'README.md': '# demo\n', 'a.js': '// shortcut: no cache, add one past 1k items\n// shortcut: no trigger here\n' });
  const empty = mis(repo, ['gain']);
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /Runs: 0/);
  assert.match(empty.out, /BLOCKED: no benchmark results/);
  assert.match(empty.out, /Shortcut debt: 2 markers \(1 without an upgrade trigger\)/);
  assert.doesNotMatch(empty.out, /sav(ed|ing)/i);

  const run = join(repo, '.git', 'make-it-ship', 'runs', '20261020-1200-abcd');
  mkdirSync(run, { recursive: true });
  const t = '2026-10-20T12:00:00.000Z';
  writeFileSync(join(run, 'state.json'), JSON.stringify({ runId: '20261020-1200-abcd', startedAt: t, state: 'REPORTED', mode: 'quick',
    notes: [{ kind: 'bench', check: 'test', medianMs: 120, baselineMs: 100, deltaPct: 20, status: 'OK', at: t }] }));
  const ev = [{ type: 'check', check: 'test', status: 'FAIL' }, { type: 'check', check: 'test', status: 'PASS' }, { type: 'check', check: 'lint', status: 'PASS' },
    { type: 'check', check: 'lint', status: 'BLOCKED' }, { type: 'report', verdict: 'VERIFIED' }].map((e) => JSON.stringify({ ...e, at: t }));
  writeFileSync(join(run, 'events.jsonl'), ev.join('\n') + '\n');
  const { json, code, err } = mis(repo, ['gain', '--json']);
  assert.equal(code, 0, err);
  assert.equal(json.runs, 1);
  assert.deepEqual(json.verdicts, { VERIFIED: 1 });
  assert.deepEqual(json.checks.byCheck.test, { total: 2, pass: 1, fail: 1, blocked: 0, passRate: 50 });
  assert.equal(json.checks.passRate, 50);
  assert.equal(json.checks.failToPass, 1);
  assert.deepEqual(json.bench, [{ run: '20261020-1200-abcd', check: 'test', medianMs: 120, baselineMs: 100, deltaPct: 20, status: 'OK' }]);
  assert.deepEqual(json.debt, { markers: 2, noTrigger: 1 });
  assert.equal(json.benchmarks.status, 'BLOCKED');
  const text = mis(repo, ['gain']).out;
  assert.match(text, /Checks: 4 recorded, 2 PASS \(50%\), 1 FAIL, 1 BLOCKED/);
  assert.match(text, /test: median 120 ms, baseline 100 ms \(\+20%, OK\)/);
});

test('help and reference skills point at the generated help topics, not hand-written lists', () => {
  const repo = makeRepo();
  for (const s of ['help', 'reference']) {
    const text = readFileSync(join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    for (const [, topic] of text.matchAll(/`mis help (\w+)`/g)) assert.equal(mis(repo, ['help', topic]).code, 0, `${s}: mis help ${topic}`);
  }
  assert.match(readFileSync(join(ROOT, 'skills', 'reference', 'SKILL.md'), 'utf8'), /`mis help agents`[\s\S]*`mis help mcp`[\s\S]*`mis help keywords`/);
});
