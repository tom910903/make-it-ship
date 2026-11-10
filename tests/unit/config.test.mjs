import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, normalizeConfig, requiredChecks, hashConfigText } from '../../scripts/lib/config.mjs';

const ok = {
  version: 1,
  checks: { unit: { argv: ['npm', 'test'], timeoutSec: 60 }, typecheck: { argv: ['npx', 'tsc'] } },
  required: { quick: ['unit'], standard: ['typecheck', 'unit'] },
  limits: { maxAttemptsPerTask: 2, maxRuntimeMinutes: 120 },
  dependencyManifests: ['package.json'],
};

test('valid config has no errors', () => assert.deepEqual(validateConfig(ok), []));

const bad = [
  ['unknown top-level key', { ...ok, extra: 1 }, /unknown key: extra/],
  ['wrong version', { ...ok, version: 2 }, /version/],
  ['missing checks', { version: 1 }, /checks/],
  ['no checks at all', { version: 1, checks: {} }, /at least one check/],
  ['empty required list', { ...ok, required: { quick: [] } }, /required.quick must list at least one check/],
  ['empty argv', { ...ok, checks: { unit: { argv: [] } } }, /argv/],
  ['non-string argv', { ...ok, checks: { unit: { argv: ['npm', 1] } }, required: {} }, /argv/],
  ['unknown check key', { ...ok, checks: { unit: { argv: ['x'], shell: true } }, required: {} }, /unknown key: checks.unit.shell/],
  ['bad timeout', { ...ok, checks: { unit: { argv: ['x'], timeoutSec: 0 } }, required: {} }, /timeoutSec/],
  ['required names undefined check', { ...ok, required: { quick: ['nope'] } }, /nope/],
  ['unknown required mode', { ...ok, required: { turbo: ['unit'] } }, /unknown key: required.turbo/],
  ['unknown limits key', { ...ok, limits: { tokens: 5 } }, /unknown key: limits.tokens/],
  ['bad threshold', { ...ok, interview: { threshold: 'X' } }, /threshold/],
  ['not an object', [], /object/],
];
for (const [name, cfg, re] of bad) {
  test(`invalid: ${name}`, () => {
    const errs = validateConfig(cfg);
    assert.ok(errs.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(errs)}`);
  });
}

test('normalize fills defaults', () => {
  const n = normalizeConfig({ version: 1, checks: { unit: { argv: ['x'] } } });
  assert.equal(n.checks.unit.timeoutSec, 600);
  assert.deepEqual(n.limits, { maxAttemptsPerTask: 2, maxRuntimeMinutes: 120 });
  assert.equal(n.interview.threshold, 'HIGH');
  assert.ok(n.dependencyManifests.includes('package.json'));
});

test('requiredChecks per mode, default = all checks', () => {
  assert.deepEqual(requiredChecks(normalizeConfig(ok), 'quick'), ['unit']);
  assert.deepEqual(requiredChecks(normalizeConfig(ok), 'full'), ['typecheck', 'unit']);
  const noReq = normalizeConfig({ version: 1, checks: { a: { argv: ['x'] }, b: { argv: ['y'] } } });
  assert.deepEqual(requiredChecks(noReq, 'quick'), ['a', 'b']);
});

test('config hash changes with content, "none" when absent', () => {
  assert.equal(hashConfigText(null), 'none');
  assert.notEqual(hashConfigText('{"a":1}'), hashConfigText('{"a":2}'));
  assert.match(hashConfigText('{}'), /^[0-9a-f]{64}$/);
});

test('standard/full: every defined qa-* check is required (Spec §14.1 qa); quick is unaffected', () => {
  const c = normalizeConfig({ version: 1, checks: { unit: { argv: ['x'] }, 'qa-web': { argv: ['y'] }, 'qa-cli': { argv: ['z'] } },
    required: { quick: ['unit'], standard: ['unit'] } });
  assert.deepEqual(requiredChecks(c, 'quick'), ['unit']);
  assert.deepEqual(requiredChecks(c, 'standard'), ['unit', 'qa-web', 'qa-cli']);
  assert.deepEqual(requiredChecks(c, 'full'), ['unit', 'qa-web', 'qa-cli']);
});

// ISSUE-001 (review 2026-11-10): Full read required.standard only, so a check listed under required.full was never required.
test('full: required.full adds to required.standard (Full never verifies less than Standard); without it Full = Standard', () => {
  const c = normalizeConfig({ version: 1, checks: { unit: { argv: ['x'] }, e2e: { argv: ['y'] }, lint: { argv: ['z'] } },
    required: { quick: ['unit'], standard: ['unit', 'lint'], full: ['e2e'] } });
  assert.deepEqual(requiredChecks(c, 'full'), ['unit', 'lint', 'e2e']);
  assert.deepEqual(requiredChecks(c, 'standard'), ['unit', 'lint']);
  const onlyFull = normalizeConfig({ version: 1, checks: { unit: { argv: ['x'] }, e2e: { argv: ['y'] } }, required: { full: ['e2e'] } });
  assert.deepEqual(requiredChecks(onlyFull, 'full'), ['unit', 'e2e'], 'no standard list: Standard is every check, so Full is too');
  assert.deepEqual(requiredChecks(onlyFull, 'standard'), ['unit', 'e2e'], 'standard without a list: every check');
});
