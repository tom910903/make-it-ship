// mis help / info / capabilities / gain (M9-A4; absorbs OMC omc-reference, omc info, omc capabilities and Ponytail
// ponytail-help, ponytail-gain). Every list is read from the live registries (the commands object, skills/, agents/,
// the MCP registry, hooks.json, the keyword router, style levels); nothing is listed by hand. Only
// `capabilities --write` writes, and only the lockfile inside the repository.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PLUGIN_ROOT } from './install.mjs';
import { parseSkill } from './skills.mjs';
import { keywordTable } from './keywords.mjs';
import { STYLE_LEVELS } from './style.mjs';
import { repoRoot } from './tree-hash.mjs';
import { stateRoot } from './state.mjs';
import { loadRuns, retroMetrics } from './retro.mjs';
import { shortcutDebt } from './debt.mjs';

export const LOCKFILE = '.make-it-ship/capabilities.lock.json';
// M10 writes its comparison benchmark results here; `mis gain` only reads them.
export const BENCH_DIR = join(PLUGIN_ROOT, 'evals', 'benchmarks');
const TOPICS = ['commands', 'skills', 'agents', 'keywords', 'styles', 'mcp', 'hooks'];

const fail = (msg) => { throw new Error(msg); };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const short = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** name + description from the frontmatter of each `<dir>/<entry>` file. */
function docs(dir, fileOf) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((e) => {
    const p = fileOf(e);
    if (!p || !existsSync(p)) return [];
    const fm = parseSkill(readFileSync(p, 'utf8')) ?? {};
    return [{ name: fm.name || e.replace(/\.md$/, ''), description: fm.description ?? '' }];
  });
}

/** Everything Make It Ship offers, read live. `root` is the plugin root (tests point it at a fixture). */
export async function catalog({ root = PLUGIN_ROOT } = {}) {
  const { commands, commandGroups } = await import('./commands.mjs'); // lazy: commands.mjs imports this file
  const owner = {};
  for (const [g, set] of Object.entries(commandGroups)) for (const k of Object.keys(set)) owner[k] = g;
  const groups = Object.fromEntries([...Object.keys(commandGroups), 'other'].map((g) => [g, []]));
  for (const k of Object.keys(commands).sort()) groups[owner[k] ?? 'other'].push(k);
  for (const g of Object.keys(groups)) if (!groups[g].length) delete groups[g];
  const { loadTools } = await import('../mcp/registry.mjs');
  const hooks = readJson(join(root, 'hooks', 'hooks.json'))?.hooks ?? {};
  return {
    commands: groups,
    skills: docs(join(root, 'skills'), (d) => join(root, 'skills', d, 'SKILL.md')),
    agents: docs(join(root, 'agents'), (f) => f.endsWith('.md') && join(root, 'agents', f)),
    keywords: keywordTable(),
    styles: STYLE_LEVELS,
    mcp: (await loadTools()).map((t) => ({ name: t.name, description: t.description })),
    hooks: Object.fromEntries(Object.entries(hooks).map(([e, ms]) => [e, ms.map((m) => m.matcher ?? '*')])),
  };
}

const SECTIONS = {
  commands: (c) => [`## Commands (\`mis <command>\`, ${Object.values(c.commands).flat().length})`, 'Run a command with no arguments to see its usage.',
    ...Object.entries(c.commands).map(([g, ks]) => `- ${g}: ${ks.join(', ')}`)],
  skills: (c) => [`## Skills (${c.skills.length})`, ...c.skills.map((s) => `- \`/make-it-ship:${s.name}\` — ${short(s.description)}`)],
  agents: (c) => [`## Agents (${c.agents.length})`, ...c.agents.map((a) => `- \`make-it-ship:${a.name}\` — ${short(a.description)}`)],
  keywords: (c) => [`## Keywords (said in a prompt; earlier wins; off with \`keywords.disabled\` in ~/.make-it-ship/config.json, e.g. \`mis config set keywords.disabled ...\`)`,
    ...c.keywords.map((k) => `- \`${k.name}\` — ${short(k.trigger, 400)}\n  → ${short(k.action, 200)}`)],
  styles: (c) => ['## Style levels', `${c.styles.join(', ')} (\`mis style <level>\`, or say "style <level>" / "normal mode")`],
  mcp: (c) => [`## MCP tools (server \`mis\`, ${c.mcp.length})`, ...c.mcp.map((t) => `- \`${t.name}\` — ${short(t.description, 120)}`)],
  hooks: (c) => [`## Hooks (${Object.keys(c.hooks).length} events)`, ...Object.entries(c.hooks).map(([e, ms]) => `- ${e}: ${ms.join(', ')}`)],
};

async function help([topic, ...rest], cwd) {
  if (topic === '--json') return catalog();
  if (topic !== undefined && !SECTIONS[topic]) fail(`unknown topic "${topic}"; topics: ${TOPICS.join(', ')}`);
  if (rest.length) fail('usage: mis help [topic] | help --json');
  const c = await catalog();
  const body = (topic ? [topic] : TOPICS).flatMap((t) => [...SECTIONS[t](c), '']);
  return ['# Make It Ship', '', ...body, 'More: `mis info` (versions and counts), `mis capabilities` (drift lockfile), `mis gain` (measured results), `/make-it-ship:reference`.'].join('\n');
}

async function info(args, cwd) {
  if (args.length) fail('usage: mis info');
  const { commands } = await import('./commands.mjs');
  const c = await catalog();
  return { ...commands.version([], cwd), commands: Object.values(c.commands).flat().length, skills: c.skills.length, agents: c.agents.map((a) => a.name),
    mcpTools: c.mcp.length, keywords: c.keywords.length, styles: c.styles, hooks: c.hooks };
}

