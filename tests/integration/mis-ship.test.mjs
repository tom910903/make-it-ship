import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, write, mis, git } from '../helpers.mjs';

const CFG = { version: 1, checks: { unit: { argv: ['node', '-e', 'process.exit(require("fs").existsSync("bad") ? 1 : 0)'] } } };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

function verifiedRun({ branch = 'feature/greet' } = {}) {
  const dir = makeRepo({ '.make-it-ship.json': CFG, 'CHANGELOG.md': '# Changelog\n' });
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
  ok(mis(dir, ['start', '--input', 'add greet']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'Add greet()', tasks: [{ id: 'T1', title: 'Add greet() helper', acceptance: ['greet("a") === "hi a"'] }], howToRun: ['node -e "..."'] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  ok(mis(dir, ['task', 'T1', 'start']));
  write(dir, { 'greet.js': 'export const greet = (n) => `hi ${n}`;\n' });
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'Add greet');
  ok(mis(dir, ['task', 'T1', 'done']));
  ok(mis(dir, ['check', 'unit']));
  ok(mis(dir, ['review', 'add', 'quality', '-'], { input: 'BLOCKING: 0\nMAJOR: 0\n' }));
  return dir;
}

test('ship on a VERIFIED run: PR draft, changelog draft, release checklist; nothing is pushed', () => {
  const dir = verifiedRun();
  const r = ok(mis(dir, ['ship']));
  assert.equal(r.ready, true);
  assert.equal(r.verdict, 'VERIFIED');
  const md = readFileSync(join(dir, r.path), 'utf8');
  for (const h of ['## PR 초안', '## CHANGELOG 항목 초안', '## 릴리스 체크리스트']) assert.ok(md.includes(h), h);
  assert.match(md, /Add greet\(\)/);
  assert.match(md, /### Added\n- Add greet\(\) helper/);
  assert.match(md, /- \[x\] 판정 VERIFIED/);
  assert.match(md, /- \[x\] 기본 브랜치가 아님 \(feature\/greet\)/);
  assert.match(md, /- \[ \] CHANGELOG\.md 갱신/);
  assert.match(md, /git push/);
  assert.match(md, /사용자 승인/);
  assert.equal(git(dir, 'status', '--porcelain', '--', '.', ':(exclude)docs/make-it-ship'), '', 'ship writes only into the report dir');
  assert.equal(ok(mis(dir, ['verdict'])).verdict, 'VERIFIED', 'and does not invalidate evidence');
});

test('ship refuses readiness when not VERIFIED and warns on the default branch', () => {
  const dir = verifiedRun({ branch: 'main2' });
  write(dir, { bad: '1' });
  ok(mis(dir, ['check', 'unit']));
  const r = ok(mis(dir, ['ship']));
  assert.equal(r.ready, false);
  assert.equal(r.verdict, 'FAILED');
  const md = readFileSync(join(dir, r.path), 'utf8');
  assert.match(md, /NOT READY/);
  assert.doesNotMatch(md, /배포 준비 완료\b(?! 아님)/);
  const m = verifiedRun({ branch: 'main' });
  assert.match(readFileSync(join(m, ok(mis(m, ['ship'])).path), 'utf8'), /- \[ \] 기본 브랜치가 아님 \(main\)/);
});
