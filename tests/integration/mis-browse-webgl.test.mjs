// mis browse webgl against the real Chrome on this machine; without Chrome every case asserts BLOCKED. Where Chrome has no
// WebGL (a machine without a GPU, as on the Linux CI), the command must say so instead of reporting a blank canvas as a
// rendering bug; a second workspace runs Chrome with --disable-gpu so that case is always tested.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserLock, makeRepo, mis } from '../helpers.mjs';
import { findChrome } from '../../scripts/lib/browse/chrome.mjs';

const chrome = findChrome();
const HOME = mkdtempSync(join(tmpdir(), 'mis-webgl-home-'));
const ENV = { MIS_STATE_HOME: HOME, MIS_BROWSE_IDLE_MS: '180000', MIS_BROWSE_HEADLESS_ONLY: '1' };
let dir, page, noGpu;
const b = (...args) => mis(dir, ['browse', ...args], { env: ENV });
const nb = (...args) => mis(noGpu, ['browse', ...args], { env: { ...ENV, MIS_BROWSE_CHROME_ARGS: '--disable-gpu' } });
const ok = (r) => { assert.equal(r.code, 0, `exit ${r.code}\n${r.err}${r.out}`); return r.json; };

// A spinning triangle that stops under prefers-reduced-motion (as a 3D scene should), and a canvas nobody draws on.
const SCENE = `<!doctype html><meta charset="utf-8"><title>scene</title><body style="margin:0;background:#fff">
<canvas id="scene" width="240" height="160"></canvas><canvas id="empty" width="80" height="80"></canvas>
<script>
const c = document.getElementById('scene'), gl = c.getContext('webgl2') || c.getContext('webgl');
if (gl) {
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a; uniform float t; void main(){ float c=cos(t), s=sin(t); gl_Position=vec4(c*a.x-s*a.y, s*a.x+c*a.y, 0, 1); }'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ gl_FragColor=vec4(1.0,0.4,0.1,1); }'));
  gl.linkProgram(p); gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,.8,-.7,-.6,.7,-.6]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = gl.getUniformLocation(p, 't'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (ts) => { gl.clearColor(0.1, 0.1, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(u, still ? 0.3 : ts / 300); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  (function f(ts) { draw(ts); if (!still) requestAnimationFrame(f); })(0);
}
</script>`;

let unlock = () => {};
before(async () => {
  unlock = await browserLock();
  dir = makeRepo();
  page = join(dir, 'scene.html');
  writeFileSync(page, SCENE);
  noGpu = makeRepo(); // its own browser daemon (one per workspace)
});
after(() => {
  try { if (chrome) { b('stop'); nb('stop'); } rmSync(HOME, { recursive: true, force: true }); } finally { unlock(); }
});

test('webgl: renderer, a drawn and animating canvas, a blank canvas, and the frame rate', () => {
  if (!chrome) return assert.match(b('goto', pathToFileURL(page).href).err, /BLOCKED: no Chrome, Chromium or Edge/);
  ok(b('goto', pathToFileURL(page).href));
  const r = ok(b('webgl'));
  assert.equal(r.canvases.length, 2);
  const [scene, empty] = r.canvases;
  assert.deepEqual([scene.selector, scene.width, scene.height, empty.selector], ['#scene', 240, 160, '#empty']);
  assert.equal(empty.blank, true, 'nothing is drawn on #empty');
  assert.equal(r.reducedMotion, false);
  if (!r.webgl.available) return noWebgl(r); // a machine without a GPU (the Linux CI)
  assert.match(r.webgl.status, /^enabled/);
  assert.ok(r.webgl.renderer, JSON.stringify(r.webgl));
  assert.equal(scene.blank, false, 'the triangle is drawn');
  assert.ok(scene.colors >= 2, `colors ${scene.colors}`);
  assert.equal(scene.animating, true, 'the triangle spins');
  assert.ok(r.fps > 0, `fps ${r.fps}`);
});

/** No WebGL in this browser: said plainly (status and a note), and the scene cannot draw. */
function noWebgl(r) {
  assert.equal(r.webgl.available, false);
  assert.ok(r.webgl.status && !/^enabled/.test(r.webgl.status), r.webgl.status);
  assert.match(r.note, /WebGL is not available/);
  assert.equal(r.canvases.find((c) => c.selector === '#scene').blank, true);
}

test('webgl in a browser without a GPU (--disable-gpu): not available, with the reason, and the scene stays blank', () => {
  if (!chrome) return assert.match(nb('goto', pathToFileURL(page).href).err, /BLOCKED: no Chrome, Chromium or Edge/);
  ok(nb('goto', pathToFileURL(page).href));
  noWebgl(ok(nb('webgl')));
});

test('webgl --reduced-motion: the page sees prefers-reduced-motion and its animation stops; the tab is normal afterwards', () => {
  if (!chrome) return assert.match(b('webgl', '--reduced-motion').err, /BLOCKED: no Chrome, Chromium or Edge/);
  ok(b('goto', pathToFileURL(page).href));
  const r = ok(b('webgl', '#scene', '--reduced-motion'));
  assert.equal(r.reducedMotion, true);
  assert.equal(r.canvases.length, 1);
  assert.equal(r.canvases[0].animating, false, 'the scene honours reduced motion');
  if (r.webgl.available) assert.equal(r.canvases[0].blank, false, 'still drawn, only not moving');
  assert.equal(ok(b('webgl', '#scene')).reducedMotion, false, 'emulation is lifted after the check');
});

test('webgl: a selector that matches no canvas and a bad --frames are usage errors', () => {
  if (!chrome) return;
  ok(b('goto', pathToFileURL(page).href));
  assert.match(b('webgl', '#nothing').err, /no canvas matches #nothing/);
  assert.match(b('webgl', '--frames', 'x').err, /--frames/);
});
