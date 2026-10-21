// Minimal PNG codec (node:zlib only) and pixel comparison for `mis visual-verdict` (absorbs OMC visual-verdict).
import { inflateSync, deflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @returns {{width:number, height:number, data:Uint8Array}} RGBA, 8 bits per channel */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
  let pos = 8, hdr = null, plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') hdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!hdr) throw new Error('PNG without IHDR');
  // shortcut: Adam7 interlacing is not decoded; browser screenshots are never interlaced. Add the 7-pass walk if needed.
  if (hdr.interlace) throw new Error('interlaced PNG is not supported (re-save it without interlacing)');
  const { width: w, height: h, depth, color } = hdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`unsupported PNG color type ${color}`);
  const bits = channels * depth, bpp = Math.max(1, bits >> 3), stride = Math.ceil((w * bits) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0, b = y ? px[up + i] : 0, c = y && i >= bpp ? px[up + i - bpp] : 0;
      let pred = 0;
      if (ft === 1) pred = a; else if (ft === 2) pred = b; else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (ft !== 0) throw new Error(`bad PNG filter ${ft}`);
      px[row + i] = (raw[src + i] + pred) & 255;
    }
  }
  const max = (1 << depth) - 1;
  const sample = (row, idx) => { // idx-th sample of the row, scaled to 8 bits
    if (depth === 8) return px[row + idx];
    if (depth === 16) return px[row + idx * 2];
    const bit = idx * depth, v = (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
    return color === 3 ? v : Math.round((v * 255) / max);
  };
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, r = y * stride, s = x * channels;
    if (color === 3) {
      const i = sample(r, x);
      out.set([plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], trns && i < trns.length ? trns[i] : 255], o);
    } else if (color === 0 || color === 4) {
      const g = sample(r, s);
      out.set([g, g, g, color === 4 ? sample(r, s + 1) : 255], o);
    } else out.set([sample(r, s), sample(r, s + 1), sample(r, s + 2), color === 6 ? sample(r, s + 3) : 255], o);
  }
  return { width: w, height: h, data: out };
}

export function encodePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), d]), crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Pixel diff over the union of both canvases (area only one image covers counts as different).
 * A pixel differs when any channel, composited over white, differs by more than `tolerance` (0-255).
 * The score is the share of *content* that matches: pixels that are background (the most common color of both images)
 * in both are left out, so a large shared white page cannot make two different pages look alike. The denominator is at
 * least 100 px, so a few stray pixels cost a point each, not the whole score (a percentage of the canvas would be too
 * lenient: text pages are often under 1% content). The page may also be moved by up
 * to `maxShift` px as a whole (each px of shift costs a point, reported as `shift`): a layout nudged by 2px scores high,
 * while different text in the same layout still differs (whole-image shifts cannot line up different glyphs).
 * @returns {{score:number, diffPixels:number, contentPixels:number, totalPixels:number, sizeMatch:boolean, hotspots:object[], diff:object, shift?:{dx:number, dy:number}}}
 */
