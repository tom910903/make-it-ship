// QA profiles (Spec §14 qa): detect runtime surfaces and propose `qa-*` checks. Proposals only; adding a check
// to .make-it-ship.json is a config change the user confirms. Where nothing can run, say BLOCKED instead of faking it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function probeIos(root, project) {
  if (spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' }).status !== 0) return { xcodebuild: false };
  const list = spawnSync('xcodebuild', ['-list', '-json', '-project', project], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const scheme = readJsonText(list.stdout)?.project?.schemes?.[0] ?? null;
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
    profiles.push({ profile: 'web', surface: 'browser UI', check: argv ? { name: 'qa-web', argv, timeoutSec: 900 } : null,
      ...(argv ? {} : { blocked: 'no browser test runner (e.g. Playwright) in the project; qa-web would be BLOCKED until one is added (package install needs approval)' }),
      how: 'Write user-journey tests for the changed screens (load, main action, error and empty states, 375px width) in the project runner.' });
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
  const bsp = detectBsp(root);
  if (bsp) profiles.push({ profile: 'bsp', surface: 'embedded / BSP', kind: bsp.kind, check: bsp.check,
    blocked: 'real target verification needs target hardware (or an agreed emulator): build success ≠ hardware behavior. Define qa-bsp (e.g. flash + on-target test over ssh/serial) or it stays unverified',
    how: 'Keep the build check (build-bsp) and add a target check qa-bsp that runs on the device; without it the report must say the target was not verified.' });
  return { profiles };
}

function detectBsp(root) {
  const has = (p) => existsSync(join(root, p));
  const ls = (d) => { try { return readdirSync(join(root, d)); } catch { return []; } };
  if (has('oe-init-build-env') || has('conf/local.conf') || ls('.').some((d) => d.startsWith('meta-') && has(`${d}/conf/layer.conf`))) {
    return { kind: 'yocto', check: { name: 'build-bsp', argv: ['bitbake', 'core-image-minimal'], timeoutSec: 14400 } };
  }
  if (has('Config.in') && has('package') && has('Makefile') && /BR2_/.test(readFileSync(join(root, 'Makefile'), 'utf8'))) {
    return { kind: 'buildroot', check: { name: 'build-bsp', argv: ['make'], timeoutSec: 14400 } };
  }
  if (has('Kbuild') && has('Kconfig') && ls('arch').length) {
    const arch = ls('arch').sort()[0];
    return { kind: 'kernel', check: { name: 'build-bsp', argv: ['make', `ARCH=${arch}`, '-j8'], timeoutSec: 7200 } };
  }
  return null;
}
