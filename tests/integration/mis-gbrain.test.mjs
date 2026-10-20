// M9-D D6: gbrain family with a stub gbrain CLI and a local bare git repo as the artifacts remote (nothing leaves the machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, mis, fakeHome } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
function env({ gbrain = true } = {}) {
  const h = fakeHome();
  if (gbrain) { writeFileSync(join(h.bin, 'gbrain'), '#!/bin/sh\necho "$*" >> "$HOME/gbrain.log"\n[ "$1" = "--version" ] && echo "gbrain 0.18.2"\nexit 0\n'); chmodSync(join(h.bin, 'gbrain'), 0o755); }
  return { ...h, env: { ...h.env, PATH: `${h.bin}:/usr/bin:/bin` } };
}

test('without gbrain every command is BLOCKED with an install hint; detect reports it; uninstall still removes the config', () => {
  const h = env({ gbrain: false }), dir = makeRepo();
  const d = ok(mis(dir, ['gbrain', 'detect'], { env: h.env }));
  assert.equal(d.gbrainOnPath, false); assert.match(d.blocked, /git clone https:\/\/github.com\/garrytan\/gbrain/);
  for (const c of [['init'], ['sync'], ['query', 'x'], ['ingest', '--probe'], ['policy'], ['enqueue', 'README.md'], ['restore', 'x']]) {
    const r = mis(dir, ['gbrain', ...c], { env: h.env });
    assert.equal(r.code, 1, c.join(' ')); assert.match(r.err, /BLOCKED: gbrain CLI is not on PATH[\s\S]*bun install/);
  }
  mkdirSync(h.state, { recursive: true }); writeFileSync(join(h.state, 'gbrain.json'), '{"queue":[]}');
  ok(mis(dir, ['gbrain', 'uninstall'], { env: h.env }));
  assert.equal(existsSync(join(h.state, 'gbrain.json')), false);
});

test('ingest --probe writes nothing; enqueue + sync commit to the brain repo, push to the artifacts remote and import into gbrain', () => {
  const h = env(), dir = makeRepo({ '.make-it-ship/wiki/arch.md': '# Arch\n', 'docs/make-it-ship/r1.md': '# Report\n', 'notes.md': 'n\n' });
  const remote = mkdtempSync(join(tmpdir(), 'mis-brain-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const p = ok(mis(dir, ['gbrain', 'ingest', '--probe'], { env: h.env }));
  assert.deepEqual(p.wouldIngest.sort(), ['.make-it-ship/wiki/arch.md', 'docs/make-it-ship/r1.md']);
  assert.equal(existsSync(join(h.state, 'brain')), false, 'probe wrote nothing');
  assert.equal(existsSync(join(h.home, 'gbrain.log')), false, 'probe did not call gbrain');
  ok(mis(dir, ['gbrain', 'artifacts-init', remote], { env: h.env }));
  ok(mis(dir, ['gbrain', 'enqueue', 'notes.md'], { env: h.env }));
  const s = ok(mis(dir, ['gbrain', 'sync'], { env: h.env }));
  assert.equal(s.copied, 1); assert.equal(s.committed, true); assert.equal(s.pushed, true);
  assert.match(execFileSync('git', ['--git-dir', remote, 'log', '--oneline', 'main'], { encoding: 'utf8' }), /sync 1 file/);
  assert.match(readFileSync(join(h.home, 'gbrain.log'), 'utf8'), new RegExp(`import ${join(h.state, 'brain')}`));
  const i = ok(mis(dir, ['gbrain', 'ingest'], { env: h.env }));
  assert.equal(i.ingested, 2);
  ok(mis(dir, ['gbrain', 'policy', 'set', 'local', 'deny'], { env: h.env }));
  assert.match(mis(dir, ['gbrain', 'sync'], { env: h.env }).err, /deny/);
  assert.equal(ok(mis(dir, ['gbrain', 'detect'], { env: h.env })).version, 'gbrain 0.18.2');
  ok(mis(dir, ['gbrain', 'uninstall', '--purge'], { env: h.env }));
  assert.equal(existsSync(join(h.state, 'gbrain.json')), false); assert.equal(existsSync(join(h.state, 'brain')), false);
});
