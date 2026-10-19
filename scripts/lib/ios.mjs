// iOS device support (Spec §14 ios, M5): debug-bridge leftovers scan and connected-device detection.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Files outside the template that still reference the debug bridge. */
export function bridgeScan(root) {
  const r = spawnSync('git', ['grep', '--no-index', '--exclude-standard', '-lE', 'import DebugBridge|DebugBridge\\.start|DebugBridgeManager',
    '--', '.', ':(exclude)templates/ios-debug-bridge', ':(exclude)docs/make-it-ship'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

export function devicesFromDevicectl(json) {
  return (json?.result?.devices ?? [])
    .filter((d) => d.hardwareProperties?.platform === 'iOS')
    .map((d) => ({ id: d.identifier, name: d.deviceProperties?.name ?? d.identifier, connected: d.connectionProperties?.tunnelState === 'connected' }));
}

export function deviceProfile(devices) {
  const connected = devices.filter((d) => d.connected);
  return connected.length ? { devices }
    : { devices, blocked: 'no connected iOS device: on-device QA is BLOCKED (simulator results do not count as device verification)' };
}

export function listDevices() {
  const dir = mkdtempSync(join(tmpdir(), 'mis-devicectl-'));
  try {
    const out = join(dir, 'devices.json');
    const r = spawnSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) return { devices: [], blocked: 'xcrun devicectl is unavailable (Xcode 15+ required): on-device QA is BLOCKED' };
    return deviceProfile(devicesFromDevicectl(JSON.parse(readFileSync(out, 'utf8'))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
