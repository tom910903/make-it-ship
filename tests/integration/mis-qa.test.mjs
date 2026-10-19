import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, mis } from '../helpers.mjs';
import { detectQa } from '../../scripts/lib/qa.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const by = (r) => Object.fromEntries(r.profiles.map((p) => [p.profile, p]));

test('qa detect: web with Playwright → runnable check; web without a runner → BLOCKED proposal', () => {
  const pw = makeRepo({ 'package.json': { devDependencies: { '@playwright/test': '1' }, dependencies: { react: '18' } } });
  const a = by(ok(mis(pw, ['qa', 'detect'])));
  assert.deepEqual(a.web.check, { name: 'qa-web', argv: ['npx', 'playwright', 'test'], timeoutSec: 900 });
  const bare = makeRepo({ 'package.json': { dependencies: { vite: '5' } }, 'index.html': '<html></html>' });
  const b = by(ok(mis(bare, ['qa', 'detect'])));
  assert.equal(b.web.check, null);
  assert.match(b.web.blocked, /no browser test runner/);
});

test('qa detect: CLI and API surfaces propose scenario scripts the model writes under qa/', () => {
  const cli = by(detectQa(makeRepo({ 'package.json': { bin: { tool: 'bin/tool.js' } } })));
  assert.deepEqual(cli.cli.check.argv, ['node', 'qa/cli-smoke.mjs']);
  assert.equal(cli.cli.needsScript, 'qa/cli-smoke.mjs');
  const api = by(detectQa(makeRepo({ 'package.json': { dependencies: { express: '4' } } })));
  assert.deepEqual(api.api.check.argv, ['node', 'qa/api-smoke.mjs']);
  const py = by(detectQa(makeRepo({ 'pyproject.toml': '[project]\nname="x"\ndependencies=["fastapi"]\n[project.scripts]\nx="x:main"\n' })));
  assert.deepEqual(py.cli.check.argv, ['python3', 'qa/cli_smoke.py']);
  assert.deepEqual(py.api.check.argv, ['python3', 'qa/api_smoke.py']);
});

test('qa detect: iOS project → simulator xcodebuild test check (or BLOCKED without Xcode)', () => {
  const r = by(detectQa(makeRepo({ 'App.xcodeproj/project.pbxproj': '// fake', 'App/ContentView.swift': 'import SwiftUI\n' }), { xcodebuild: false }));
  assert.equal(r.ios.check, null);
  assert.match(r.ios.blocked, /Xcode/);
  const s = by(detectQa(makeRepo({ 'App.xcodeproj/project.pbxproj': '// fake' }), { xcodebuild: true, scheme: 'App', simulator: 'iPhone 16' }));
  assert.deepEqual(s.ios.check.argv, ['xcodebuild', 'test', '-project', 'App.xcodeproj', '-scheme', 'App', '-destination', 'platform=iOS Simulator,name=iPhone 16']);
});

test('qa detect: library without a runtime surface → no profiles', () => {
  assert.deepEqual(detectQa(makeRepo({ 'package.json': { name: 'lib', main: 'index.js' } })).profiles, []);
});

test('standard/full: a detected user-facing surface makes its qa-* check required even if undefined (§14.1)', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['node', '-e', '0'] } } }, 'package.json': { bin: { t: 'bin/t.js' } } });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }] }) }));
  ok(mis(dir, ['mode', 'set', 'quick', '--reason', 'small']));
  assert.deepEqual(Object.keys(ok(mis(dir, ['verdict'])).checks), ['unit'], 'quick: unit only');
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'feature']));
  const v = ok(mis(dir, ['verdict']));
  assert.equal(v.checks['qa-cli'], 'MISSING');
  assert.ok(v.reasons.some((r) => /qa-cli/.test(r)), v.reasons.join());
});

test('BSP: Yocto / Buildroot / kernel trees → build check proposal, target verification BLOCKED (build ≠ hardware)', () => {
  const y = by(detectQa(makeRepo({ 'conf/local.conf': 'MACHINE ?= "qemuarm64"\n', 'meta-demo/conf/layer.conf': 'BBFILE_COLLECTIONS += "demo"\n', 'oe-init-build-env': '#!/bin/sh\n' })));
  assert.equal(y.bsp.kind, 'yocto');
  assert.deepEqual(y.bsp.check.argv, ['bitbake', 'core-image-minimal']);
  assert.equal(y.bsp.check.name, 'build-bsp');
  assert.match(y.bsp.blocked, /target hardware/);
  const br = by(detectQa(makeRepo({ 'Config.in': 'menu "Target"\n', 'package/Config.in': '', Makefile: 'BR2_VERSION := 2024.02\nall:\n' })));
  assert.equal(br.bsp.kind, 'buildroot');
  assert.deepEqual(br.bsp.check.argv, ['make']);
  const k = by(detectQa(makeRepo({ Kbuild: 'obj-y += kernel/\n', Kconfig: 'mainmenu "Linux"\n', 'arch/arm64/Kconfig': '' })));
  assert.equal(k.bsp.kind, 'kernel');
  assert.deepEqual(k.bsp.check.argv, ['make', 'ARCH=arm64', '-j8']);
});

test('BSP in standard mode: qa-bsp (target) is required, so a build-only run cannot be VERIFIED', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { 'build-bsp': { argv: ['node', '-e', '0'] } } }, Kbuild: 'obj-y += x/\n', Kconfig: '', 'arch/arm/Kconfig': '' });
  ok(mis(dir, ['start', '--input', 'x']));
  ok(mis(dir, ['plan', 'set', '-'], { input: JSON.stringify({ goal: 'g', tasks: [{ id: 'T1', title: 't', acceptance: ['a'] }], riskFlags: ['hardware'] }) }));
  ok(mis(dir, ['mode', 'set', 'standard', '--reason', 'hardware risk']));
  ok(mis(dir, ['check', 'build-bsp']));
  const v = ok(mis(dir, ['verdict']));
  assert.equal(v.checks['qa-bsp'], 'MISSING');
  assert.notEqual(v.verdict, 'VERIFIED');
});
