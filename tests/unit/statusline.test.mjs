import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderHud, renderExtras } from '../../scripts/statusline.mjs';
import { fakeHome, makeRepo, mis, ROOT, write } from '../helpers.mjs';

const T = 't', C = 'c';
const state = {
  state: 'EXECUTING', mode: 'standard', riskFlags: [], interview: [], notes: [],
  plan: { tasks: [{ id: 'T1', status: 'DONE' }, { id: 'T2', status: 'IN_PROGRESS' }, { id: 'T3', status: 'TODO' }] },
  evidence: [{ check: 'unit', status: 'PASS', treeHash: T, configHash: C }, { check: 'lint', status: 'FAIL', treeHash: T, configHash: C }, { check: 'e2e', status: 'PASS', treeHash: 'old', configHash: C }],
  reviews: [],
};

test('HUD one-liner format', () => {
  const line = renderHud(state, { treeHash: T, configHash: C, required: ['unit', 'lint', 'e2e', 'build'], dependencyChanged: false });
  assert.equal(line, 'MIS ▸ EXECUTING · T1/3 · unit✓ lint✗ e2e~ build· · FAILED');
});

test('statusline script: idle line without a run, run line plus extras with one', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')), CLAUDE_CODE_SESSION_ID: 'S' };
  const sl = (cwd, extra = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ workspace: { current_dir: cwd }, cwd, session_id: 'S', ...extra }), encoding: 'utf8', env: { ...env, NO_COLOR: '1' } });
  assert.equal(sl(dir).stdout, 'MIS ▸ idle · style full · main\n');
  mis(dir, ['start', '--input', 'x']);
  assert.match(sl(dir).stdout, /^MIS ▸ PLANNING · T0\/0 · unit· · PARTIAL · style full · main\n?$/);
  mis(dir, ['loop', 'start', '--max', '7', 'x'], { env });
  mis(dir, ['style', 'ultra'], { env });
  assert.match(sl(dir, { model: { display_name: 'Opus 5.5' } }).stdout, / · style ULTRA · loop 0\/7 · main · Opus 5\.5\n$/);
  mis(dir, ['style', 'off'], { env });
  assert.doesNotMatch(sl(dir).stdout, /style/);
  assert.equal(sl('/').status, 0, 'non-repo cwd does not crash');
  assert.match(sl('/').stdout, /^MIS ▸ idle/);
});

test('mis init proposes the HUD statusLine (user applies it)', () => {
  const dir = makeRepo({ 'package.json': { scripts: { test: 'node --test' } } });
  const { env } = fakeHome();
  const r = mis(dir, ['init'], { env });
  assert.equal(r.json.hud.statusLine.type, 'command');
  assert.match(r.json.hud.statusLine.command, /scripts\/statusline\.mjs/);
  assert.match(r.json.hud.how, /settings\.json/);
});

test('mis init does not propose the HUD when settings.json already runs a Make It Ship status line', () => {
  const dir = makeRepo({ 'package.json': { scripts: { test: 'node --test' } } });
  const { env, claude } = fakeHome();
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'node "/x/plugins/cache/make-it-ship/make-it-ship/0.1.0/scripts/statusline.mjs"' } }));
  assert.equal(mis(dir, ['init'], { env }).json.hud, undefined);
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-own-statusline' } }));
  assert.ok(mis(dir, ['init'], { env }).json.hud, 'another status line: still offered (mis setup chains it)');
});

test('HUD shows the session cost when the host provides it (display only, no enforcement)', () => {
  const ctx = { treeHash: T, configHash: C, required: ['unit'], dependencyChanged: false };
  assert.match(renderHud(state, ctx, { total_cost_usd: 1.2345 }), / · \$1\.23$/);
  assert.doesNotMatch(renderHud(state, ctx), /\$/);
});

test('doctor states that token budgets are not enforceable by a plugin', () => {
  const r = mis(makeRepo(), ['doctor']);
  const tb = r.json.checks.find((c) => c.name === 'token-budget');
  assert.equal(tb.status, 'warn');
  assert.match(tb.detail, /not supported/);
});

test('M6 D11: freeze shows in the line; statusLine.chain appends another status line command', () => {
  const dir = makeRepo({ 'src/a.js': '' });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home, NO_COLOR: '1' }; delete env.CLAUDE_CODE_SESSION_ID;
  mis(dir, ['freeze', 'src'], { env });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ statusLine: { chain: "node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('OTHER '+JSON.parse(s).model.display_name))\"" } }));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir, model: { display_name: 'M' } }), encoding: 'utf8', env });
  assert.match(r.stdout, /· frozen src · /);
  assert.match(r.stdout, / \| OTHER M\n$/);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ statusLine: { chain: 'exit 3' } }));
  const bad = spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8', env });
  assert.match(bad.stdout, /^MIS ▸ idle/, 'a failing chained command is ignored');
});

