// M9-D D8: pair-agent — the endpoint needs a token, the tunnel (a stub command here, never ngrok) opens only on start
// and closes on stop, and stop frees the port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, mis, fakeHome } from '../helpers.mjs';

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