/** Deterministic: sorted names only (no versions, commits or times), so the file changes only when capabilities do. */
const lockData = (c) => ({ version: 1, commands: Object.values(c.commands).flat().sort(), skills: c.skills.map((s) => s.name).sort(),
  agents: c.agents.map((a) => a.name).sort(), mcpTools: c.mcp.map((t) => t.name).sort(), hookEvents: Object.keys(c.hooks).sort() });

function drift(old, now) {
  const out = [];
  for (const k of Object.keys(now).filter((k) => Array.isArray(now[k]))) {
    const a = new Set(old[k] ?? []), b = new Set(now[k]);
    const added = now[k].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
    if (added.length) out.push(`+ ${k}: ${added.join(', ')}`);
    if (removed.length) out.push(`- ${k}: ${removed.join(', ')}`);
  }
  return out;
}

async function capabilities(args, cwd) {
  const mode = args[0];
  if (args.length > 1 || (mode !== undefined && mode !== '--write' && mode !== '--check')) fail('usage: mis capabilities [--write|--check]');
  const path = join(repoRoot(cwd), LOCKFILE);
  const now = lockData(await catalog());
  const counts = Object.fromEntries(Object.entries(now).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
  if (mode === '--write') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(now, null, 2) + '\n');
    return { written: LOCKFILE, ...counts };
  }
  const old = readJson(path);
  const d = old ? drift(old, now) : null;
  if (mode === '--check') {
    if (!old) fail(`no lockfile at ${LOCKFILE} (create it with mis capabilities --write)`);
    if (d.length) fail(`capabilities drifted from ${LOCKFILE} (+ new, - gone; accept with mis capabilities --write):\n${d.join('\n')}`);
    return `capabilities match ${LOCKFILE}`;
  }
  return { lockfile: LOCKFILE, exists: !!old, drift: d ?? [], ...counts };
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

/** Measured local evidence only: run verdicts, check pass rates, bench deltas, shortcut debt, M10 results if present. */
function gainData(cwd) {
  const root = repoRoot(cwd);
  let runs = [];
  try { runs = loadRuns(stateRoot(cwd)); } catch { /* no state yet */ }
  const m = retroMetrics(runs);
  const byCheck = {};
  for (const e of runs.flatMap((r) => r.events.filter((x) => x.type === 'check'))) {
    const c = (byCheck[e.check] ??= { total: 0, pass: 0, fail: 0, blocked: 0, passRate: null });
    c.total++;
    if (e.status === 'PASS') c.pass++; else if (e.status === 'FAIL') c.fail++; else if (e.status === 'BLOCKED') c.blocked++;
    c.passRate = pct(c.pass, c.total);
  }
  const pass = Object.values(byCheck).reduce((n, c) => n + c.pass, 0);
  const bench = runs.flatMap((r) => (r.state.notes ?? []).filter((n) => n.kind === 'bench').map((n) => ({ run: r.state.runId, check: n.check,
    medianMs: n.medianMs, baselineMs: n.baselineMs ?? null, deltaPct: n.deltaPct ?? null, status: n.status })));
  const debt = shortcutDebt(root);
  const files = existsSync(BENCH_DIR) ? readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  // shortcut: lists the M10 result files by name only, show their numbers once M10 fixes the result format
  const benchmarks = files.length ? { status: 'PRESENT', files: files.map((f) => join('evals', 'benchmarks', f)) } : { status: 'BLOCKED', reason: 'no benchmark results' };
  return { runs: m.runs, verdicts: m.finalVerdicts, checks: { total: m.checks.total, pass, fail: m.checks.failed, blocked: m.checks.blocked,
    passRate: pct(pass, m.checks.total), failToPass: m.checks.failToPass, byCheck }, bench, debt: { markers: debt.length, noTrigger: debt.filter((d) => !d.trigger).length }, benchmarks };
}

function gain(args, cwd) {
  if (args.length && !(args.length === 1 && args[0] === '--json')) fail('usage: mis gain [--json]');
  const g = gainData(cwd);
  if (args[0] === '--json') return g;
  const c = g.checks;
  return ['# Make It Ship gain (measured in this repository; no estimates)', '',
    `Runs: ${g.runs}${g.runs ? ` (verdicts: ${Object.entries(g.verdicts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`,
    `Checks: ${c.total} recorded, ${c.pass} PASS${c.total ? ` (${c.passRate}%)` : ''}, ${c.fail} FAIL, ${c.blocked} BLOCKED; ${c.failToPass} failure(s) later fixed (FAIL → PASS)`,
    ...Object.entries(c.byCheck).map(([k, v]) => `  - ${k}: ${v.pass}/${v.total} PASS (${v.passRate}%)`),
    `Bench:${g.bench.length ? "" : " no `mis bench` results"}`,
    ...g.bench.map((b) => `  - ${b.check}: median ${b.medianMs} ms${b.baselineMs !== null ? `, baseline ${b.baselineMs} ms (${b.deltaPct > 0 ? '+' : ''}${b.deltaPct}%, ${b.status})` : ` (${b.status})`} [run ${b.run}]`),
    `Shortcut debt: ${g.debt.markers} markers (${g.debt.noTrigger} without an upgrade trigger) — \`mis debt\` lists them`,
    `Benchmark against the original plugins: ${g.benchmarks.status === 'BLOCKED' ? 'BLOCKED: no benchmark results (M10 writes them to evals/benchmarks/*.json)' : g.benchmarks.files.join(', ')}`,
  ].join('\n');
}

export const helpCommands = { help, info, capabilities, gain };
