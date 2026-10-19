import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWaves, overlaps } from '../../scripts/lib/parallel.mjs';

const t = (id, files, dependsOn, status = 'TODO') => ({ id, files, dependsOn, status });

test('ownership overlap', () => {
  assert.ok(overlaps(['src/a.js'], ['src/a.js']));
  assert.ok(overlaps(['src/**'], ['src/a/b.js']));
  assert.ok(overlaps(['src/*.js'], ['src/**']));
  assert.ok(!overlaps(['src/a/**'], ['src/b/**']));
  assert.ok(!overlaps(['src/a.js'], ['test/a.test.js']));
  assert.ok(overlaps(['**/*.md'], ['docs/x.md']));
});

test('independent tasks share a wave; shared files and dependencies split waves', () => {
  const r = planWaves([
    t('T1', ['src/a/**', 'test/a.test.js']),
    t('T2', ['src/b/**', 'test/b.test.js']),
    t('T3', ['src/a/x.js']),              // overlaps T1
    t('T4', ['src/c.js'], ['T2']),        // depends on T2
    t('T5', undefined),                    // no ownership → runs alone
  ]);
  assert.deepEqual(r.waves, [['T1', 'T2'], ['T3', 'T4'], ['T5']]);
  assert.match(r.notes.join(' '), /T5.*no files/);
});

test('done tasks are skipped and satisfy dependencies; cycles and unknown deps are errors', () => {
  assert.deepEqual(planWaves([t('T1', ['a'], [], 'DONE'), t('T2', ['b'], ['T1'])]).waves, [['T2']]);
  assert.throws(() => planWaves([t('T1', ['a'], ['T2']), t('T2', ['b'], ['T1'])]), /cycle/);
  assert.throws(() => planWaves([t('T1', ['a'], ['T9'])]), /unknown task T9/);
});
