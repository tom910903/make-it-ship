// M8-B visual companion (absorbs Superpowers brainstorming visual companion): localhost mockup server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { get as get_ } from 'node:http';
import { makeRepo, mis } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const dir = makeRepo();
after(() => mis(dir, ['companion', 'stop']));

test('serves an index and pages with the key, auto-reloads on change, records choices, refuses traversal, stops', async () => {
  mkdirSync(join(dir, 'design'));
  writeFileSync(join(dir, 'design', 'layout-a.html'), '<h2>Layout A</h2><div data-choice="a">A</div>');
  const s = ok(mis(dir, ['companion', 'start']));
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/\?key=[0-9a-f]{32}$/);
  assert.equal(ok(mis(dir, ['companion', 'start'])).url, s.url, 'second start reuses the running server');
  const base = s.url.split('/?')[0], key = s.url.split('key=')[1];
  const get = (p, k = key) => fetch(`${base}${p}${k ? `${p.includes('?') ? '&' : '?'}key=${k}` : ''}`);

  assert.equal((await get('/', null)).status, 403, 'no key, no content');
  const index = await (await get('/')).text();
  assert.match(index, /layout-a\.html/);
  const page = await (await get('/layout-a.html')).text();
  assert.match(page, /Layout A/);
  assert.match(page, /EventSource/, 'reload script injected');
  assert.equal((await get('/../.git/config')).status, 404);
  const raw = await new Promise((res) => get_(`${base}/..%2fREADME.md?key=${key}`, (r) => res(r.statusCode)));
  assert.equal(raw, 404, 'encoded ../ cannot escape the served dir (README.md exists one level up)');

  const res = await get('/__events');
  const reader = res.body.getReader();
  setTimeout(() => appendFileSync(join(dir, 'design', 'layout-a.html'), '<p>v2</p>'), 300);
  let text = '';
  while (!text.includes('reload')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();

  const post = await fetch(`${base}/__choice?key=${key}`, { method: 'POST', body: JSON.stringify({ page: 'layout-a.html', choice: 'a', text: 'A' }) });
  assert.equal(post.status, 204);
  const st = ok(mis(dir, ['companion', 'status']));
  assert.equal(st.running, true);
  assert.deepEqual(st.choices.map((c) => c.choice), ['a']);

  assert.equal(ok(mis(dir, ['companion', 'stop'])).stopped, true);
  await assert.rejects(fetch(`${base}/?key=${key}`));
  assert.equal(ok(mis(dir, ['companion', 'status'])).running, false);
});
