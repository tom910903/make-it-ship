import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderHud, renderExtras } from '../../scripts/statusline.mjs';
import { fakeHome, makeRepo, mis, ROOT } from '../helpers.mjs';

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
  const sl = (cwd, extra = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ workspace: { current_dir: cwd }, cwd, session_id: 'S', ...extra }), encoding: 'utf8', env });
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
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.CLAUDE_CODE_SESSION_ID;
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
  const env = { ...process.env, MIS_STATE_HOME: home }; delete env.CLAUDE_CODE_SESSION_ID;
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

test('plan usage: 5-hour and 7-day rate limits from the status line input follow the context; absent windows are skipped', () => {
  assert.equal(renderExtras({ ctxPct: 42, limits: { five_hour: { used_percentage: 23.5 }, seven_day: { used_percentage: 41.2 } } }), ' · ctx 42% · 5h 24% · 7d 41%');
  assert.equal(renderExtras({ ctxPct: 42, limits: { seven_day: { used_percentage: 0 } } }), ' · ctx 42% · 7d 0%');
  assert.equal(renderExtras({ ctxPct: 42 }), ' · ctx 42%', 'API key users have no rate_limits');
});
