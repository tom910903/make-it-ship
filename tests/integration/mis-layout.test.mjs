import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis, git } from '../helpers.mjs';

const LAYOUT = { paths: ['src/**', 'tests/**', 'docs/**', '.ai/**', '*.md', '.make-it-ship.json'],
  purposes: { 'src/**': 'application code' }, docs: { human: 'docs', ai: '.ai', languages: ['en', 'ko'] } };
const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', 'process.exit(0)'] } }, layout: LAYOUT };
const PLAN = { goal: 'Add greet', tasks: [{ id: 'T1', title: 'greet', acceptance: ['greet works'], files: ['src/greet.js', 'tests/greet.test.js'] }], plannedFiles: ['src/**', 'tests/**'] };
const BAD = { ...PLAN, plannedFiles: ['src/**', 'lib/**'], tasks: [{ ...PLAN.tasks[0], files: ['src/greet.js', 'docs/guide/greet.md'] }] };
const DOC = (files) => `# Plan: greet\n## Goal\nAdd greet\n## Tasks\n### T1: greet\nFiles: ${files}\n- greet works\n## Acceptance criteria\n- greet works\n## Verification\n- \`npm test\`\n`;

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('plan set: with a layout, a plan outside it is refused with every violation and the fix; a conforming plan is stored', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'README.md': '# x\n' });
  write(dir, { 'bad.json': BAD, 'good.json': PLAN });
  ok(mis(dir, ['start', '--input', 'greet']));
  const r = mis(dir, ['plan', 'set', 'bad.json']);
  assert.equal(r.code, 1);
  assert.match(r.err, /plan does not follow the project layout/);
  assert.match(r.err, /plannedFiles: lib\/\*\* is outside the layout \(allowed: src\/\*\*/);
  assert.match(r.err, /tasks\[0\]\.files: docs\/guide\/greet\.md needs its translation docs\/guide\/greet\.ko\.md/);
  assert.match(r.err, /change the plan .* or change "layout" in \.make-it-ship\.json — a config change the user must approve/);
  assert.equal(ok(mis(dir, ['status', '--json'])).state.plan, null, 'nothing stored');
  ok(mis(dir, ['plan', 'set', 'good.json']));
});

test('plan set: without a layout nothing is checked (feature off)', () => {
  const dir = makeRepo({ '.make-it-ship.json': { ...CFG, layout: undefined } });
  write(dir, { 'bad.json': BAD });
  ok(mis(dir, ['start', '--input', 'greet']));
  ok(mis(dir, ['plan', 'set', 'bad.json']));
});

test('start --plan and plan check apply the layout too; a refused start leaves no run', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG });
  write(dir, { 'docs/make-it-ship/plans/bad.md': DOC('lib/greet.js'), 'docs/make-it-ship/plans/good.md': DOC('src/greet.js, docs/guide/g.md, docs/guide/g.ko.md') });
  const r = mis(dir, ['start', '--plan', 'docs/make-it-ship/plans/bad.md']);
  assert.equal(r.code, 1);
  assert.match(r.err, /tasks\[0\]\.files: lib\/greet\.js is outside the layout/);
  assert.notEqual(mis(dir, ['status', '--json']).json?.state?.state, 'PLANNING', 'no run was created');
  const c = mis(dir, ['plan', 'check', 'docs/make-it-ship/plans/bad.md']);
  assert.equal(c.code, 1);
  assert.match(c.json.errors.join('\n'), /lib\/greet\.js is outside the layout/);
  assert.equal(ok(mis(dir, ['plan', 'check', 'docs/make-it-ship/plans/good.md'])).ok, true);
  ok(mis(dir, ['start', '--plan', 'docs/make-it-ship/plans/good.md']));
});

test('init proposes a layout from the tracked top-level structure plus .ai/ and docs/, written only with --write', () => {
  const dir = makeRepo({ 'package.json': { scripts: { test: 'node --test' } }, 'src/a.js': '', 'lib/deep/b.js': '', 'README.md': '# x\n', '.github/ci.yml': '' });
  write(dir, { 'scratch/untracked.js': '' });
  const p = ok(mis(dir, ['init']));
  assert.deepEqual(p.config.layout, {
    paths: ['.github/**', 'README.md', 'lib/**', 'package.json', 'src/**', '.ai/**', 'docs/**', '.make-it-ship.json', '.make-it-ship/**', 'CLAUDE.md', 'AGENTS.md'],
    docs: { human: 'docs', ai: '.ai', languages: ['en', 'ko'] } });
  assert.equal(existsSync(join(dir, '.make-it-ship.json')), false, 'proposal only');
  ok(mis(dir, ['init', '--write']));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.make-it-ship.json'), 'utf8')).layout, p.config.layout);
});

test('mis layout: rules and working-tree violations (tracked + untracked, .gitignore respected); exit 0; off without a layout', () => {
  const off = makeRepo({ '.make-it-ship.json': { ...CFG, layout: undefined } });
  assert.equal(ok(mis(off, ['layout', '--json'])).layout, null);
  assert.match(mis(off, ['layout']).out, /no "layout" in \.make-it-ship\.json/);
  const dir = makeRepo({ '.make-it-ship.json': CFG, '.gitignore': 'build/\n', 'src/a.js': '', 'lib/b.js': '', 'docs/guide/x.md': '# x\n', 'docs/guide/y.md': '', 'docs/guide/y.ko.md': '' });
  write(dir, { 'tmp/new.js': '', 'build/out.js': '', 'docs/make-it-ship/report.md': '' });
  const j = ok(mis(dir, ['layout', '--json']));
  assert.deepEqual(j.layout, LAYOUT);
  assert.deepEqual(j.outside, ['.gitignore', 'lib/b.js', 'tmp/new.js']);
  assert.deepEqual(j.missingTranslation, [{ file: 'docs/guide/x.md', missing: 'docs/guide/x.ko.md' }]);
  const t = mis(dir, ['layout']);
  assert.equal(t.code, 0);
  assert.match(t.out, /- `src\/\*\*` — application code/);
  assert.match(t.out, /Outside the layout \(3\):\n- \.gitignore\n- lib\/b\.js\n- tmp\/new\.js/);
  assert.match(t.out, /docs\/guide\/x\.md → docs\/guide\/x\.ko\.md/);
});

