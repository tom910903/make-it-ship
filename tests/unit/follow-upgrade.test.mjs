import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeHome } from '../helpers.mjs';
import { misBlock, planSetup, statusLineCommand } from '../../scripts/lib/install.mjs';
import { followUpgrade } from '../../scripts/lib/update.mjs';

// A marketplace install lives in <claude>/plugins/cache/<marketplace>/<name>/<version>; Claude Code's auto-update adds a new
// version folder, so paths written into settings.json and CLAUDE.md must follow it. Each test uses its own fake home.
function setup() {
  const h = fakeHome();
  process.env.CLAUDE_CONFIG_DIR = h.claude; process.env.MIS_STATE_HOME = h.state;
  const at = (v) => join(h.claude, 'plugins', 'cache', 'make-it-ship', 'make-it-ship', v);
  mkdirSync(join(h.claude, 'plugins'), { recursive: true });
  writeFileSync(join(h.claude, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'make-it-ship': { source: { source: 'github', repo: 'o/make-it-ship' } } }));
  const settings = (statusLine, extra = {}) => writeFileSync(join(h.claude, 'settings.json'), JSON.stringify({ theme: 'dark', statusLine, ...extra }, null, 2) + '\n');
  const read = () => JSON.parse(readFileSync(join(h.claude, 'settings.json'), 'utf8'));
  const md = (root) => writeFileSync(join(h.claude, 'CLAUDE.md'), `${misBlock(root)}\n\n# My own rules\n`);
  return { h, at, settings, read, md, readMd: () => readFileSync(join(h.claude, 'CLAUDE.md'), 'utf8') };
}

test('setup on a marketplace install also turns on auto-update for its marketplace; other settings stay', () => {
  const { at, settings } = setup();
  settings({ type: 'command', command: statusLineCommand(at('1.0.0')) }, { extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'x/y' } } } });
  const s = planSetup({ root: at('1.0.0') }).changes.find((c) => c.file.endsWith('settings.json'));
  const after = JSON.parse(s.after);
  assert.deepEqual(after.extraKnownMarketplaces, { other: { source: { source: 'github', repo: 'x/y' } }, 'make-it-ship': { source: { source: 'github', repo: 'o/make-it-ship' }, autoUpdate: true } });
  assert.equal(after.theme, 'dark');
  assert.equal(after.statusLine.command, statusLineCommand(at('1.0.0')));
});

test('setup proposes nothing for auto-update once it is on, and never outside a marketplace install', () => {
  const { at, settings } = setup();
  const on = { 'make-it-ship': { source: { source: 'github', repo: 'o/make-it-ship' }, autoUpdate: true } };
  settings({ type: 'command', command: statusLineCommand(at('1.0.0')) }, { extraKnownMarketplaces: on });
  assert.equal(planSetup({ root: at('1.0.0') }).changes.filter((c) => c.file.endsWith('settings.json')).length, 0);
  settings({ type: 'command', command: statusLineCommand('/src/make-it-ship') });
  const s = planSetup({ root: '/src/make-it-ship' }).changes.filter((c) => c.file.endsWith('settings.json'));
  assert.equal(s.length, 0, 'a git checkout has no marketplace to update');
});

test('after an update, session start points the status line and the CLAUDE.md block at the new version, with backups', () => {
  const { h, at, settings, read, md, readMd } = setup();
  settings({ type: 'command', command: statusLineCommand(at('1.0.0')), padding: 0 });
  md(at('1.0.0'));
  const note = followUpgrade(at('1.0.1'));
  assert.match(note, /1\.0\.1/);
  assert.deepEqual(read().statusLine, { type: 'command', command: statusLineCommand(at('1.0.1')), padding: 0 });
  assert.equal(read().theme, 'dark');
  assert.ok(readMd().includes(misBlock(at('1.0.1'))) && readMd().endsWith('# My own rules\n'));
  assert.equal(readdirSync(h.claude).filter((f) => f.includes('.mis-backup-')).length, 2);
  assert.equal(followUpgrade(at('1.0.1')), null, 'nothing left to change');
});

test('session start never moves paths to an older version, a checkout, or another status line', () => {
  const { at, settings, read, md, readMd } = setup();
  settings({ type: 'command', command: statusLineCommand(at('1.0.1')) });
  md(at('1.0.1'));
  assert.equal(followUpgrade(at('1.0.0')), null, 'an older session still running');
  assert.equal(followUpgrade('/src/make-it-ship'), null, 'a git checkout');
  assert.equal(read().statusLine.command, statusLineCommand(at('1.0.1')));
  assert.ok(readMd().includes(misBlock(at('1.0.1'))));
  settings({ type: 'command', command: 'my-own-statusline.sh' });
  followUpgrade(at('1.0.2'));
  assert.equal(read().statusLine.command, 'my-own-statusline.sh', 'not ours: never touched');
});
