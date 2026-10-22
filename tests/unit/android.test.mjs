// Android device support (user decision 2026-10-22): adb output parsing, emulator vs device, and input validation
// (the device shell re-parses `input text`, so shell metacharacters must never reach it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicesFromAdb, deviceProfile, inputArgs, nodesFromUiXml } from '../../scripts/lib/android.mjs';

const ADB = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R5CT1234ABC            device usb:1-1 product:o1sks model:SM_G991N device:o1s transport_id:2
192.168.0.9:5555       unauthorized transport_id:3

`;

test('adb devices -l: serial, state, model; emulator-* serials are emulators', () => {
  assert.deepEqual(devicesFromAdb(ADB), [
    { serial: 'emulator-5554', state: 'device', model: 'sdk_gphone64_arm64', emulator: true },
    { serial: 'R5CT1234ABC', state: 'device', model: 'SM_G991N', emulator: false },
    { serial: '192.168.0.9:5555', state: 'unauthorized', model: null, emulator: false },
  ]);
});

test('only an online physical device counts; emulator results are never device verification', () => {
  const emu = { serial: 'emulator-5554', state: 'device', model: 'x', emulator: true };
  const off = { serial: 'R5', state: 'unauthorized', model: null, emulator: false };
  assert.match(deviceProfile([emu, off]).blocked, /no connected Android device.*BLOCKED.*emulator results do not count/);
  assert.equal(deviceProfile([emu, { ...off, state: 'device' }]).blocked, undefined);
});

test('input args: integers, KEYCODE names, and text limited to a safe set (spaces become %s)', () => {
  assert.deepEqual(inputArgs('tap', { x: 10, y: '20' }), ['tap', '10', '20']);
  assert.deepEqual(inputArgs('swipe', { x1: 1, y1: 2, x2: 3, y2: 4 }), ['swipe', '1', '2', '3', '4', '300']);
  assert.deepEqual(inputArgs('key', { key: 'KEYCODE_BACK' }), ['keyevent', 'KEYCODE_BACK']);
  assert.deepEqual(inputArgs('key', { key: '4' }), ['keyevent', '4']);
  assert.deepEqual(inputArgs('text', { text: 'hello world@x.com' }), ['text', 'hello%sworld@x.com']);
  for (const text of ['a;reboot', '$(reboot)', '`reboot`', 'a|b', 'a&b', "it's", 'a"b', 'a\nb', 'a\\b', 'a>b', '%s'])
    assert.throws(() => inputArgs('text', { text }), /text may only contain/, text);
  for (const bad of [{ x: '1;reboot', y: 2 }, { x: 1.5, y: 2 }, { x: -1, y: 2 }, { y: 2 }])
    assert.throws(() => inputArgs('tap', bad), /must be a non-negative integer/);
  assert.throws(() => inputArgs('key', { key: 'KEYCODE_A;reboot' }), /key must be/);
  assert.throws(() => inputArgs('shell', {}), /unknown input action/);
});

test('uiautomator XML becomes a flat node list with tap centers', () => {
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
<node index="1" text="Network &amp; internet" resource-id="android:id/title" class="android.widget.TextView" content-desc="" clickable="true" bounds="[100,200][300,260]" />
</node></hierarchy>UI hierchary dumped to: /dev/tty`;
  assert.deepEqual(nodesFromUiXml(xml), [
    { text: '', id: '', desc: '', class: 'android.widget.FrameLayout', clickable: false, center: [540, 1200] },
    { text: 'Network & internet', id: 'android:id/title', desc: '', class: 'android.widget.TextView', clickable: true, center: [200, 230] },
  ]);
});
