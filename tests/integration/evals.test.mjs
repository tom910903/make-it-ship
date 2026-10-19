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
