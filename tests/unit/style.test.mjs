import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { styleRules, normalizeStyle, STYLE_LEVELS } from '../../scripts/lib/style.mjs';
import { mis, makeRepo } from '../helpers.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'mis-home-'));

test('style levels: off/lite/full/ultra; aliases normalize, junk is null', () => {
  assert.deepEqual(STYLE_LEVELS, ['off', 'lite', 'full', 'ultra']);
  assert.equal(normalizeStyle('ULTRA'), 'ultra');
  assert.equal(normalizeStyle(' normal '), 'off');
  assert.equal(normalizeStyle('stop'), 'off');
  assert.equal(normalizeStyle('turbo'), null);
});

test('style rules: off is empty; each level keeps the shared rules and only its own level line', () => {
  assert.equal(styleRules('off'), '');
  for (const lvl of ['lite', 'full', 'ultra']) {
    const r = styleRules(lvl);
    assert.match(r, new RegExp(`level: ${lvl}`));
    assert.match(r, /smallest complete change/i);
    assert.match(r, /Never cut/);
    assert.match(r, /shortcut: <the limit>/);
    for (const other of ['lite', 'full', 'ultra'].filter((o) => o !== lvl)) assert.doesNotMatch(r, new RegExp(`^- \\*\\*${other}\\*\\*`, 'm'));
  }
  assert.match(styleRules('ultra'), /push back/i);
  assert.match(styleRules('lite'), /let the user pick/i);
});

test('mis style: shows, sets the session level, and stores the default; bad levels fail', () => {
  const dir = makeRepo(), h = home(), env = { MIS_STATE_HOME: h };
  assert.equal(mis(dir, ['style'], { env }).json.level, 'full', 'default level is full');
  assert.equal(mis(dir, ['style', 'ultra'], { env }).json.level, 'ultra');
  assert.equal(mis(dir, ['style'], { env }).json.level, 'ultra');
  assert.equal(mis(dir, ['style', 'default', 'lite'], { env }).json.default, 'lite');
  assert.equal(mis(dir, ['style', 'turbo'], { env }).code, 1);
  const fresh = home();
  mkdirSync(fresh, { recursive: true });
  writeFileSync(join(fresh, 'config.json'), JSON.stringify({ style: { default: 'lite' } }));
  assert.equal(mis(dir, ['style'], { env: { MIS_STATE_HOME: fresh } }).json.level, 'lite', 'no session level → configured default');
  writeFileSync(join(fresh, 'config.json'), '{not json');
  assert.equal(mis(dir, ['style'], { env: { MIS_STATE_HOME: fresh } }).json.level, 'full', 'broken config falls back to full');
});
