// The browser's GPU report → whether pages get WebGL. Without a GPU (the Linux CI) Chrome reports WebGL as software only
// and still draws it with SwiftShader; that must read as available in software, never as "no WebGL".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webglSupport } from '../../scripts/lib/browse/actions.mjs';

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

test('on the GPU: available, not software', () => {
  const metal = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)';
  assert.deepEqual(webglSupport('enabled', metal), { available: true, status: 'enabled', renderer: metal });
  assert.equal(webglSupport('enabled_readback', null).available, true);
});

test('software only (no GPU): available in software, also when only the renderer says so', () => {
  for (const s of ['unavailable_software', 'disabled_software']) assert.deepEqual(webglSupport(s, SWIFTSHADER), { available: true, software: true, status: s, renderer: SWIFTSHADER });
  assert.deepEqual(webglSupport('disabled_software', null), { available: true, software: true, status: 'disabled_software', renderer: null });
  assert.equal(webglSupport('enabled', SWIFTSHADER).software, true);
  assert.equal(webglSupport('enabled', 'llvmpipe (LLVM 15.0.7, 256 bits)').software, true);
});

test('turned off: not available, whatever the renderer; no report: unknown', () => {
  for (const s of ['disabled_off', 'unavailable_off', 'disabled_off_ok']) assert.deepEqual(webglSupport(s, SWIFTSHADER), { available: false, status: s, renderer: SWIFTSHADER });
  assert.deepEqual(webglSupport(undefined, null), { available: null, status: 'unknown', renderer: null });
});
