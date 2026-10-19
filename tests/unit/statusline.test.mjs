import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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

test('statusline script: prints the run line for the session cwd, nothing without a run', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } } });
  const sl = (cwd) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify({ workspace: { current_dir: cwd }, cwd }), encoding: 'utf8' });
  assert.equal(sl(dir).stdout, '');
  mis(dir, ['start', '--input', 'x']);
  assert.match(sl(dir).stdout, /^MIS ▸ PLANNING · T0\/0 · unit· · PARTIAL\n?$/);
  assert.equal(sl('/').status, 0, 'non-repo cwd does not crash');
});

test('mis init proposes the HUD statusLine (user applies it)', () => {
  const dir = makeRepo({ 'package.json': { scripts: { test: 'node --test' } } });
  const r = mis(dir, ['init']);
  assert.equal(r.json.hud.statusLine.type, 'command');
  assert.match(r.json.hud.statusLine.command, /scripts\/statusline\.mjs/);
  assert.match(r.json.hud.how, /settings\.json/);
});
