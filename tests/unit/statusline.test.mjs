import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderHud } from '../../scripts/statusline.mjs';
import { makeRepo, mis, ROOT } from '../helpers.mjs';

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
  const env = { ...process.env, MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) };
  const sl = (cwd, extra = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ workspace: { current_dir: cwd }, cwd, ...extra }), encoding: 'utf8', env });
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
  const r = mis(dir, ['init']);
  assert.equal(r.json.hud.statusLine.type, 'command');
  assert.match(r.json.hud.statusLine.command, /scripts\/statusline\.mjs/);
  assert.match(r.json.hud.how, /settings\.json/);
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
