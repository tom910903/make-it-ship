// mis frames: two screenshots from any platform (browser, Android, iOS simulator, a desktop window) say whether the
// area is drawn at all and whether it moves; synthetic PNGs here, real screenshots in the platform tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis } from '../helpers.mjs';
import { encodePng } from '../../scripts/lib/png.mjs';

const dir = makeRepo();
/** width x height RGBA filled with bg, plus a square of fg at (x, y) */
function png(name, { w = 40, h = 30, bg = [20, 20, 40], fg = null, x = 0, y = 0, size = 10 } = {}) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const px = i % w, py = Math.floor(i / w), on = fg && px >= x && px < x + size && py >= y && py < y + size;
    const c = on ? fg : bg;
    data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
  }
  const p = join(dir, name);
  writeFileSync(p, encodePng({ width: w, height: h, data }));
  return p;
}
const run = (...a) => mis(dir, ['frames', ...a]);
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

test('a flat screen is blank and still; a drawn square is not blank; a moved square is animating', () => {
  const flat = png('flat.png'), a = png('a.png', { fg: [255, 100, 20], x: 2 }), b = png('b.png', { fg: [255, 100, 20], x: 20 });
  assert.deepEqual(ok(run(flat, flat)), { width: 40, height: 30, colors: 1, blank: true, animating: false });
  assert.deepEqual(ok(run(a, a)), { width: 40, height: 30, colors: 2, blank: false, animating: false });
  assert.equal(ok(run(a, b)).animating, true);
});

test('--clip judges only that area: motion outside it does not count', () => {
  const a = png('c1.png', { fg: [255, 255, 255], x: 0 }), b = png('c2.png', { fg: [255, 255, 255], x: 28 });
  assert.equal(ok(run(a, b)).animating, true);
  const r = ok(run(a, b, '--clip', '12,0,14,30'));
  assert.deepEqual([r.width, r.height, r.blank, r.animating], [14, 30, true, false]);
});

test('usage: two PNGs of the same size, a clip inside them', () => {
  const a = png('u1.png'), big = png('u2.png', { w: 50 });
  assert.match(run(a).err, /usage: mis frames/);
  assert.match(run(a, big).err, /same size/);
  assert.match(run(a, a, '--clip', '30,0,20,10').err, /outside the image/);
  for (const bad of ['a,b,c,d', '1,2,3', '0,0,10.5,10', '0,0,10,10,1']) assert.match(run(a, a, '--clip', bad).err, /--clip x,y,w,h/, bad);
  assert.match(run(a, join(dir, 'missing.png')).err, /missing\.png/);
});
