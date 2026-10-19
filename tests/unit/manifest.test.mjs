import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const json = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

test('package.json: ESM, node>=22, zero dependencies', () => {
  const pkg = json('package.json');
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, />=\s*22/);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(pkg.scripts.test.includes('node --test'));
});

test('plugin.json: name make-it-ship with author', () => {
  const p = json('.claude-plugin/plugin.json');
  assert.equal(p.name, 'make-it-ship');
  assert.ok(p.version && p.description && p.author?.name);
});
