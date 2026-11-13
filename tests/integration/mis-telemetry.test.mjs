// Telemetry is off by default (no event file), on means a local JSONL only, sync goes only to the configured
// endpoint (a local stub here), analytics reads the local file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, mis, fakeHome, ROOT } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const STUB = fileURLToPath(new URL('../fixtures/http-stub.mjs', import.meta.url));
const LOG = join(mkdtempSync(join(tmpdir(), 'mis-stub-')), 'requests.jsonl');
let server, base;
before(async () => {
  server = spawn(process.execPath, [STUB, LOG], { stdio: ['ignore', 'pipe', 'inherit'] });
  base = `http://127.0.0.1:${String((await once(server.stdout, 'data'))[0]).trim()}`;
});
after(() => server.kill());

const skillHook = (h, dir) => {
  const env = { ...process.env, ...h.env }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/hooks.mjs'), 'PostToolUse'], { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'make-it-ship:qa' }, cwd: dir }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
};

test('telemetry is off by default: skill runs and mis telemetry log write no event file', () => {
  const h = fakeHome(), dir = makeRepo();
  assert.equal(ok(mis(dir, ['telemetry', 'status'], { env: h.env })).enabled, false);
  skillHook(h, dir);
  assert.equal(ok(mis(dir, ['telemetry', 'log', '--skill', 'qa'], { env: h.env })).logged, false);
  assert.equal(existsSync(join(h.state, 'telemetry')), false, 'no telemetry directory or events file');
  assert.match(mis(dir, ['telemetry', 'sync'], { env: h.env }).err, /no endpoint/);
});

test('telemetry on records local JSONL; analytics summarizes it; sync posts only new events to the configured endpoint', () => {
  const h = fakeHome(), dir = makeRepo();
  ok(mis(dir, ['telemetry', 'on'], { env: h.env }));
  skillHook(h, dir);
  ok(mis(dir, ['telemetry', 'log', '--skill', 'qa', '--outcome', 'success', '--duration', '40'], { env: h.env }));
  ok(mis(dir, ['telemetry', 'log', '--skill', 'qa', '--outcome', 'error', '--duration', '20'], { env: h.env }));
  const lines = readFileSync(join(h.state, 'telemetry/events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.skill), ['make-it-ship:qa', 'qa', 'qa']);
  const a = ok(mis(dir, ['analytics'], { env: h.env }));
  const qa = a.skills.find((s) => s.skill === 'qa');
  assert.deepEqual(qa, { skill: 'qa', runs: 2, outcomes: { success: 1, error: 1 }, avgSec: 30 });
  assert.match(mis(dir, ['telemetry', 'endpoint', 'ftp://x'], { env: h.env }).err, /usage/);
  ok(mis(dir, ['telemetry', 'endpoint', `${base}/events`], { env: h.env }));
  assert.equal(ok(mis(dir, ['telemetry', 'sync'], { env: h.env })).sent, 3);
  assert.equal(ok(mis(dir, ['telemetry', 'sync'], { env: h.env })).sent, 0, 'cursor advanced');
  const posts = readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.url === '/events');
  assert.equal(posts.length, 1); assert.equal(JSON.parse(posts[0].body).length, 3);
  assert.equal(ok(mis(dir, ['telemetry', 'dashboard', 'security'], { env: h.env })).kind, 'security');
  ok(mis(dir, ['telemetry', 'off'], { env: h.env }));
  assert.equal(ok(mis(dir, ['telemetry', 'log', '--skill', 'x'], { env: h.env })).logged, false);
});
