import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, mis } from '../helpers.mjs';
import { detectQa } from '../../scripts/lib/qa.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const by = (r) => Object.fromEntries(r.profiles.map((p) => [p.profile, p]));

test('qa detect: web with Playwright → its runner; without one → built-in browser script (BLOCKED only without any browser)', () => {
  const pw = makeRepo({ 'package.json': { devDependencies: { '@playwright/test': '1' }, dependencies: { react: '18' } } });
  const a = by(ok(mis(pw, ['qa', 'detect'])));
  assert.deepEqual(a.web.check, { name: 'qa-web', argv: ['npx', 'playwright', 'test'], timeoutSec: 900 });
  const bare = makeRepo({ 'package.json': { dependencies: { vite: '5' } }, 'index.html': '<html></html>' });
  const b = by(ok(mis(bare, ['qa', 'detect'])));
  if (findChrome()) {
    assert.deepEqual(b.web.check, { name: 'qa-web', argv: ['node', 'qa/web-smoke.mjs'], timeoutSec: 900 });
    assert.equal(b.web.needsScript, 'qa/web-smoke.mjs');
    assert.match(b.web.how, /MIS_CLI/);
    assert.equal(b.web.blocked, undefined);
  } else {
    assert.equal(b.web.check, null);
    assert.match(b.web.blocked, /no browser test runner.*no Chrome/);
  }
  const none = by(ok(mis(bare, ['qa', 'detect'], { env: { MIS_BROWSER: '/nonexistent/chrome' } })));
  assert.equal(none.web.check, null);
  assert.match(none.web.blocked, /no browser test runner.*no Chrome/);
});

test('mis check exposes MIS_CLI so qa scripts can drive mis browse', () => {
  const dir = makeRepo({ '.make-it-ship.json': { version: 1, checks: { probe: { argv: ['node', '-e', 'process.exit(require("fs").existsSync(process.env.MIS_CLI) && /mis\\.mjs$/.test(process.env.MIS_CLI) ? 0 : 3)'] } } } });
  ok(mis(dir, ['start', '--input', 'probe', '--mode', 'quick']));
  assert.equal(ok(mis(dir, ['check', 'probe'])).status, 'PASS');
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

test('qa detect: Android app → connected instrumentation tests via gradlew (emulator; BLOCKED with nothing online)', () => {
  const files = { 'settings.gradle.kts': '', 'gradlew': '#!/bin/sh\n', 'app/build.gradle.kts': 'plugins { id("com.android.application") }\n' };
  const r = by(detectQa(makeRepo(files), { android: { online: true } }));
  assert.equal(r.android.surface, 'Android app (emulator)');
  assert.deepEqual(r.android.check.argv, ['./gradlew', 'connectedDebugAndroidTest']);
  assert.match(r.android.how, /emulator results do not count as device verification/i);
  assert.match(by(detectQa(makeRepo(files), { android: { online: false } })).android.blocked, /no online Android device or emulator.*mis android boot/);
  const { gradlew, ...noWrapper } = files;
  assert.match(by(detectQa(makeRepo(noWrapper), { android: { online: true } })).android.blocked, /gradlew/);
  assert.equal(by(detectQa(makeRepo({ 'build.gradle': 'apply plugin: "java"\n' }))).android, undefined);
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

test('BSP QA profile was removed by user decision: Yocto / Buildroot / kernel trees get no bsp surface', () => {
  for (const files of [{ 'conf/local.conf': '', 'oe-init-build-env': '' }, { 'Config.in': '', 'package/Config.in': '', Makefile: 'BR2_VERSION := 1\n' }, { Kbuild: '', Kconfig: '', 'arch/arm64/Kconfig': '' }]) {
    assert.equal(by(detectQa(makeRepo(files))).bsp, undefined);
  }
});

test('iOS scheme discovery reads project or workspace listings (SwiftPM has no .xcodeproj)', async () => {
  const { schemesFromList } = await import('../../scripts/lib/qa.mjs');
  assert.deepEqual(schemesFromList({ project: { schemes: ['App'] } }), ['App']);
  assert.deepEqual(schemesFromList({ workspace: { schemes: ['Pkg', 'Pkg-Package'] } }), ['Pkg', 'Pkg-Package']);
  assert.deepEqual(schemesFromList(null), []);
  const r = by(detectQa(makeRepo({ 'Package.swift': '// swift-tools-version:5.9\nlet p = Package(name: "Pkg", platforms: [.iOS(.v16)])\n' }), { xcodebuild: true, scheme: 'Pkg', simulator: 'iPhone 16' }));
  assert.deepEqual(r.ios.check.argv, ['xcodebuild', 'test', '-scheme', 'Pkg', '-destination', 'platform=iOS Simulator,name=iPhone 16']);
});