test('mis layout write: .ai/ skeletons only if missing, generated part of structure.md, AGENTS.md rules section, CLAUDE.md @AGENTS.md; idempotent', () => {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'CLAUDE.md': '# Project\n\nKeep this.\n', '.ai/index.md': '# mine\n', '.ai/structure.md': '# Structure\n\nMy notes.\n' });
  const w = ok(mis(dir, ['layout', 'write']));
  assert.deepEqual(w.written.sort(), ['.ai/conventions.md', '.ai/decisions.md', '.ai/product.md', '.ai/structure.md', '.ai/tech.md', 'AGENTS.md', 'CLAUDE.md']);
  assert.equal(readFileSync(join(dir, '.ai/index.md'), 'utf8'), '# mine\n', 'existing files are never overwritten');
  const structure = readFileSync(join(dir, '.ai/structure.md'), 'utf8');
  assert.match(structure, /^# Structure\n\nMy notes\.\n\n<!-- MIS:STRUCTURE:START -->\n[\s\S]*- `src\/\*\*` — application code[\s\S]*<!-- MIS:STRUCTURE:END -->\n$/);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Project\n\nKeep this.\n\n<!-- MIS:LAYOUT:START -->\n@AGENTS.md\n<!-- MIS:LAYOUT:END -->\n');
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^<!-- MIS:LAYOUT:START -->\n## Project rules for AI agents\n[\s\S]*<!-- MIS:LAYOUT:END -->\n$/);
  for (const re of [/`src\/\*\*`/, /`\.ai\/`, English only/, /`docs\/guide\/x\.md` \+ `docs\/guide\/x\.ko\.md`/, /`mis layout`/, /`\.ai\/tech\.md`/, /`\.ai\/structure\.md`/, /`\.ai\/modules\/<dir path>\.md`/]) assert.match(agents, re);
  const lines = agents.split('\n').length;
  assert.ok(lines >= 10 && lines <= 34, `AGENTS.md section is short (${lines} lines)`);
  for (const f of ['CLAUDE.md', 'AGENTS.md']) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /@\.ai\//, `${f} never imports .ai/ files`);
  const names = ['CLAUDE.md', 'AGENTS.md', '.ai/structure.md', '.ai/tech.md'];
  const before = names.map((f) => readFileSync(join(dir, f), 'utf8'));
  assert.deepEqual(ok(mis(dir, ['layout', 'write'])).written, []);
  assert.deepEqual(names.map((f) => readFileSync(join(dir, f), 'utf8')), before, 'same bytes');
  // a config change regenerates only the marked parts; text around them stays
  write(dir, { 'CLAUDE.md': `${before[0]}\n## After\nstay\n`, '.ai/tech.md': '# Tech\nmine\n', '.make-it-ship.json': { ...CFG, layout: { ...LAYOUT, paths: [...LAYOUT.paths, 'bin/**'] } } });
  assert.deepEqual(ok(mis(dir, ['layout', 'write'])).written.sort(), ['.ai/structure.md', 'AGENTS.md']);
  assert.match(readFileSync(join(dir, '.ai/structure.md'), 'utf8'), /^# Structure\n\nMy notes\.\n[\s\S]*`bin\/\*\*`/);
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /`bin\/\*\*`/);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), `${before[0]}\n## After\nstay\n`);
  assert.equal(readFileSync(join(dir, '.ai/tech.md'), 'utf8'), '# Tech\nmine\n');
  const fresh = makeRepo({ '.make-it-ship.json': CFG });
  assert.deepEqual(ok(mis(fresh, ['layout', 'write'])).written.sort(), ['.ai/conventions.md', '.ai/decisions.md', '.ai/index.md', '.ai/product.md', '.ai/structure.md', '.ai/tech.md', 'AGENTS.md', 'CLAUDE.md']);
  assert.match(readFileSync(join(fresh, '.ai/structure.md'), 'utf8'), /^# Structure\n\n<!-- MIS:STRUCTURE:START -->/);
  assert.equal(readFileSync(join(fresh, 'CLAUDE.md'), 'utf8'), '<!-- MIS:LAYOUT:START -->\n@AGENTS.md\n<!-- MIS:LAYOUT:END -->\n', 'created with just the section');
  assert.match(readFileSync(join(fresh, '.ai/index.md'), 'utf8'), /^# AI index[\s\S]*product\.md[\s\S]*decisions\.md/);
  assert.notEqual(mis(makeRepo(), ['layout', 'write']).code, 0, 'no layout: nothing to write');
});

test('end to end: init --write, layout write, then the working tree has no layout violations', () => {
  const dir = makeRepo({ 'package.json': { scripts: { test: 'node --test' } }, 'src/a.js': '', 'README.md': '# x\n' });
  ok(mis(dir, ['init', '--write']));
  ok(mis(dir, ['layout', 'write']));
  const j = ok(mis(dir, ['layout', '--json']));
  assert.deepEqual([j.outside, j.missingTranslation], [[], []]);
  assert.ok(existsSync(join(dir, '.ai', 'structure.md')));
  assert.match(git(dir, 'status', '--porcelain', '-uall'), /\?\? \.ai\/index\.md/);
});
