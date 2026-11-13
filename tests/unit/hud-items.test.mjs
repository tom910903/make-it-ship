// HUD presets and the user's changes to them (hud-items.mjs): which parts the status line renders, in which order and rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, isCustom, isItem, isPreset, presetName, resolveHudItems } from '../../scripts/lib/hud-items.mjs';

const rows = (list) => list.join(' ').split(' br ').map((r) => r.split(' '));

test('no config: the focused preset; an unknown or prototype preset name falls back to it', () => {
  for (const sl of [undefined, {}, { preset: 'nope' }, { preset: 'toString' }, { chain: 'x' }]) assert.deepEqual(resolveHudItems(sl), PRESETS.focused, JSON.stringify(sl));
  assert.equal(presetName({ preset: 'toString' }), 'focused');
  assert.deepEqual(resolveHudItems({ preset: 'full' }), PRESETS.full);
});

test('remove drops preset parts; add puts a part next to its neighbours in the full preset, in the same row', () => {
  assert.deepEqual(rows(resolveHudItems({ add: ['cost'] }))[0].slice(-2), ['spend', 'cost'], 'cost: after spend, first row');
  assert.deepEqual(rows(resolveHudItems({ add: ['repo'] }))[1].slice(0, 2), ['repo', 'branch'], 'repo: before branch, second row');
  assert.deepEqual(rows(resolveHudItems({ add: ['lines'] }))[1].slice(5, 8), ['prompt', 'lines', 'skill']);
  const style = resolveHudItems({ add: ['style'] });
  assert.deepEqual(style.slice(-3), ['todo', 'style', 'agents-list'], 'agents-list stays last');
  assert.deepEqual(resolveHudItems({ preset: 'minimal', add: ['git'] }), ['model', 'effort', 'fast', 'ctx', '5h', '7d', 'spend', 'git', 'loop', 'frozen', 'agents', 'todo'],
    'minimal has no git row: before the next part of that row (loop)');
  assert.deepEqual(resolveHudItems({ preset: 'minimal', remove: ['ctx', 'spend'] }), ['model', 'effort', 'fast', '5h', '7d', 'loop', 'frozen', 'agents', 'todo']);
  assert.deepEqual(resolveHudItems({ preset: 'minimal', add: ['ctx', 'br', 'toString'], remove: ['fast'] }), ['model', 'effort', 'ctx', '5h', '7d', 'spend', 'loop', 'frozen', 'agents', 'todo'],
    'a part already in the preset, br and unknown names are ignored');
  assert.ok(!resolveHudItems({ add: ['cost'], remove: ['cost'] }).includes('cost'), 'remove wins');
});

test('custom: the list as written (rows included); a 0.8.0 config with only items is custom; a named preset wins over leftover items', () => {
  assert.deepEqual(resolveHudItems({ preset: 'custom', items: ['cost', 'br', 'model', 'nope', 'constructor'] }), ['cost', 'br', 'model']);
  assert.deepEqual(resolveHudItems({ items: ['model', 'ctx'] }), ['model', 'ctx']);
  assert.equal(isCustom({ items: ['model'] }), true);
  assert.deepEqual(resolveHudItems({ preset: 'minimal', items: ['model'] }), PRESETS.minimal);
  assert.deepEqual(resolveHudItems({ preset: 'custom' }), [], 'custom without items: the head alone');
});

test('names are own keys only', () => {
  for (const k of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) { assert.equal(isItem(k), false, k); assert.equal(isPreset(k), false, k); }
  assert.equal(isItem('git'), true);
  assert.equal(isPreset('full'), true);
});
