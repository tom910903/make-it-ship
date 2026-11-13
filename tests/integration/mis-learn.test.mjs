import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const no = (r, re) => { assert.notEqual(r.code, 0); assert.match(r.err, re); };
const L = (o) => JSON.stringify({ type: 'pitfall', key: 'ts-test-glob', insight: 'node --test needs a quoted glob for .ts files', confidence: 8, source: 'observed', ...o });

test('learn: validated, append-only, latest wins per key, stale when referenced files vanish', () => {
  const dir = makeRepo({ 'src/a.js': 'x' });
  no(mis(dir, ['learn', 'add', '-'], { input: L({ type: 'gossip' }) }), /type/);
  no(mis(dir, ['learn', 'add', '-'], { input: L({ confidence: 11 }) }), /confidence/);
  no(mis(dir, ['learn', 'add', '-'], { input: L({ key: 'Bad Key' }) }), /key/);
  no(mis(dir, ['learn', 'add', '-'], { input: L({ extra: 1 }) }), /unknown key/);
  ok(mis(dir, ['learn', 'add', '-'], { input: L({ files: ['src/a.js'] }) }));
  ok(mis(dir, ['learn', 'add', '-'], { input: L({ insight: 'quote the glob: node --test "test/**/*.test.ts"', files: ['src/a.js'] }) }));
  ok(mis(dir, ['learn', 'add', '-'], { input: L({ type: 'preference', key: 'no-deps', insight: 'user wants zero dependencies', source: 'user-stated' }) }));
  let list = ok(mis(dir, ['learn', 'list'])).entries;
  assert.equal(list.length, 2);
  assert.match(list.find((e) => e.key === 'ts-test-glob').insight, /quote the glob/);
  const raw = readFileSync(join(dir, 'docs/make-it-ship/learnings.jsonl'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 3, 'append-only');
  rmSync(join(dir, 'src/a.js'));
  list = ok(mis(dir, ['learn', 'list'])).entries;
  assert.equal(list.find((e) => e.key === 'ts-test-glob').stale, true);
  const md = readFileSync(join(dir, 'docs/make-it-ship/learnings.md'), 'utf8');
  assert.match(md, /## Pitfall/);
  assert.match(md, /\*\*ts-test-glob\*\*: quote the glob/);
  assert.match(md, /## Preference/);
});

test('learn list refreshes learnings.md so STALE shows without a new add', () => {
  const dir = makeRepo({ 'src/b.js': 'x' });
  ok(mis(dir, ['learn', 'add', '-'], { input: L({ key: 'b-file', files: ['src/b.js'] }) }));
  rmSync(join(dir, 'src/b.js'));
  ok(mis(dir, ['learn', 'list']));
  assert.match(readFileSync(join(dir, 'docs/make-it-ship/learnings.md'), 'utf8'), /b-file.*STALE/);
});