test('M6 R2-4: a chain that points back at this status line does not recurse', () => {
  const dir = makeRepo();
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const self = `MIS_STATE_HOME=${home} node ${join(ROOT, 'scripts', 'statusline.mjs')}`;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ statusLine: { chain: self } }));
  const env = { ...process.env, MIS_STATE_HOME: home, NO_COLOR: '1' }; delete env.CLAUDE_CODE_SESSION_ID;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8', env, timeout: 10000 });
  assert.ok(Date.now() - t0 < 3000, 'returns quickly');
  assert.match(r.stdout, /^MIS ▸ idle .* \| MIS ▸ idle[^|]*\n$/, 'chained once, not again');
  const ps = spawnSync('pgrep', ['-f', home], { encoding: 'utf8' });
  assert.equal(ps.stdout.trim(), '', 'no leftover processes');
});

test('M9-F1: agents (with stale count) and todos sit between frozen and the branch; absent when zero', () => {
  assert.equal(renderExtras({ style: 'full', agents: { running: 2, stale: 1 }, todo: { done: 1, total: 3 }, branch: 'main' }), ' · style full · agents 2 (1 stale) · todo 1/3 · main');
  assert.equal(renderExtras({ style: 'full', agents: { running: 1, stale: 0 }, branch: 'main' }), ' · style full · agents 1 · main');
  assert.equal(renderExtras({ style: 'full', agents: { running: 0, stale: 0 }, todo: null, branch: 'main' }), ' · style full · main', 'M6 format unchanged without agents/todos');
});

test('gauges: context and 5-hour / 7-day plan usage render as 10-cell bars with time to reset; absent windows are skipped', () => {
  const now = 1_000_000_000_000;
  const limits = { five_hour: { used_percentage: 23.5, resets_at: now / 1000 + 3 * 3600 + 42 * 60 }, seven_day: { used_percentage: 41.2, resets_at: now / 1000 + 2 * 86400 + 5 * 3600 } };
  assert.equal(renderExtras({ ctxPct: 42, limits, now }), ' · ctx ████░░░░░░ 42% · 5h ██░░░░░░░░ 24% (3h42m) · 7d ████░░░░░░ 41% (2d5h)');
  assert.equal(renderExtras({ ctxPct: 42, limits: { seven_day: { used_percentage: 0 } } }), ' · ctx ████░░░░░░ 42% · 7d ░░░░░░░░░░ 0%');
  assert.equal(renderExtras({ ctxPct: 42 }), ' · ctx ████░░░░░░ 42%', 'API key users have no rate_limits');
  assert.equal(renderExtras({ ctxPct: 130 }), ' · ctx ██████████ 130%', 'the bar never overflows');
});