export function compareImages(a, b, { tolerance = 16, grid = 8, maxShift = 3 } = {}) {
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height), total = W * H;
  const flat = (img) => { // RGB composited over white
    const o = new Uint8Array(img.width * img.height * 3);
    for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) for (let k = 0; k < 3; k++) o[j + k] = 255 - ((255 - img.data[i + k]) * img.data[i + 3]) / 255;
    return o;
  };
  const fa = flat(a), fb = flat(b);
  const counts = new Map();
  for (const f of [fa, fb]) for (let o = 0; o < f.length; o += 3) {
    const key = ((f[o] >> 3) << 10) | ((f[o + 1] >> 3) << 5) | (f[o + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bgKey = 0, best = -1;
  for (const [k, c] of counts) if (c > best) { best = c; bgKey = k; }
  const bg = [((bgKey >> 10) << 3) + 4, (((bgKey >> 5) & 31) << 3) + 4, ((bgKey & 31) << 3) + 4], bgTol = Math.max(tolerance, 4);
  const isBg = (f, o) => Math.abs(f[o] - bg[0]) <= bgTol && Math.abs(f[o + 1] - bg[1]) <= bgTol && Math.abs(f[o + 2] - bg[2]) <= bgTol;
  const floor = 100;
  // sizes within 2*maxShift (a full-page shot a few px taller after a margin change): edge pixels fill the missing strip
  // instead of it counting as different; larger size differences count the area only one image covers as different
  const sizeMatch = a.width === b.width && a.height === b.height;
  const loose = !sizeMatch && Math.abs(a.width - b.width) <= 2 * maxShift && Math.abs(a.height - b.height) <= 2 * maxShift;
  const clamp = (v, n) => Math.min(n - 1, Math.max(0, v));
  // one pass with b moved by (dx, dy); b's own edge pixels fill in what the move uncovers
  const pass = (dx, dy, mark) => {
    let n = 0, shared = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inA = loose || (x < a.width && y < a.height), inB = loose || (x < b.width + Math.max(0, dx) && y < b.height + Math.max(0, dy));
      const oa = (clamp(y, a.height) * a.width + clamp(x, a.width)) * 3;
      const ob = (Math.min(b.height - 1, Math.max(0, y - dy)) * b.width + Math.min(b.width - 1, Math.max(0, x - dx))) * 3;
      let differs = !inA || !inB;
      if (!differs) differs = Math.abs(fa[oa] - fb[ob]) > tolerance || Math.abs(fa[oa + 1] - fb[ob + 1]) > tolerance || Math.abs(fa[oa + 2] - fb[ob + 2]) > tolerance;
      if (!differs && isBg(fa, oa) && isBg(fb, ob)) shared++;
      if (differs) n++;
      if (mark) mark(x, y, differs, ob);
    }
    const content = total - shared, d = Math.max(content, floor);
    let score = Math.max(0, (content ? Math.floor(((d - n) * 100) / d) : 100) - Math.abs(dx) - Math.abs(dy));
    if ((n || !sizeMatch) && score === 100) score = 99;
    return { n, content, score, dx, dy };
  };
  let pick = pass(0, 0);
  if (pick.n && maxShift && (sizeMatch || loose)) {
    // candidate shift from row/column profiles of content pixels (cheap), then full passes for at most three candidates
    const profile = (f, img, rows) => {
      const p = new Float64Array(rows ? H : W);
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (!isBg(f, (y * img.width + x) * 3)) p[rows ? y : x]++;
      return p;
    };
    const bestOffset = (pa, pb) => {
      let off = 0, low = Infinity;
      for (let d = -maxShift; d <= maxShift; d++) {
        let cost = 0;
        for (let i = 0; i < pa.length; i++) cost += Math.abs(pa[i] - (pb[i - d] ?? pb[i < d ? 0 : pb.length - 1]));
        if (cost < low || (cost === low && Math.abs(d) < Math.abs(off))) { low = cost; off = d; }
      }
      return off;
    };
    const dy = bestOffset(profile(fa, a, true), profile(fb, b, true)), dx = bestOffset(profile(fa, a, false), profile(fb, b, false));
    for (const [x, y] of [[dx, dy], [0, dy], [dx, 0]]) {
      if (!x && !y) continue;
      const r = pass(x, y);
      if (r.score > pick.score) pick = r;
    }
  }
  const diff = { width: W, height: H, data: new Uint8Array(total * 4) };
  const cw = Math.ceil(W / grid), ch = Math.ceil(H / grid), cells = new Array(grid * grid).fill(0);
  pass(pick.dx, pick.dy, (x, y, differs, ob) => {
    const o = (y * W + x) * 4;
    if (differs) { cells[Math.floor(y / ch) * grid + Math.floor(x / cw)]++; diff.data.set([255, 0, 0, 255], o); }
    else { const g = 200 + Math.round((0.3 * fb[ob] + 0.59 * fb[ob + 1] + 0.11 * fb[ob + 2]) * 55 / 255); diff.data.set([g, g, g, 255], o); }
  });
  const hotspots = cells.map((c, i) => {
    const x = (i % grid) * cw, y = Math.floor(i / grid) * ch, w = Math.min(cw, W - x), h = Math.min(ch, H - y);
    return { x, y, width: w, height: h, diffPixels: c, percent: Math.round((c * 1000) / Math.max(1, w * h)) / 10 };
  }).filter((c) => c.diffPixels > 0).sort((p, q) => q.diffPixels - p.diffPixels).slice(0, 5);
  return { score: pick.score, diffPixels: pick.n, contentPixels: pick.content, totalPixels: total, sizeMatch,
    hotspots, diff, ...(pick.dx || pick.dy ? { shift: { dx: -pick.dx || 0, dy: -pick.dy || 0 } } : {}) }; // shift: where the second image's content sits
}
