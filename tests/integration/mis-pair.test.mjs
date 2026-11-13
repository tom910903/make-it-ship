// pair-agent — the endpoint needs a token, the tunnel (a stub command here, never ngrok) opens only on start
// and closes on stop, and stop frees the port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, mis, fakeHome } from '../helpers.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('pair-agent --local: token required, browse commands forwarded, stop closes it and frees the port', async () => {
  const h = fakeHome(), dir = makeRepo();
  const s = ok(mis(dir, ['pair-agent', 'start', '--local'], { env: h.env }));
  try {
    assert.equal((await fetch(`${s.url}/health`)).status, 401);
    assert.equal((await fetch(`${s.url}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const auth = { authorization: `Bearer ${s.token}` };
    assert.equal((await fetch(`${s.url}/health`, { headers: auth })).status, 200);
    const st = await fetch(`${s.url}/command`, { method: 'POST', headers: auth, body: JSON.stringify({ cmd: 'status' }) });
    assert.equal(st.status, 200); assert.equal((await st.json()).result.running, false);
    const post = (cmd, args) => fetch(`${s.url}/command`, { method: 'POST', headers: auth, body: JSON.stringify({ cmd, args }) });
    for (const [cmd, args] of [['stop', []], ['goto', ['file:///etc/hosts']], ['goto', ['README.md']], ['newtab', ['data:text/html,x']], ['upload', ['#f', '/etc/hosts']],
      ['eval', ['/tmp/x.js']], ['js', ['1']], ['storage', []], ['load-html', ['/etc/hosts']], ['screenshot', ['/tmp/x.png']], ['snapshot', ['-o', '/tmp/x']], ['chain', []], ['cdp', []]]) {
      const r = await post(cmd, args);
      assert.equal(r.status, 400, `${cmd} ${args.join(' ')}`);
    }
    assert.match(mis(dir, ['pair-agent', 'start', '--local'], { env: h.env }).err, /already paired/);
  } finally {
    const stop = ok(mis(dir, ['pair-agent', 'stop'], { env: h.env }));
    assert.equal(stop.portFree, true);
  }
  await assert.rejects(fetch(`${s.url}/health`));
  assert.equal(ok(mis(dir, ['pair-agent', 'status'], { env: h.env })).running, false);
});

test('pair-agent with a tunnel: public URL from the tunnel output; a tunnel that fails is BLOCKED and nothing stays open', async () => {
  const h = fakeHome(), dir = makeRepo();
  const env = { ...h.env, MIS_PAIR_TUNNEL_CMD: `sh -c 'echo "{\\"msg\\":\\"started tunnel\\",\\"url\\":\\"https://stub-{port}.example\\"}"; sleep 300'` };
  const s = ok(mis(dir, ['pair-agent', 'start'], { env }));
  assert.equal(s.url, `https://stub-${s.port}.example`);
  assert.equal(ok(mis(dir, ['pair-agent', 'status'], { env })).tunnel, true);
  const stop = ok(mis(dir, ['pair-agent', 'stop'], { env }));
  assert.equal(stop.tunnelClosed, true); assert.equal(stop.portFree, true);
  assert.equal(ok(mis(dir, ['pair-agent', 'status'], { env })).running, false);
  const bad = mis(dir, ['pair-agent', 'start'], { env: { ...h.env, MIS_PAIR_TUNNEL_CMD: 'false' } });
  assert.equal(bad.code, 1); assert.match(bad.err, /BLOCKED: the tunnel did not come up/);
  assert.equal(ok(mis(dir, ['pair-agent', 'status'], { env })).running, false, 'endpoint closed when the tunnel failed');
});

test('a paired agent reads only pages it opened itself: back/forward/tab onto local or earlier pages are refused and blanked, tabs and url hide them, old console/network entries are gone', async () => {
  const h = fakeHome(), dir = makeRepo({ 'secret.html': '<title>Local Secret</title><script>console.log("LOCAL-SECRET-LOG")</script><p>LOCAL-SECRET-CONTENT-42</p>' });
  const env = { ...h.env, MIS_BROWSE_HEADLESS_ONLY: '1', MIS_BROWSE_IDLE_MS: '300000' };
  const secretUrl = `file://${join(dir, 'secret.html')}`;
  if (!findChrome()) { assert.match(mis(dir, ['browse', 'goto', secretUrl], { env }).err, /BLOCKED/); return; }
  const site = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/browse-site.mjs', import.meta.url))], { stdio: ['ignore', 'pipe', 'inherit'] });
  const base = `http://127.0.0.1:${String((await once(site.stdout, 'data'))[0]).trim()}`;
  let s;
  try {
    ok(mis(dir, ['browse', 'goto', secretUrl], { env })); // the user's own local page, open before pairing
    s = ok(mis(dir, ['pair-agent', 'start', '--local'], { env }));
    const auth = { authorization: `Bearer ${s.token}` };
    const post = async (cmd, args = []) => {
      let r;
      try { r = await fetch(`${s.url}/command`, { method: 'POST', headers: auth, body: JSON.stringify({ cmd, args }) }); }
      catch (e) { throw new Error(`POST ${cmd} ${JSON.stringify(args)}: ${e.message} (${e.cause?.code ?? e.cause?.message ?? 'no cause'})`); }
      return { status: r.status, body: JSON.stringify(await r.json()) };
    };
    const leaks = (r) => /LOCAL-SECRET|secret\.html|Local Secret/.test(r.body) || r.body.includes(dir);
    const st = await post('status'); assert.equal(st.status, 200); assert.ok(!leaks(st) && !/stateDir|profile/.test(st.body), `status shows no local paths: ${st.body}`);
    const userTab = JSON.parse((await post('tabs')).body).result.find((x) => x.active).id;
    for (const cmd of ['text', 'html', 'url', 'console', 'network', 'snapshot']) {
      const r = await post(cmd); assert.equal(r.status, 400, `${cmd} on a page the agent did not open`); assert.ok(!leaks(r), r.body);
    }
    assert.equal((await post('goto', [`${base}/next`])).status, 200);
    const t = await post('text'); assert.equal(t.status, 200); assert.match(t.body, /Next page/);
    for (const cmd of ['console', 'network']) { const r = await post(cmd); assert.equal(r.status, 200); assert.ok(!leaks(r), `${cmd}: ${r.body}`); }
    const back = await post('back');
    assert.equal(back.status, 400, 'back onto the local page is refused'); assert.ok(!leaks(back), back.body);
    for (const cmd of ['text', 'url', 'html', 'forward']) { const r = await post(cmd); assert.notEqual(r.status, 200, cmd); assert.ok(!leaks(r), `${cmd}: ${r.body}`); }
    const tabs = await post('tabs'); assert.equal(tabs.status, 200); assert.ok(!leaks(tabs), tabs.body); assert.ok(!tabs.body.includes(dir), tabs.body);
    // a tab the user opens locally is not reachable either
    ok(mis(dir, ['browse', 'newtab', secretUrl], { env }));
    const mine = JSON.parse((await post('tabs')).body).result.find((x) => x.active);
    assert.ok(!leaks({ body: JSON.stringify(mine) }));
    assert.equal((await post('tab', [String(mine.id)])).status, 400, 'switching to a tab the agent did not open is refused');
    const other = JSON.parse((await post('tabs')).body).result.find((x) => !x.active);
    assert.equal((await post('tab', [String(other.id)])).status, 400);
    // its own pages keep working
    assert.equal((await post('newtab', [base])).status, 200);
    const home = await post('text'); assert.equal(home.status, 200); assert.match(home.body, /Welcome/);
    // a goto/newtab without a URL must not widen what counts as the agent's own (no "null" origin for file:/about: pages)
    for (const [cmd, args] of [['newtab', []], ['goto', []]]) await post(cmd, args);
    await post('tab', [String(userTab)]);
    for (const cmd of ['back', 'back', 'text', 'html', 'url', 'tabs']) { const r = await post(cmd); assert.ok(!leaks(r), `${cmd}: ${r.body}`); }
  } finally {
    if (s) ok(mis(dir, ['pair-agent', 'stop'], { env }));
    mis(dir, ['browse', 'stop'], { env });
    site.kill();
  }
});