test('colors: threshold colors on gauges (green < 70 <= yellow < 85 <= red), status colors on checks and verdict; plain without color', () => {
  const g = (p) => renderExtras({ ctxPct: p, color: true });
  assert.match(g(42), /\x1b\[32m████/);
  assert.match(g(75), /\x1b\[33m████████/);
  assert.match(g(90), /\x1b\[31m█████████/);
  const line = renderHud(state, { treeHash: T, configHash: C, required: ['unit', 'lint'], dependencyChanged: false }, null, true);
  assert.match(line, /unit\x1b\[32m✓/);
  assert.match(line, /lint\x1b\[31m✗/);
  assert.match(line, /\x1b\[31m\x1b\[1mFAILED/);
  assert.equal(line.replace(/\x1b\[[\d;]*m/g, ''), renderHud(state, { treeHash: T, configHash: C, required: ['unit', 'lint'], dependencyChanged: false }), 'colors add no text');
});

test('statusline script colors its output unless NO_COLOR is set', () => {
  const dir = makeRepo();
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) }; delete env.NO_COLOR;
  const run = (e) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8', env: e }).stdout;
  assert.match(run(env), /\x1b\[/);
  assert.doesNotMatch(run({ ...env, NO_COLOR: '1' }), /\x1b\[/);
});

test('host items: effort, thinking, fast, PR, spend, cost, lines, duration, prompt cache, worktree, session, agent, vim, output style from the Claude Code input', () => {
  const now = 1_000_000_000_000, s = now / 1000;
  const host = {
    effort: { level: 'high' }, thinking: { enabled: true }, fast_mode: true, pr: { number: 12, review_state: 'CHANGES_REQUESTED' },
    cost: { total_cost_usd: 3.456, total_duration_ms: 4_380_000, total_lines_added: 120, total_lines_removed: 35 },
    prompt_cache: { warm: true, expires_at: s + 250, hit_ratio: 0.92 }, worktree: { name: 'feat-x' }, session_name: 'hud-work',
    agent: { name: 'reviewer' }, vim: { mode: 'NORMAL' }, output_style: { name: 'Explanatory' },
  };
  const limits = { spend_limit: { used_percentage: 40, used_usd: 12, limit_usd: 30, resets_at: s + 86400 } };
  assert.equal(renderExtras({ branch: 'main', model: 'Opus', limits, host, now }),
    ' · main · PR #12 changes requested · Opus · effort high · think · fast · spend ████░░░░░░ 40% $12.00/$30.00 (1d0h) · $3.46 · +120 -35 · 1h13m · cache 5m 92% · wt feat-x · hud-work · @reviewer · vim NORMAL · out Explanatory');
  assert.equal(renderExtras({ host: { thinking: { enabled: false }, fast_mode: false, output_style: { name: 'default' }, cost: { total_lines_added: 0, total_lines_removed: 0 }, prompt_cache: { warm: false, hit_ratio: null } }, now }),
    ' · cache cold', 'off flags, the default style and zero lines are hidden; a cold cache says so');
});

test('statusLine.items picks and orders the parts, br starts a new row; mis hud set/add/remove/reset edits it', () => {
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { MIS_STATE_HOME: home };
  const dir = makeRepo();
  const input = JSON.stringify({ cwd: dir, model: { display_name: 'Opus' }, effort: { level: 'max' }, context_window: { used_percentage: 42 }, cost: { total_cost_usd: 1 } });
  const sl = () => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input, encoding: 'utf8', env: { ...process.env, ...env, NO_COLOR: '1' } }).stdout;
  assert.equal(sl(), 'MIS ▸ idle · style full · main · Opus · effort max · ctx ████░░░░░░ 42% · $1.00\n', 'default: every item; ctx from context_window');
  assert.deepEqual(mis(dir, ['hud', 'set', 'effort', 'model', 'br', 'cost'], { env }).json.items, ['effort', 'model', 'br', 'cost']);
  assert.equal(sl(), 'MIS ▸ idle · effort max · Opus\n$1.00\n');
  assert.deepEqual(mis(dir, ['hud', 'remove', 'br', 'model'], { env }).json.items, ['effort', 'cost']);
  assert.deepEqual(mis(dir, ['hud', 'add', 'effort', 'ctx'], { env }).json.items, ['cost', 'effort', 'ctx'], 'add moves a present item to the end');
  assert.equal(sl(), 'MIS ▸ idle · $1.00 · effort max · ctx ████░░░░░░ 42%\n');
  const bad = mis(dir, ['hud', 'add', 'nope'], { env });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown HUD item nope/);
  const all = mis(dir, ['hud', 'reset'], { env }).json;
  assert.ok(all.available.find((i) => i.name === 'effort').on && !all.available.find((i) => i.name === 'br').on);
  assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).statusLine.items, undefined);
  assert.equal(mis(dir, ['config', 'set', 'statusLine.items', '["model","nope"]'], { env }).code, 1, 'config set validates the names too');
});

test('a run head drops its own cost when the cost item is on, so the dollars show once', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const env = { ...process.env, MIS_STATE_HOME: home, NO_COLOR: '1' }; delete env.CLAUDE_CODE_SESSION_ID;
  mis(dir, ['start', '--input', 'x'], { env });
  const sl = () => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir, cost: { total_cost_usd: 2 } }), encoding: 'utf8', env }).stdout;
  assert.equal(sl().match(/\$2\.00/g).length, 1);
  mis(dir, ['hud', 'remove', 'cost'], { env });
  assert.match(sl(), /PARTIAL · \$2\.00 · /, 'without the cost item the run head shows it, as before');
});

test('OMC parts: repo, git changes, time since the prompt, last skill, call counts, background tasks, API key source; each hidden without a value', () => {
  const now = 1_000_000_000_000;
  const items = ['repo', 'git', 'prompt', 'skill', 'calls', 'bg', 'apikey'];
  assert.equal(renderExtras({ items, now, repo: 'make-it-ship', gitStatus: { staged: 2, modified: 3, untracked: 1, ahead: 1, behind: 2 }, promptAt: now - 83_000,
    stats: { tools: 42, agents: 7, skills: 3, skill: 'review', bg: 2 }, apiKey: 'env' }),
  ' · repo make-it-ship · +2 !3 ?1 ⇡1 ⇣2 · prompt 1m23s · skill review · 🔧42 🤖7 ⚡3 · bg 2 · key env');
  assert.equal(renderExtras({ items, now, gitStatus: { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 }, stats: { tools: 5, agents: 0, skills: 0, bg: 0 } }),
    ' · 🔧5', 'a clean tree, zero counters and no prompt yet show nothing');
  assert.equal(renderExtras({ items: ['prompt'], now, promptAt: now - 13_000 }), ' · prompt 13s');
  assert.equal(renderExtras({ items: ['prompt'], now, promptAt: now - (2 * 3600 + 3 * 60) * 1000 }), ' · prompt 2h3m');
});

