// M9-D D7: design image generation against a local stand-in for the OpenAI API (MIS_OPENAI_BASE_URL); no key → BLOCKED.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, fakeHome } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const STUB = fileURLToPath(new URL('../fixtures/http-stub.mjs', import.meta.url));
const LOG = join(mkdtempSync(join(tmpdir(), 'mis-stub-')), 'requests.jsonl');
let server, base;
before(async () => {
  server = spawn(process.execPath, [STUB, LOG], { stdio: ['ignore', 'pipe', 'inherit'] });
  base = `http://127.0.0.1:${String((await once(server.stdout, 'data'))[0]).trim()}`;
});
after(() => server.kill());
const reqs = () => readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.url === '/v1/responses');

test('without an API key every generation is BLOCKED and nothing is sent', () => {
  const h = fakeHome(), dir = makeRepo();
  const env = { ...h.env, OPENAI_API_KEY: '', MIS_OPENAI_BASE_URL: base };
  for (const c of [['generate', 'a login page'], ['variants', 'x'], ['evolve', 'README.md', 'x']]) {
    const r = mis(dir, ['design', ...c], { env });
    assert.equal(r.code, 1); assert.match(r.err, /BLOCKED: no OpenAI API key/);
  }
  assert.equal(existsSync(LOG) ? reqs().length : 0, 0);
});

test('generate, variants, iterate and evolve write PNGs to design/variants/; compare builds a board', () => {
  const h = fakeHome(), dir = makeRepo();
  const env = { ...h.env, OPENAI_API_KEY: 'sk-test', MIS_OPENAI_BASE_URL: base };
  const g = ok(mis(dir, ['design', 'generate', 'a', 'pricing', 'page'], { env }));
  assert.match(g.file, /design\/variants\/a-pricing-page-.*\.png$/);
  assert.equal(readFileSync(g.file).subarray(1, 4).toString(), 'PNG');
  const v = ok(mis(dir, ['design', 'variants', 'dashboard', '--count', '2'], { env }));
  assert.equal(v.variants.length, 2);
  const it = ok(mis(dir, ['design', 'iterate', g.responseId, 'make', 'it', 'darker'], { env }));
  assert.equal(it.parent, g.responseId);
  ok(mis(dir, ['design', 'evolve', g.file, 'more', 'whitespace'], { env }));
  const sent = reqs();
  assert.equal(sent.length, 5);
  assert.equal(sent[0].auth, 'Bearer sk-test');
  assert.equal(JSON.parse(sent[3].body).previous_response_id, g.responseId);
  assert.equal(JSON.parse(sent[4].body).input[0].content[1].type, 'input_image');
  const c = ok(mis(dir, ['design', 'compare'], { env }));
  assert.equal(c.variants, 5);
  assert.match(readFileSync(c.board, 'utf8'), /<img src="a-pricing-page-/);
  assert.equal(ok(mis(dir, ['design', 'gallery'], { env })).variants.length, 5);
});
