import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF, DATA, DOMAINS, bm25, brief, parseCsv, search, stacks } from '../../scripts/lib/design-knowledge.mjs';

test('parseCsv: quoted commas, newlines and doubled quotes, a BOM and CRLF', () => {
  const rows = parseCsv('﻿Name,Note\r\n"a, b","line 1\nline 2"\r\nc,"say ""hi"""\r\n');
  assert.deepEqual(rows, [{ Name: 'a, b', Note: 'line 1\nline 2' }, { Name: 'c', Note: 'say "hi"' }]);
});

test('bm25: more matching terms rank first; a query sharing no term finds nothing', () => {
  const docs = ['dark dashboard for banking', 'banking', 'garden furniture'];
  assert.deepEqual(bm25(docs, 'banking dashboard').map(([i]) => i), [0, 1]);
  assert.deepEqual(bm25(docs, 'meditation'), []);
});

test('the vendored data: MIT license, every domain file parses with the columns it searches and shows', () => {
  assert.match(readFileSync(join(DATA, '..', 'LICENSE'), 'utf8'), /MIT License/);
  for (const [d, cfg] of Object.entries(DOMAINS)) {
    const rows = parseCsv(readFileSync(join(DATA, cfg.file), 'utf8'));
    assert.ok(rows.length > 5, d);
    for (const c of [...cfg.search, ...cfg.show]) assert.ok(c in rows[0], `${d}: column ${c}`);
  }
  for (const s of stacks()) assert.ok('Guideline' in parseCsv(readFileSync(join(DATA, 'stacks', `${s}.csv`), 'utf8'))[0], s);
});

test('stacks cover web, mobile, desktop and three.js', () => {
  for (const s of ['react', 'html-tailwind', 'swiftui', 'jetpack-compose', 'flutter', 'react-native', 'winui', 'wpf', 'avalonia', 'threejs']) assert.ok(stacks().includes(s), s);
});

test('search: a product type finds its own row; a stack finds its rules; unknown names and an empty query are errors', () => {
  assert.match(search('fintech banking dashboard', { domain: 'product', limit: 1 })[0]['Product Type'], /fintech|financ|bank/i);
  const nav = search('navigation', { stack: 'swiftui', limit: 3 });
  assert.ok(nav.length && nav.every((r) => r.Category && r.Guideline), JSON.stringify(nav));
  assert.equal(search('navigation', { stack: 'swiftui', limit: 1, full: true }).length, 1);
  assert.throws(() => search('x', { stack: 'cobol' }), /unknown stack "cobol"; stacks: .*swiftui/);
  assert.throws(() => search('x', { domain: 'nope' }), /unknown domain "nope"/);
  assert.throws(() => search('  ', { domain: 'product' }), /usage: mis design search/);
});

test('brief: one list per brief domain, best first', () => {
  const b = brief('fintech banking dashboard');
  assert.deepEqual(Object.keys(b), BRIEF);
  assert.ok(b.product.length && b.color.length && b.typography.length);
  assert.ok(b.color[0].Primary.startsWith('#'), JSON.stringify(b.color[0]));
  assert.ok(existsSync(join(DATA, 'stacks', 'threejs.csv')));
});
