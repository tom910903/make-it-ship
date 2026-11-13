// QA profiles: detect runtime surfaces and propose `qa-*` checks. Proposals only; adding a check
// to .make-it-ship.json is a config change the user confirms. Where nothing can run, say BLOCKED instead of faking it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from './browse/chrome.mjs';
import { listDevices } from './android.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Schemes from `xcodebuild -list -json`: a .xcodeproj lists under project, a SwiftPM package under workspace. */
export const schemesFromList = (j) => j?.project?.schemes ?? j?.workspace?.schemes ?? [];

function probeIos(root, project) {
  if (spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' }).status !== 0) return { xcodebuild: false };
  const list = spawnSync('xcodebuild', ['-list', '-json', ...(project ? ['-project', project] : [])], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const scheme = schemesFromList(readJsonText(list.stdout))[0] ?? null;
  const sims = readJsonText(spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }).stdout);
  const simulator = Object.values(sims?.devices ?? {}).flat().find((d) => /^iPhone/.test(d.name))?.name ?? null;
  return { xcodebuild: true, scheme, simulator };
}
const readJsonText = (t) => { try { return JSON.parse(t); } catch { return null; } };

/**
 * @param probe optional overrides for the iOS toolchain probe (tests)
 * @returns {{profiles: {profile:string, surface:string, check:object|null, blocked?:string, needsScript?:string, how:string}[]}}
 */
export function detectQa(root, probe) {
  const profiles = [];
  const pkg = readJson(join(root, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const py = existsSync(join(root, 'pyproject.toml')) ? readFileSync(join(root, 'pyproject.toml'), 'utf8') : '';
  const has = (...names) => names.some((n) => n in deps);

  const webApp = has('react', 'vue', 'svelte', 'next', 'vite', '@angular/core', 'solid-js') || existsSync(join(root, 'index.html'));
  if (has('@playwright/test') || has('cypress') || webApp) {
    const argv = has('@playwright/test') ? ['npx', 'playwright', 'test'] : has('cypress') ? ['npx', 'cypress', 'run'] : null;
    const how = 'Write user-journey tests for the changed screens (load, main action, error and empty states, 375px width)';
    if (argv) profiles.push({ profile: 'web', surface: 'browser UI', check: { name: 'qa-web', argv, timeoutSec: 900 }, how: `${how} in the project runner.` });
    else if (findChrome()) {
      // M8: no project runner → the built-in browser (mis browse) drives a scenario script; nothing to install
      profiles.push({ profile: 'web', surface: 'browser UI', check: { name: 'qa-web', argv: ['node', 'qa/web-smoke.mjs'], timeoutSec: 900 }, needsScript: 'qa/web-smoke.mjs',
        how: `${how} as qa/web-smoke.mjs: start the app on a free port, drive it with execFileSync(process.execPath, [process.env.MIS_CLI, 'browse', ...]) (goto, snapshot -i, click/fill @refs, text, console --errors, viewport 375x812), assert on the output, always stop the app and run \`browse stop\`; exit non-zero on any mismatch. \`mis check\` sets MIS_CLI.` });
    } else profiles.push({ profile: 'web', surface: 'browser UI', check: null,
      blocked: 'no browser test runner (e.g. Playwright) in the project and no Chrome/Chromium/Edge for the built-in browser; qa-web stays BLOCKED until one is installed (install needs approval)',
      how: `${how}.` });
  }
  if (pkg?.bin || /\[project\.scripts\]/.test(py)) {
    const node = !!pkg?.bin;
    const script = node ? 'qa/cli-smoke.mjs' : 'qa/cli_smoke.py';
    profiles.push({ profile: 'cli', surface: 'command line', check: { name: 'qa-cli', argv: node ? ['node', script] : ['python3', script], timeoutSec: 300 },
      needsScript: script, how: `Write ${script}: run the real CLI as a subprocess for each user scenario (happy path, bad input, --help) and assert exit code and output; exit non-zero on any mismatch.` });
  }
  if (has('express', 'fastify', 'koa', 'hono', '@nestjs/core') || /fastapi|flask|django/i.test(py)) {
    const node = !!pkg && has('express', 'fastify', 'koa', 'hono', '@nestjs/core');
    const script = node ? 'qa/api-smoke.mjs' : 'qa/api_smoke.py';
    profiles.push({ profile: 'api', surface: 'HTTP API', check: { name: 'qa-api', argv: node ? ['node', script] : ['python3', script], timeoutSec: 300 },
      needsScript: script, how: `Write ${script}: start the server on a free port, call each changed endpoint (success, validation error, auth failure if any), assert status and body, always stop the server; exit non-zero on any mismatch.` });
  }
  const xcodeproj = readdirSync(root).find((f) => f.endsWith('.xcodeproj'));
  const spmIos = existsSync(join(root, 'Package.swift')) && /\.iOS\(/.test(readFileSync(join(root, 'Package.swift'), 'utf8'));
  if (xcodeproj || spmIos) {
    const p = probe?.surfacesOnly ? { xcodebuild: true, scheme: '?', simulator: '?' } : probe ?? probeIos(root, xcodeproj);
    const base = { profile: 'ios', surface: 'iOS app (simulator)', how: 'Build and run the UI/unit tests on an iOS Simulator; on-device checks are not covered (BLOCKED without a device).' };
    if (!p.xcodebuild) profiles.push({ ...base, check: null, blocked: 'Xcode (xcodebuild) not available; iOS QA is BLOCKED' });
    else if (!p.scheme || !p.simulator) profiles.push({ ...base, check: null, blocked: `could not determine ${!p.scheme ? 'a scheme' : 'an available iPhone simulator'}` });
    else {
      const target = xcodeproj ? ['-project', xcodeproj] : [];
      profiles.push({ ...base, check: { name: 'qa-ios', argv: ['xcodebuild', 'test', ...target, '-scheme', p.scheme, '-destination', `platform=iOS Simulator,name=${p.simulator}`], timeoutSec: 1800 } });
    }
  }
  const gradle = ['build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts'].map((f) => join(root, f)).filter(existsSync);
  if (gradle.some((f) => /com\.android\.application/.test(readFileSync(f, 'utf8')))) {
    const p = probe?.surfacesOnly ? { online: true } : probe?.android ?? { online: listDevices().devices.some((d) => d.state === 'device') };
    const base = { profile: 'android', surface: 'Android app (emulator)',
      how: 'Run the instrumentation tests on an emulator (mis android avds, mis android boot <avd>); drive flows with mis android ui/tap/shot. Emulator results do not count as device verification (BLOCKED without a device).' };
    if (!existsSync(join(root, 'gradlew'))) profiles.push({ ...base, check: null, blocked: 'no ./gradlew wrapper in the project; Android QA is BLOCKED' });
    else if (!p.online) profiles.push({ ...base, check: null, blocked: 'no online Android device or emulator: start one with mis android boot <avd> (mis android avds)' });
    else profiles.push({ ...base, check: { name: 'qa-android', argv: ['./gradlew', 'connectedDebugAndroidTest'], timeoutSec: 1800 } });
  }
  return { profiles };
}
