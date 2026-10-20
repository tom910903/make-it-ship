import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, compareImages, crc32 } from '../../scripts/lib/png.mjs';

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png({ width, height, depth = 8, color, rows, plte, trns, interlace = 0 }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = color; ihdr[12] = interlace;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', plte)] : []), ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// Independent filter encoder (PNG spec 9.2) so the decoder is checked against every filter type.
function filterRow(type, row, prev, bpp) {
  const out = Buffer.alloc(row.length + 1); out[0] = type;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][type];
    out[i + 1] = (row[i] - pred) & 255;
  }
  return out;
}

test('decodes 8-bit RGB rows using all five filter types', () => {
  const w = 5, h = 5, raw = [];
  for (let y = 0; y < h; y++) raw.push(Buffer.from(Array.from({ length: w * 3 }, (_, i) => (y * 53 + i * 31) & 255)));
  const rows = raw.map((r, y) => filterRow(y, r, y ? raw[y - 1] : Buffer.alloc(r.length), 3));
  const img = decodePng(png({ width: w, height: h, color: 2, rows }));
  assert.equal(img.width, 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    assert.deepEqual([...img.data.subarray(o, o + 4)], [raw[y][x * 3], raw[y][x * 3 + 1], raw[y][x * 3 + 2], 255]);
  }
});

test('decodes palette (4-bit + tRNS), 16-bit gray, gray+alpha', () => {
  const pal = decodePng(png({ width: 3, height: 1, depth: 4, color: 3, plte: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]),
    trns: Buffer.from([128]), rows: [Buffer.from([0, 0x01, 0x20])] }));
  assert.deepEqual([...pal.data], [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255]);
  const g16 = decodePng(png({ width: 1, height: 1, depth: 16, color: 0, rows: [Buffer.from([0, 0xab, 0xcd])] }));
  assert.deepEqual([...g16.data], [0xab, 0xab, 0xab, 255]);
  const ga = decodePng(png({ width: 1, height: 1, color: 4, rows: [Buffer.from([0, 9, 7])] }));
  assert.deepEqual([...ga.data], [9, 9, 9, 7]);
});

test('rejects interlaced and non-PNG input with a clear message', () => {
  assert.throws(() => decodePng(Buffer.from('nope')), /not a PNG/);
  assert.throws(() => decodePng(png({ width: 1, height: 1, color: 0, interlace: 1, rows: [Buffer.from([0, 0])] })), /interlaced/);
});

test('encode → decode round trip', () => {
  const data = new Uint8Array(4 * 3 * 2).map((_, i) => (i * 37) & 255);
  const back = decodePng(encodePng({ width: 3, height: 2, data }));
  assert.deepEqual([...back.data], [...data]);
});

const solid = (w, h, rgba) => ({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => rgba[i % 4]) });

test('compare: identical → 100 pass; a changed block lowers the score and is located', () => {
  const a = solid(100, 100, [255, 255, 255, 255]);
  const same = compareImages(a, solid(100, 100, [255, 255, 255, 255]));
  assert.equal(same.score, 100); assert.equal(same.diffPixels, 0);
  const b = solid(100, 100, [255, 255, 255, 255]);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 50; x++) b.data.set([0, 0, 0, 255], (y * 100 + x) * 4);
  const r = compareImages(b, a);
  assert.equal(r.diffPixels, 1000);
  assert.equal(r.score, 0, 'the block is all the content there is, and all of it changed');
  assert.ok(r.hotspots.length > 0 && r.hotspots[0].y === 0, JSON.stringify(r.hotspots[0]));
  assert.equal(r.diff.width, 100);
});

test('compare: small differences within tolerance are ignored; size mismatch counts as different', () => {
  const r = compareImages(solid(10, 10, [100, 100, 100, 255]), solid(10, 10, [108, 100, 100, 255]), { tolerance: 16 });
  assert.equal(r.score, 100);
  const s = compareImages(solid(10, 10, [0, 0, 0, 255]), solid(10, 20, [0, 0, 0, 255]));
  assert.equal(s.diffPixels, 100);
  assert.ok(s.score < 50, `score ${s.score}`);
  assert.equal(s.sizeMatch, false);
});

test('compare: one differing pixel never rounds up to a perfect score', () => {
  const b = solid(100, 100, [0, 0, 0, 255]); b.data.set([255, 255, 255, 255], 0);
  assert.ok(compareImages(b, solid(100, 100, [0, 0, 0, 255])).score < 100);
});

// "Text lines": dark bars on a white page at the given rows.
const page = (rows, w = 400, h = 300) => {
  const img = solid(w, h, [255, 255, 255, 255]);
  for (const y0 of rows) for (let y = y0; y < y0 + 8; y++) for (let x = 20; x < 300; x++) img.data.set([20, 20, 20, 255], (y * w + x) * 4);
  return img;
};

test('M8 D3: clearly different pages on a shared white background fail; the background does not count as matching content', () => {
  const r = compareImages(page([10, 30, 50]), page([150, 170, 190, 210]));
  assert.ok(r.score < 50, `score ${r.score}`);
  assert.equal(compareImages(page([10, 30, 50]), page([10, 30, 50])).score, 100);
  const small = compareImages(page([10, 30, 50, 70, 90, 110, 130, 150, 170, 190]), page([10, 30, 50, 70, 90, 110, 130, 150, 170, 190, 210]));
  assert.ok(small.score >= 50 && small.score < 100, `one added line of ten: ${small.score}`);
});
