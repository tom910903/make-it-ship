import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, normalizeConfig } from '../../scripts/lib/config.mjs';
import { layoutViolations, planLayoutErrors, renderStructure } from '../../scripts/lib/layout.mjs';

const BASE = { version: 1, checks: { unit: { argv: ['npm', 'test'] } } };
const LAYOUT = { paths: ['src/**', 'tests/**', 'docs/**', '.ai/**', '*.md', 'package.json'],
  purposes: { 'src/**': 'application code' }, docs: { human: 'docs', ai: '.ai', languages: ['en', 'ko'] } };

test('config: layout is optional, validated, and kept by normalizeConfig', () => {
  assert.deepEqual(validateConfig(BASE), []);
  assert.equal('layout' in normalizeConfig(BASE), false, 'absent layout = feature off');
  assert.deepEqual(validateConfig({ ...BASE, layout: LAYOUT }), []);
  assert.deepEqual(normalizeConfig({ ...BASE, layout: LAYOUT }).layout, LAYOUT);
  const bad = [
    [{ paths: [] }, /layout.paths must be a non-empty string array/],
    [{ paths: 'src/**' }, /layout.paths/],
    [{ paths: ['src/**'], extra: 1 }, /unknown key: layout.extra/],
    [{ paths: ['src/**'], purposes: { 'lib/**': 'x' } }, /layout.purposes: "lib\/\*\*" is not in layout.paths/],
    [{ paths: ['src/**'], docs: { human: 'docs', languages: ['ko'] } }, /layout.docs.languages must include "en"/],
    [{ paths: ['src/**'], docs: { human: 'docs', languages: ['en', 'Korean'] } }, /layout.docs.languages/],
    [{ paths: ['src/**'], docs: { human: '', ai: '.ai' } }, /layout.docs.human/],
    [{ paths: ['src/**'], docs: { web: 'x' } }, /unknown key: layout.docs.web/],
    ['x', /layout must be an object/],
  ];
  for (const [layout, re] of bad) assert.match(validateConfig({ ...BASE, layout }).join('\n'), re, JSON.stringify(layout));
});

test('layoutViolations: outside paths and missing translations; .ai/ and docs/make-it-ship/ need no pair', () => {
  const v = layoutViolations(['src/a.js', 'lib/b.js', 'README.md', 'docs/guide/x.md', 'docs/guide/y.ko.md', 'docs/guide/z.md', 'docs/guide/z.ko.md',
    '.ai/index.md', 'docs/make-it-ship/plans/p.md', 'docs/notes.txt'], LAYOUT);
  assert.deepEqual(v.outside, ['lib/b.js']);
  assert.deepEqual(v.missingTranslation, [{ file: 'docs/guide/x.md', missing: 'docs/guide/x.ko.md' }, { file: 'docs/guide/y.ko.md', missing: 'docs/guide/y.md' }]);
  // a planned glob must sit inside a layout path; globs are not pair-checked
  assert.deepEqual(layoutViolations(['src/**', 'docs/**', '**/*.ts'], LAYOUT), { outside: ['**/*.ts'], missingTranslation: [] });
  // without docs rules only paths are checked
  assert.deepEqual(layoutViolations(['docs/x.md'], { paths: ['docs/**'] }), { outside: [], missingTranslation: [] });
});

test('planLayoutErrors: every violation with where it is and how to fix it', () => {
  const plan = { goal: 'g', plannedFiles: ['src/**', 'lib/**'], tasks: [{ id: 'T1', title: 't', acceptance: ['a'], files: ['src/a.js', 'docs/guide/x.md'] }] };
  const errs = planLayoutErrors(plan, LAYOUT);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /plannedFiles: lib\/\*\* is outside the layout/);
  assert.match(errs[1], /tasks\[0\]\.files: docs\/guide\/x\.md needs its translation docs\/guide\/x\.ko\.md/);
  assert.deepEqual(planLayoutErrors({ ...plan, plannedFiles: ['src/**'], tasks: [{ ...plan.tasks[0], files: ['src/a.js', 'docs/guide/x.md', 'docs/guide/x.ko.md'] }] }, LAYOUT), []);
  assert.deepEqual(planLayoutErrors(plan, undefined), [], 'no layout: nothing checked');
});

test('planLayoutErrors: "narrow the glob" only for a glob broader than an allowed path; otherwise move or change the layout', () => {
  const hint = (f) => planLayoutErrors({ plannedFiles: [f], tasks: [] }, { ...LAYOUT, paths: ['src/lib/**', 'docs/**'] })[0];
  for (const f of ['src/**', '**']) assert.match(hint(f), /; narrow the glob to an allowed path$/, f);
  for (const f of ['lib/**', 'lib/a.js', '**/*.ts']) {
    assert.match(hint(f), /; move it under an allowed path or change the layout$/, f);
    assert.doesNotMatch(hint(f), /narrow/, f);
  }
});

test('renderStructure: rules, purposes and doc rules, deterministic (the generated part of .ai/structure.md)', () => {
  const md = renderStructure(LAYOUT);
  assert.match(md, /^## Allowed paths/m);
  assert.match(md, /- `src\/\*\*` — application code/);
  assert.match(md, /- `tests\/\*\*`\n/);
  assert.match(md, /docs\/guide\/x\.md.*docs\/guide\/x\.ko\.md/);
  assert.match(md, /`\.ai\/`.*English/);
  assert.match(md, /docs\/make-it-ship\//);
  assert.equal(renderStructure(LAYOUT), md);
});
