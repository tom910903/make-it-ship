// gbrain family with a stub gbrain CLI and a local bare git repo as the artifacts remote (nothing leaves the machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, mis, fakeHome, SYS_PATH } from '../helpers.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
function env({ gbrain = true } = {}) {
  const h = fakeHome();
  if (gbrain) { writeFileSync(join(h.bin, 'gbrain'), '#!/bin/sh\necho "$*" >> "$HOME/gbrain.log"\n[ "$1" = "--version" ] && echo "gbrain 0.18.2"\nexit 0\n'); chmodSync(join(h.bin, 'gbrain'), 0o755); }
  return { ...h, env: { ...h.env, PATH: `${h.bin}:${SYS_PATH}` } };
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

test('trust tiers hold at enqueue, sync and import (artifacts-only pushes docs and artifacts only, full pushes source, deny nothing); detect runs no gbrain doctor', () => {
  const h = env(), dir = makeRepo({ 'src/core.c': 'int secret_source;\n', 'docs/a.md': '# a\n', '.make-it-ship/wiki/w.md': '# w\n' });
  const remote = mkdtempSync(join(tmpdir(), 'mis-brain-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const pushed = () => execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
  ok(mis(dir, ['gbrain', 'artifacts-init', remote], { env: h.env }));
  // default tier: artifacts-only
  assert.equal(ok(mis(dir, ['gbrain', 'policy'], { env: h.env })).thisRepo.trust, 'artifacts-only');
  const refused = mis(dir, ['gbrain', 'enqueue', 'src/core.c'], { env: h.env });
  assert.equal(refused.code, 1); assert.match(refused.err, /src\/core\.c[\s\S]*artifacts-only/);
  ok(mis(dir, ['gbrain', 'enqueue', 'docs/a.md'], { env: h.env }));
  // a queue written before the fix (plain paths) still cannot push source: sync checks every file again
  const cfgFile = join(h.state, 'gbrain.json'), c = JSON.parse(readFileSync(cfgFile, 'utf8'));
  c.queue.push(join(dir, 'src', 'core.c')); writeFileSync(cfgFile, JSON.stringify(c));
  const s = ok(mis(dir, ['gbrain', 'sync'], { env: h.env }));
  assert.equal(s.copied, 1); assert.equal(s.pushed, true);
  assert.deepEqual(s.refused.map((x) => x.file), [join(dir, 'src', 'core.c')]);
  assert.match(pushed(), /a\.md/); assert.doesNotMatch(pushed(), /core\.c/);
  assert.match(mis(dir, ['gbrain', 'import', 'src'], { env: h.env }).err, /artifacts-only/);
  assert.match(mis(dir, ['gbrain', 'import', '.'], { env: h.env }).err, /artifacts-only/);
  ok(mis(dir, ['gbrain', 'import', 'docs'], { env: h.env }));
  // full: source may go
  ok(mis(dir, ['gbrain', 'policy', 'set', 'local', 'full'], { env: h.env }));
  ok(mis(dir, ['gbrain', 'enqueue', 'src/core.c'], { env: h.env }));
  assert.equal(ok(mis(dir, ['gbrain', 'sync'], { env: h.env })).copied, 1);
  assert.match(pushed(), /core\.c/);
  // a file outside any repository is never queued, whatever the tier
  const loose = join(mkdtempSync(join(tmpdir(), 'mis-loose-')), 'id_rsa'); writeFileSync(loose, 'PRIVATE');
  assert.match(mis(dir, ['gbrain', 'enqueue', loose], { env: h.env }).err, /not in a git repository/);
  // deny: nothing is queued or imported
  ok(mis(dir, ['gbrain', 'policy', 'set', 'local', 'deny'], { env: h.env }));
  assert.match(mis(dir, ['gbrain', 'enqueue', 'docs/a.md'], { env: h.env }).err, /deny/);
  assert.match(mis(dir, ['gbrain', 'import', 'docs'], { env: h.env }).err, /deny/);
  // detect is read-only: no gbrain doctor (it may connect to a remote engine)
  const d = ok(mis(dir, ['gbrain', 'detect'], { env: h.env }));
  assert.equal(d.doctorOk, null); assert.match(d.doctor, /gbrain doctor/);
  assert.doesNotMatch(readFileSync(join(h.home, 'gbrain.log'), 'utf8'), /doctor/);
});
