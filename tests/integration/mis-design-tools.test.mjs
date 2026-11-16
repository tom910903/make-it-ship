// mis design search (design knowledge, local) and mis design copy-lint through the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis } from '../helpers.mjs';

const dir = makeRepo();
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('search without a domain gives a first brief; --stack and --domain narrow it; stacks lists them all', () => {
  const b = ok(mis(dir, ['design', 'search', 'meditation', 'wellness', 'app']));
  assert.equal(b.query, 'meditation wellness app');
  assert.deepEqual(Object.keys(b.brief), ['product', 'reasoning', 'style', 'color', 'typography', 'ux']);
  const s = ok(mis(dir, ['design', 'search', 'list', 'performance', '--stack', 'jetpack-compose', '--limit', '2']));
  assert.equal(s.stack, 'jetpack-compose'); assert.ok(s.results.length >= 1 && s.results.length <= 2);
  assert.ok(ok(mis(dir, ['design', 'search', 'dark', 'mode', '--domain', 'style'])).results.length);
  const l = ok(mis(dir, ['design', 'search', 'stacks']));
  assert.ok(l.stacks.includes('threejs') && l.stacks.includes('swiftui') && l.domains.includes('motion'));
});

test('search: unknown stack, both --domain and --stack, a bad --limit are usage errors', () => {
  assert.match(mis(dir, ['design', 'search', 'x', '--stack', 'cobol']).err, /unknown stack "cobol"/);
  assert.match(mis(dir, ['design', 'search', 'x', '--stack', 'vue', '--domain', 'ux']).err, /one of --domain and --stack/);
  assert.match(mis(dir, ['design', 'search', 'x', '--limit', '99']).err, /usage: mis design search/);
});

test('copy-lint: exits 1 with each finding, 0 on clean copy; a missing file is an error', () => {
  writeFileSync(join(dir, 'Strings.swift'), 'let title = "Unlock your potential"\nlet cta = "Book a table"\n');
  writeFileSync(join(dir, 'clean.html'), '<h1>Book a table</h1><p>Open until 22:00</p>');
  const bad = mis(dir, ['design', 'copy-lint', 'Strings.swift', 'clean.html']);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.clean, false);
  assert.deepEqual(bad.json.files.map((f) => [f.file.endsWith('Strings.swift'), f.findings.map((x) => `${x.line}:${x.match}`)]), [[true, ['1:Unlock']]]);
  assert.equal(ok(mis(dir, ['design', 'copy-lint', 'clean.html'])).clean, true);
  assert.match(mis(dir, ['design', 'copy-lint', 'nope.txt']).err, /no such file: nope\.txt/);
});
