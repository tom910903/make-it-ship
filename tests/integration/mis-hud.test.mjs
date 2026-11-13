// mis hud end to end: presets and the changes made to them in ~/.make-it-ship/config.json, previews, the default status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, ROOT } from '../helpers.mjs';
import { HUD_ITEMS, PRESETS } from '../../scripts/lib/hud-items.mjs';

const fresh = () => { const h = mkdtempSync(join(tmpdir(), 'mis-home-')); return { h, env: { MIS_STATE_HOME: h } }; };
const config = (h) => JSON.parse(readFileSync(join(h, 'config.json'), 'utf8')).statusLine;
const statusline = (h, input) => {
  const env = { ...process.env, MIS_STATE_HOME: h, NO_COLOR: '1' }; delete env.CLAUDE_CODE_SESSION_ID;
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'statusline.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env }).stdout;
};

test('preset switches clear earlier changes (and a 0.8.0 list) but keep chain; add/remove are recorded against the preset', () => {
  const dir = makeRepo(), { h, env } = fresh();
  writeFileSync(join(h, 'config.json'), JSON.stringify({ statusLine: { items: ['model', 'cost'], chain: 'echo X' } }));
  const ok = (args) => { const r = mis(dir, ['hud', ...args], { env }); assert.equal(r.code, 0, r.err); return r.json; };
  assert.equal(ok([]).preset, 'custom', 'a 0.8.0 items list is a custom list');
  const m = ok(['preset', 'minimal']);
  assert.deepEqual([m.preset, m.items, m.add, m.remove], ['minimal', PRESETS.minimal, [], []]);
  assert.deepEqual(config(h), { chain: 'echo X', preset: 'minimal' });
  assert.deepEqual(ok(['add', 'git', 'cost']).items, ['model', 'effort', 'fast', 'ctx', '5h', '7d', 'spend', 'cost', 'git', 'loop', 'frozen', 'agents', 'todo']);
  assert.deepEqual(config(h).add, ['git', 'cost']);
  const r = ok(['remove', 'ctx', 'git']);
  assert.deepEqual([r.add, r.remove], [['cost'], ['ctx']], 'removing an added part takes it out of add; a preset part goes into remove');
  assert.deepEqual(ok(['add', 'ctx']).remove, [], 'adding a removed preset part takes it out of remove');
  for (const [args, re] of [[['add', 'br'], /br goes only in a custom list/], [['set'], /usage: mis hud set/], [['preset', 'nope'], /usage: mis hud preset/],
    [['preset', 'toString'], /usage: mis hud preset/], [['add', 'toString'], /unknown HUD item toString/], [['add'], /usage: mis hud add/], [['frob'], /usage: mis hud/]]) {
    const bad = mis(dir, ['hud', ...args], { env });
    assert.equal(bad.code, 1, args.join(' '));
    assert.match(bad.err, re);
  }
  assert.deepEqual(ok(['set', 'cost', 'br', 'model']).items, ['cost', 'br', 'model']);
  assert.deepEqual(config(h), { chain: 'echo X', preset: 'custom', items: ['cost', 'br', 'model'] });
  assert.deepEqual(ok(['reset']).items, PRESETS.focused);
  assert.deepEqual(config(h), { chain: 'echo X' }, 'reset keeps only the chain');
});

test('mis hud gives the groups and a preview of each preset: from a sample until the status line has run, then from its last input; no colors, no chain', () => {
  const dir = makeRepo(), { h, env } = fresh();
  const marker = join(h, 'chain-ran');
  writeFileSync(join(h, 'config.json'), JSON.stringify({ statusLine: { chain: `touch ${marker}` } }));
  const s = mis(dir, ['hud'], { env }).json;
  assert.equal(s.groups.length, 8);
  assert.deepEqual(s.groups.flatMap((g) => g.items.map((i) => i.name)).sort(), Object.keys(HUD_ITEMS).filter((k) => k !== 'br').sort());
  for (const g of s.groups) assert.ok(g.items.length <= 4 && g.items.every((i) => typeof i.on === 'boolean' && i.doc), g.group);
  assert.deepEqual(Object.keys(s.presets), ['minimal', 'focused', 'full']);
  assert.equal(s.previewSource, 'sample input');
  assert.equal(s.presets.focused.preview, s.preview, 'the current preview is the focused one');
  assert.match(s.presets.minimal.preview, /^MIS ▸ idle · Opus · effort high · ctx /);
  assert.match(s.presets.full.preview, /\$1\.23/);
  assert.doesNotMatch(JSON.stringify(s), /\\u001b\[/, 'previews have no colors');
  assert.ok(!existsSync(marker), 'previews never run statusLine.chain');
  statusline(h, { cwd: dir, session_id: 'S', model: { display_name: 'Sonnet 9' } });
  assert.ok(existsSync(marker), 'the status line itself still runs the chain');
  const p = mis(dir, ['hud', 'preview', '--preset', 'minimal'], { env }).json;
  assert.deepEqual([p.preset, p.previewSource], ['minimal', 'last status line input']);
  assert.match(p.preview, /^MIS ▸ idle · Sonnet 9$/);
  assert.match(mis(dir, ['hud', 'preview', '--preset', 'nope'], { env }).err, /usage: mis hud preview/);
});

test('the default status line (no config) is the focused preset: model and usage first, then git and session parts', () => {
  const dir = makeRepo(), { h } = fresh();
  const input = { cwd: dir, session_id: 'S', model: { display_name: 'Opus' }, effort: { level: 'max' }, context_window: { used_percentage: 42 },
    rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 } }, cost: { total_cost_usd: 1.5, total_duration_ms: 2_520_000, total_lines_added: 3 } };
  assert.equal(statusline(h, input), 'MIS ▸ idle · Opus · effort max · ctx ████░░░░░░ 42% · 5h ██░░░░░░░░ 23% · 7d ████░░░░░░ 41%\nmain · 42m\n');
  writeFileSync(join(dir, 'new.txt'), 'x');
  rmSync(join(h, 'hud-git.json')); // past the 5-second git status cache
  assert.equal(statusline(h, input).split('\n')[1], 'main · ?1 · 42m', 'git changes next to the branch');
});

test('mis config set checks the preset and the parts', () => {
  const dir = makeRepo(), { env } = fresh();
  const set = (k, v) => mis(dir, ['config', 'set', k, v], { env }).code;
  assert.equal(set('statusLine.preset', 'full'), 0);
  assert.equal(set('statusLine.preset', 'custom'), 0);
  for (const [k, v] of [['statusLine.preset', 'nope'], ['statusLine.preset', 'toString'], ['statusLine.add', '["br"]'], ['statusLine.remove', '["toString"]'], ['statusLine.items', '["constructor"]']]) assert.equal(set(k, v), 1, `${k} ${v}`);
  assert.equal(set('statusLine.add', '["git","cost"]'), 0);
});

test('the hud skill walks through presets and groups from one mis hud call, without asking for part names', () => {
  const t = readFileSync(join(ROOT, 'skills', 'hud', 'SKILL.md'), 'utf8');
  for (const re of [/Run `mis hud` once/, /AskUserQuestion/, /`mis hud preset <name>` first/, /`mis hud add …`/, /`mis hud remove …`/, /`mis hud set /, /"Other"/, /four/, /Never ask them to type a part name/]) assert.match(t, re);
});
