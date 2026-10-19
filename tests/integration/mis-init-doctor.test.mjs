import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis } from '../helpers.mjs';
import { validateConfig } from '../../scripts/lib/config.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('init detects npm scripts and proposes a valid config; --write writes it', () => {
  const dir = makeRepo({ 'package.json': { name: 'x', scripts: { test: 'node --test', typecheck: 'tsc --noEmit', lint: 'eslint .' } } });
  const p = ok(mis(dir, ['init']));
  assert.deepEqual(p.config.checks.unit.argv, ['npm', 'test']);
  assert.deepEqual(p.config.checks.typecheck.argv, ['npm', 'run', 'typecheck']);
  assert.deepEqual(p.config.required.quick, ['unit']);
  assert.deepEqual(validateConfig(p.config), []);
  assert.equal(existsSync(join(dir, '.make-it-ship.json')), false, 'proposal only');
  ok(mis(dir, ['init', '--write']));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.make-it-ship.json'), 'utf8')), p.config);
  assert.notEqual(mis(dir, ['init', '--write']).code, 0, 'does not overwrite');
});

test('init detects python unittest, pnpm, Makefile; ignores npm placeholder test script', () => {
  const py = makeRepo({ 'tests/test_a.py': 'import unittest\n', 'app.py': '' });
  assert.deepEqual(ok(mis(py, ['init'])).config.checks.unit.argv, ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v']);
  const pnpm = makeRepo({ 'package.json': { scripts: { test: 'vitest run' } }, 'pnpm-lock.yaml': '' });
  assert.deepEqual(ok(mis(pnpm, ['init'])).config.checks.unit.argv, ['pnpm', 'test']);
  const mk = makeRepo({ Makefile: 'test:\n\techo ok\n' });
  assert.deepEqual(ok(mis(mk, ['init'])).config.checks.unit.argv, ['make', 'test']);
  const placeholder = makeRepo({ 'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } } });
  const r = ok(mis(placeholder, ['init']));
  assert.equal(r.config, null);
  assert.match(r.message, /no test/i);
});

test('doctor: environment checks and duplicate-plugin warning (warning only)', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['true'] } } } });
  const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  mkdirSync(join(home, '.claude', 'skills', 'gstack'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@superpowers-marketplace': true, 'oh-my-claudecode@omc': true, 'ponytail@ponytail': false, 'other@x': true } }));
  const d = ok(mis(dir, ['doctor'], { env: { HOME: home } }));
  const by = Object.fromEntries(d.checks.map((c) => [c.name, c]));
  assert.equal(by.node.status, 'ok');
  assert.equal(by.git.status, 'ok');
  assert.equal(by.config.status, 'ok');
  assert.equal(by.plugins.status, 'warn');
  assert.match(by.plugins.detail, /superpowers/);
  assert.match(by.plugins.detail, /oh-my-claudecode/);
  assert.match(by.plugins.detail, /gstack/);
  assert.doesNotMatch(by.plugins.detail, /ponytail/);
  assert.equal(d.ok, true, 'warnings do not fail doctor');

  const clean = mkdtempSync(join(tmpdir(), 'mis-home-'));
  const bad = makeRepo({ '.make-it-ship.json': '{"version":1,"checks":{},"x":1}' });
  const d2 = ok(mis(bad, ['doctor'], { env: { HOME: clean } }));
  const by2 = Object.fromEntries(d2.checks.map((c) => [c.name, c]));
  assert.equal(by2.plugins.status, 'ok');
  assert.equal(by2.config.status, 'error');
  assert.equal(d2.ok, false);
});