test('agents-list: a row per running subagent (type without the plugin prefix, running time), 3 at most then +N more; its rows end the current row', () => {
  const now = 1_000_000_000_000;
  const a = (type, s) => ({ type, startedAt: now - s * 1000 });
  assert.equal(renderExtras({ items: ['branch', 'agents-list', 'model'], branch: 'main', model: 'Opus', agentList: [a('make-it-ship:explorer', 125), a('', 13)], now }),
    ' · main\n├─ explorer 2m5s\n└─ agent 13s\nOpus');
  assert.equal(renderExtras({ items: ['agents-list'], agentList: [a('a', 4), a('b', 3), a('c', 2), a('d', 1), a('e', 0)], now }), '\n├─ a 4s\n├─ b 3s\n├─ c 2s\n└─ +2 more');
  assert.equal(renderExtras({ items: ['agents-list', 'model'], model: 'Opus', agentList: [], now }), ' · Opus');
});

test('think follows the transcript (the latest reply thought) and falls back to the thinking setting; duration is colored by session health', () => {
  assert.equal(renderExtras({ items: ['thinking'], stats: { think: true }, host: { thinking: { enabled: false } } }), ' · think');
  assert.equal(renderExtras({ items: ['thinking'], stats: { think: false }, host: { thinking: { enabled: true } } }), '', 'the latest reply did not think');
  assert.equal(renderExtras({ items: ['thinking'], stats: {}, host: { thinking: { enabled: true } } }), ' · think', 'no reply yet: the setting');
  const d = (min, ctxPct) => renderExtras({ items: ['duration'], host: { cost: { total_duration_ms: min * 60000 } }, ctxPct, color: true });
  assert.match(d(30, 10), /\x1b\[32m30m/);
  assert.match(d(61, 10), /\x1b\[33m1h01m/);
  assert.match(d(30, 75), /\x1b\[33m30m/);
  assert.match(d(121, 10), /\x1b\[31m2h01m/);
  assert.match(d(30, 90), /\x1b\[31m30m/);
});

test('the OMC parts are opt-in: the default item set is unchanged', async () => {
  const { DEFAULT_HUD_ITEMS, HUD_ITEMS } = await import('../../scripts/lib/hud-items.mjs');
  assert.deepEqual(DEFAULT_HUD_ITEMS, ['style', 'loop', 'frozen', 'agents', 'todo', 'branch', 'pr', 'model', 'effort', 'thinking', 'fast', 'ctx', '5h', '7d', 'spend', 'cost', 'lines', 'duration', 'cache', 'worktree', 'session', 'agent', 'vim', 'output-style']);
  for (const k of ['repo', 'git', 'prompt', 'skill', 'calls', 'bg', 'apikey', 'agents-list']) assert.ok(HUD_ITEMS[k], k);
});

test('statusline script: apikey names the source and never prints the key', () => {
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ statusLine: { items: ['apikey'] } }));
  const dir = makeRepo();
  const cc = mkdtempSync(join(tmpdir(), 'mis-cc-'));
  const secret = 'sk-ant-api03-SECRET-do-not-print';
  const run = (env, cwd = dir) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd, session_id: 'S' }), encoding: 'utf8', env: { ...process.env, MIS_STATE_HOME: home, CLAUDE_CONFIG_DIR: cc, NO_COLOR: '1', ...env } }).stdout;
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  assert.equal(spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8', env: { ...env, MIS_STATE_HOME: home, CLAUDE_CONFIG_DIR: cc, NO_COLOR: '1' } }).stdout, 'MIS ▸ idle\n', 'no key: nothing');
  assert.equal(run({ ANTHROPIC_API_KEY: secret }), 'MIS ▸ idle · key env\n');
  writeFileSync(join(cc, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: secret } }));
  assert.equal(run({ ANTHROPIC_API_KEY: secret }), 'MIS ▸ idle · key global\n');
  write(dir, { '.claude/settings.local.json': { env: { ANTHROPIC_API_KEY: secret } } });
  const out = run({ ANTHROPIC_API_KEY: secret });
  assert.equal(out, 'MIS ▸ idle · key project\n');
  assert.ok(!out.includes('SECRET'));
});
