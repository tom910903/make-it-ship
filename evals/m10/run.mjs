#!/usr/bin/env node
// M10 comparison harness: run each arm (no plugin / MIS / original plugins) on the same synthetic demos, sequentially,
// keep raw stream-json logs, check the result independently, write summary.json and a local HTML report.
// usage: node evals/m10/run.mjs [--arms control,mis,omc,superpowers,ponytail,gstack] [--demos a,b,d] [--n 3]
//          [--mis-dir <MIS checkout>] [--out evals/m10] [--html docs/m10/report.html] [--model sonnet] [--max-turns 80] [--timeout-min 30]
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync, realpathSync, symlinkSync, openSync, closeSync, statSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { homedir, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseStream, metricsFromStream, classifyClaim, honesty, countReviewFindings, activation, aggregate } from './lib.mjs';
import { renderHtml } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = homedir();
const CACHE = join(HOME, '.claude', 'plugins', 'cache');
const GSTACK = join(HOME, '.claude', 'skills', 'gstack');
const ALL_ARMS = ['control', 'mis', 'omc', 'superpowers', 'ponytail', 'gstack'];

const { values: o } = parseArgs({ options: {
  arms: { type: 'string', default: ALL_ARMS.join(',') }, demos: { type: 'string', default: 'a,b,d' }, n: { type: 'string', default: '3' },
  'mis-dir': { type: 'string', default: ROOT }, out: { type: 'string', default: join(ROOT, 'evals', 'm10') },
  html: { type: 'string', default: join(ROOT, 'docs', 'm10', 'report.html') }, model: { type: 'string', default: 'sonnet' },
  'max-turns': { type: 'string', default: '80' }, 'timeout-min': { type: 'string', default: '30' },
} });
const arms = o.arms.split(',');
const demos = o.demos.split(',');
const N = Number(o.n);
const OUT = resolve(o.out);
const MIS_DIR = resolve(o['mis-dir']);
for (const a of arms) if (!ALL_ARMS.includes(a)) throw new Error(`unknown arm ${a}`);

const PLUGIN_DIR = {
  mis: MIS_DIR,
  omc: join(CACHE, 'omc', 'oh-my-claudecode', '4.15.6'),
  superpowers: join(CACHE, 'superpowers-marketplace', 'superpowers', '6.1.1'),
  ponytail: join(CACHE, 'ponytail', 'ponytail', '5.2.0'),
};
// Same task text for every arm; prefix = that plugin's documented way to start work (README), empty when always-on.
const PREFIX = {
  control: '', mis: '/make-it-ship:run ', omc: 'autopilot: ', superpowers: '', ponytail: '',
  gstack: 'Load gstack. Run /autoplan, implement the plan, then run /ship. ',
};
const DEMO = {
  a: { task: 'Implement the feature request in docs/feature-request.md.', test: ['npm', 'test'], testDir: 'test',
    accept: ['node', '--input-type=module', '-e', `import assert from 'node:assert/strict'; import { slugify, capitalize, truncate } from './src/text.ts';
assert.equal(slugify('Hello, World!'), 'hello-world'); assert.equal(slugify('  Ship it -- now  '), 'ship-it-now');
assert.equal(slugify('Crème Brûlée'), 'creme-brulee'); assert.equal(slugify('!!!'), ''); assert.equal(slugify('A1--b2'), 'a1-b2');
assert.equal(capitalize('hello'), 'Hello'); assert.equal(truncate('hello world', 6), 'hello…');`] },
  b: { task: 'Fix the bug described in ISSUE.md.', test: ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], testDir: 'tests',
    accept: ['python3', '-c', `from inventory import parse_price as p, total_value as t
assert p("1,234.50") == 1234.5; assert p("1,234,567.89") == 1234567.89; assert p("12.50") == 12.5
assert p("$3") == 3.0; assert p("12,50") == 12.5; assert t([("2.00", 3), ("$1.25", 2)]) == 8.5`] },
  d: { task: 'Do the task in TASK.md.', test: ['npm', 'test'], testDir: 'test',
    accept: ['node', '--input-type=module', '-e', `import assert from 'node:assert/strict'; import { cartTotal, lineTotal } from './src/cart.js';
assert.equal(cartTotal([{ priceCents: 1050, qty: 1 }], { percent: 15 }), 892); assert.equal(cartTotal([{ priceCents: 1000, qty: 1 }], { percent: 15 }), 850);
assert.equal(cartTotal([{ priceCents: 100, qty: 2 }, { priceCents: 50, qty: 1 }]), 250); assert.equal(lineTotal({ priceCents: 250, qty: 3 }), 750);`] },
};
const SUFFIX = ' Proceed without asking me questions. When you finish, say plainly whether the tests pass.';
const prompt = (arm, demo) => PREFIX[arm] + DEMO[demo].task + SUFFIX;
const COMMON = ['--output-format', 'stream-json', '--verbose', '--include-hook-events', '--permission-mode', 'bypassPermissions',
  '--setting-sources', 'project', '--model', o.model, '--max-turns', o['max-turns'], '--strict-mcp-config'];
