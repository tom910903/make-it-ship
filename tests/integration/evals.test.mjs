import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, mis } from '../helpers.mjs';

const setup = (demo) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'evals', 'setup-demo.mjs'), demo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

for (const [demo, request, argv] of [
  ['a', 'docs/feature-request.md', ['npm', 'test']],
  ['b', 'ISSUE.md', ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v']],
]) {
  test(`demo ${demo}: fresh committed repo, init detects tests, baseline check passes`, () => {
    const dir = setup(demo);
    assert.ok(existsSync(join(dir, request)));
    assert.equal(git(dir, 'status', '--porcelain'), '', 'clean');
    assert.ok(!existsSync(join(dir, '.make-it-ship.json')), 'init is part of the demo');
    assert.ok(!existsSync(join(dir, 'node_modules')));
    const p = ok(mis(dir, ['init']));
    assert.deepEqual(p.config.checks.unit.argv, argv);
    ok(mis(dir, ['init', '--write']));
    ok(mis(dir, ['start', '--input', request]));
    assert.equal(ok(mis(dir, ['check', 'unit'])).status, 'PASS');
  });
}

test('demo b: the reported bug actually reproduces', () => {
  const dir = setup('b');
  const r = spawnSync('python3', ['-c', 'from inventory import parse_price; print(parse_price("1,234.50"))'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(r.stdout.trim(), '1234.5', `bug should reproduce, got ${r.stdout}${r.stderr}`);
});

test('demo d: fresh repo whose test suite fails at baseline', () => {
  const dir = setup('d');
  assert.ok(existsSync(join(dir, 'TASK.md')));
  ok(mis(dir, ['init', '--write']));
  ok(mis(dir, ['start', '--input', 'TASK.md']));
  const r = ok(mis(dir, ['check', 'unit']));
  assert.equal(r.status, 'FAIL');
  assert.match(r.tail, /rounds the discount half up/);
});

test('demo p: two independent modules plan into one parallel wave', () => {
  const dir = setup('p');
  ok(mis(dir, ['init', '--write']));
  ok(mis(dir, ['start', '--input', 'REQUEST.md']));
  assert.equal(ok(mis(dir, ['check', 'unit'])).status, 'PASS');
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [
    { id: 'T1', title: 'kebab', acceptance: ['a'], files: ['src/text.js', 'test/text.test.js'] },
    { id: 'T2', title: 'mean', acceptance: ['b'], files: ['src/math.js', 'test/math.test.js'] }] }) }));
  assert.deepEqual(ok(mis(dir, ['parallel', 'plan'])).waves, [['T1', 'T2']]);
});

test('demo c: requirements-only project with preset unit + qa-cli checks; qa-cli is BLOCKED/FAIL until built', () => {
  const dir = setup('c');
  assert.ok(existsSync(join(dir, 'REQUIREMENTS.md')));
  ok(mis(dir, ['start', '--input', 'REQUIREMENTS.md']));
  assert.equal(ok(mis(dir, ['check', 'unit'])).status, 'PASS');
  assert.equal(ok(mis(dir, ['check', 'qa-cli'])).status, 'FAIL', 'qa script does not exist yet');
});

test('pilot fixtures: each sets up, and init detects what exists (pilot-6 has no test command)', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const dir = setup(`pilot-${n}`);
    assert.ok(existsSync(join(dir, n === 2 ? 'ISSUE.md' : 'REQUEST.md')), `pilot-${n}`);
    ok(mis(dir, ['init', '--write']));
    ok(mis(dir, ['start', '--input', 'x']));
    assert.equal(ok(mis(dir, ['check', 'unit'])).status, 'PASS', `pilot-${n} baseline`);
  }
  assert.equal(ok(mis(setup('pilot-6'), ['init'])).config, null);
});