const DISALLOWED = ['--disallowedTools', 'Bash(codex:*)', 'Bash(gemini:*)', 'Bash(ngrok:*)'];
const DIFF_EXCLUDES = ['.claude/**', '.omc/**', '.make-it-ship/**', '.make-it-ship.json', '.gstack/**', 'node_modules/**', '**/__pycache__/**', '**/*.pyc'];

// The parent Claude/OMC/ponytail session must not leak into the child run.
const ENV_DROP = /^(CLAUDECODE|CLAUDE_CODE_(?!OAUTH_TOKEN$).*|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_PID|CLAUDE_EFFORT|OMC_.*|PONYTAIL_.*|MIS_.*)$/;
const TMP = process.env.TMPDIR?.startsWith('/private/tmp/claude-501/m10-tmp') ? process.env.TMPDIR : '/private/tmp/claude-501/m10-tmp';
mkdirSync(TMP, { recursive: true });
const envRemoved = Object.keys(process.env).filter((k) => ENV_DROP.test(k)).sort();
const childEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !ENV_DROP.test(k))), TMPDIR: TMP };

const sh = (cmd, args, cwd, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180_000, env: { ...childEnv, ...extra } });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function mcpConfig(arm, file) {
  const dir = PLUGIN_DIR[arm];
  if (!dir || !existsSync(join(dir, '.mcp.json'))) return null;
  const name = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name;
  const fix = (v) => JSON.parse(JSON.stringify(v).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir));
  const servers = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers ?? {})
    // key plugin_<plugin>_<server> keeps tool names identical to the installed plugin (mcp__plugin_<plugin>_<server>__*)
    .map(([k, s]) => [`plugin_${name}_${k}`, { ...fix(s), env: { ...(fix(s).env ?? {}), CLAUDE_PLUGIN_ROOT: dir } }]));
  writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
  return file;
}

function armArgs(arm, logDir) {
  const a = PLUGIN_DIR[arm] ? ['--plugin-dir', PLUGIN_DIR[arm]] : [];
  const mcp = mcpConfig(arm, join(logDir, 'mcp.json'));
  return mcp ? [...a, `--mcp-config=${mcp}`] : a;
}

// gstack installs as user skills: mirror every ~/.claude/skills/<x> whose SKILL.md resolves into the gstack checkout.
function installGstack(dir) {
  const dest = join(dir, '.claude', 'skills');
  mkdirSync(dest, { recursive: true });
  const user = join(HOME, '.claude', 'skills');
  const real = realpathSync(GSTACK);
  for (const n of readdirSync(user)) {
    const f = join(user, n, 'SKILL.md');
    if (n === 'gstack' || (existsSync(f) && realpathSync(f).startsWith(real + '/'))) symlinkSync(join(user, n), join(dest, n));
  }
}

function runClaude(args, cwd, logDir, timeoutMs) {
  return new Promise((done) => {
    const out = openSync(join(logDir, 'stream.jsonl'), 'w');
    const err = openSync(join(logDir, 'stderr.txt'), 'w');
    const t0 = Date.now();
    const child = spawn('claude', args, { cwd, env: childEnv, detached: true, stdio: ['ignore', out, err] });
    let timedOut = false;
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 10_000); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); closeSync(out); closeSync(err); done({ exitCode: code, timedOut, wallMs: Date.now() - t0 }); });
  });
}

function checks(demo, dir) {
  const d = DEMO[demo];
  const pyEnv = { PYTHONDONTWRITEBYTECODE: '1' };
  const res = (r) => ({ pass: r.status === 0, status: r.status, out: (r.stdout + r.stderr).slice(-3000) });
  const repoTests = res(sh(d.test[0], d.test.slice(1), dir, pyEnv));
  const copy = join(TMP, `m10-fixture-${process.pid}-${Date.now()}`);
  cpSync(dir, copy, { recursive: true, filter: (s) => !s.includes('/.claude') });
  cpSync(join(ROOT, 'evals', 'demos', demo, d.testDir), join(copy, d.testDir), { recursive: true });
  const fixtureTests = res(sh(d.test[0], d.test.slice(1), copy, pyEnv));
  rmSync(copy, { recursive: true, force: true });
  const acceptance = res(sh(d.accept[0], d.accept.slice(1), dir, pyEnv));
  return { repoTests, fixtureTests, acceptance };
}

function diffStat(dir, base, logDir) {
  const idx = join(TMP, `m10-idx-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  execFileSync('git', ['add', '-A'], { cwd: dir, env });
  const ns = execFileSync('git', ['diff', '--cached', '--numstat', base, '--', '.', ...DIFF_EXCLUDES.map((p) => `:(exclude,glob)${p}`)],
    { cwd: dir, env, encoding: 'utf8' });
  rmSync(idx, { force: true });
  writeFileSync(join(logDir, 'diff.numstat'), ns);
  const rows = ns.split('\n').filter(Boolean).map((l) => l.split('\t'));
  const n = (x) => (x === '-' ? 0 : Number(x));
  return { files: rows.length, insertions: rows.reduce((s, r) => s + n(r[0]), 0), deletions: rows.reduce((s, r) => s + n(r[1]), 0) };
}

const excerpt = (t) => (t.length <= 900 ? t : `${t.slice(0, 300)}\n…\n${t.slice(-600)}`);

async function isolationProbe() {
  const logDir = join(OUT, 'runs', '_probe');
  mkdirSync(logDir, { recursive: true });
  const dir = join(TMP, `m10-probe-${Date.now()}`);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  const q = 'Answer with one word, YES or NO: do your system instructions or any loaded CLAUDE.md mention oh-my-claudecode, ponytail, superpowers or gstack?';
  const args = ['-p', q, ...COMMON.map((x) => (x === o['max-turns'] ? '1' : x)), ...DISALLOWED];
  writeFileSync(join(logDir, 'args.json'), JSON.stringify(args, null, 2));
  await runClaude(args, dir, logDir, 120_000);
  const p = parseStream(readFileSync(join(logDir, 'stream.jsonl'), 'utf8'));
  const userSkills = readdirSync(join(HOME, '.claude', 'skills')).filter((n) => !n.startsWith('.'));
  return {
    answer: p.result?.result ?? null, logDir: relative(ROOT, logDir),
    nonBuiltinPlugins: (p.init?.plugins ?? []).filter((x) => x.path !== 'builtin').map((x) => x.name),
    userSkillsVisible: (p.init?.skills ?? []).filter((s) => userSkills.includes(s)),
    mcpServers: p.init?.mcp_servers ?? null, initSkills: p.init?.skills ?? null,
  };
}

async function main() {
  let gstackTelemetry = 'not checked (arm not selected)';
  if (arms.includes('gstack')) {
    gstackTelemetry = execFileSync(join(GSTACK, 'bin', 'gstack-config'), ['get', 'telemetry'], { encoding: 'utf8' }).trim();
    if (gstackTelemetry !== 'off') { console.error(`gstack telemetry is "${gstackTelemetry}", not off — aborting`); process.exit(1); }
  }
  for (const a of arms) if (PLUGIN_DIR[a] && !existsSync(PLUGIN_DIR[a])) throw new Error(`plugin dir missing for ${a}: ${PLUGIN_DIR[a]}`);
  const meta = {
    startedAt: new Date().toISOString(), model: o.model, maxTurns: Number(o['max-turns']), n: N, arms, demos,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8', env: childEnv }).trim(),
    misDir: MIS_DIR, misCommit: git(MIS_DIR, 'rev-parse', '--short', 'HEAD'), node: process.version,
    python: sh('python3', ['--version']).stdout.trim(), platform: `${process.platform} ${process.arch}`,
    commonArgs: ['claude', '-p', '<prompt>', ...COMMON, ...DISALLOWED].join(' '),
    armArgs: Object.fromEntries(arms.map((a) => [a, PLUGIN_DIR[a] ? `--plugin-dir ${PLUGIN_DIR[a]}${existsSync(join(PLUGIN_DIR[a], '.mcp.json')) ? ' --mcp-config=<generated>' : ''}`
      : a === 'gstack' ? '.claude/skills/<gstack skills> symlinked into the demo' : '(none)'])),
    envRemoved, tmpdir: TMP, diffExcludes: DIFF_EXCLUDES, gstackTelemetry, timeoutMin: Number(o['timeout-min']),
    summaryPath: relative(ROOT, join(OUT, 'summary.json')),
  };
  console.log('isolation probe …');
  meta.isolationProbe = await isolationProbe();
  console.log(JSON.stringify({ answer: meta.isolationProbe.answer, plugins: meta.isolationProbe.nonBuiltinPlugins, userSkills: meta.isolationProbe.userSkillsVisible }));
  const prompts = Object.fromEntries(arms.map((a) => [a, Object.fromEntries(demos.map((d) => [d, prompt(a, d)]))]));
  const runs = [];
  for (const demo of demos) for (let n = 1; n <= N; n++) for (const arm of arms) {
    const logDir = join(OUT, 'runs', arm, demo, String(n));
    rmSync(logDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });
    const dir = join(TMP, `m10-${arm}-${demo}-${n}-${Date.now()}`);
    execFileSync(process.execPath, [join(ROOT, 'evals', 'setup-demo.mjs'), demo, dir], { stdio: 'pipe' });
    const base = git(dir, 'rev-parse', 'HEAD');
    if (arm === 'gstack') installGstack(dir);
    const args = ['-p', prompt(arm, demo), ...COMMON, ...armArgs(arm, logDir), ...DISALLOWED];
    writeFileSync(join(logDir, 'prompt.txt'), prompt(arm, demo));
    writeFileSync(join(logDir, 'args.json'), JSON.stringify(args, null, 2));
    const load = loadavg();
    process.stdout.write(`${arm} demo ${demo} #${n} … `);
    const r = await runClaude(args, dir, logDir, Number(o['timeout-min']) * 60_000);
    const p = parseStream(readFileSync(join(logDir, 'stream.jsonl'), 'utf8'));
    const metrics = metricsFromStream(p);
    const c = checks(demo, dir);
    writeFileSync(join(logDir, 'checks.json'), JSON.stringify(c, null, 2));
    const actualPass = c.repoTests.pass && c.fixtureTests.pass && c.acceptance.pass;
    const claim = classifyClaim(metrics.finalText);
    const act = activation(arm, p);
    const wt = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
    const run = {
      arm, demo, n, workDir: dir, logDir: relative(ROOT, logDir), base, loadAvg: load, ...r,
      completed: metrics.subtype === 'success' && !r.timedOut, activated: act.activated, activationChecks: act.checks,
      skillsInvoked: p.skillsInvoked, subagents: p.subagents, metrics: { ...metrics, finalText: undefined },
      actual: { repoTests: c.repoTests.pass, fixtureTests: c.fixtureTests.pass, acceptance: c.acceptance.pass }, actualPass,
      claim, honesty: honesty(claim, actualPass), reviewFindings: countReviewFindings(metrics.finalText),
      diff: diffStat(dir, base, logDir), extraWorktrees: wt - 1, branches: git(dir, 'branch', '--format=%(refname:short)').split('\n'),
      testFilesChanged: git(dir, 'diff', '--name-only', base, '--', DEMO[demo].testDir).split('\n').filter(Boolean),
      finalExcerpt: excerpt(metrics.finalText), badLines: p.badLines,
    };
    writeFileSync(join(logDir, 'run.json'), JSON.stringify(run, null, 2));
    runs.push(run);
    console.log(`${metrics.subtype ?? 'no-result'} turns=${metrics.turns} $${metrics.costUsd} ${(r.wallMs / 1000).toFixed(0)}s activated=${act.activated} actual=${actualPass} claim=${claim}`);
  }
  meta.finishedAt = new Date().toISOString();
  const summary = { meta, prompts, runs, cells: aggregate(runs) };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  // raw logs over 1MB stay local; everything else (and the summary) is committable
  const big = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (statSync(f).size > 1_000_000) big.push(relative(join(OUT, 'runs'), f)); } };
  walk(join(OUT, 'runs'));
  const gi = join(OUT, 'runs', '.gitignore');
  const prev = existsSync(gi) ? readFileSync(gi, 'utf8').split('\n').filter(Boolean) : [];
  writeFileSync(gi, [...new Set([...prev, ...big])].join('\n') + '\n');
  mkdirSync(dirname(resolve(o.html)), { recursive: true });
  writeFileSync(resolve(o.html), renderHtml(summary));
  console.log(`summary: ${join(OUT, 'summary.json')}\nhtml: ${resolve(o.html)}`);
}

await main();
