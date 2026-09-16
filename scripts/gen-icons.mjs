// Generates public/icon-192.png and public/icon-512.png (gradient + white check)
// Pure Node, no deps. Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size / 2;
  const rounded = (x, y) => {
    // rounded-rect coverage (radius = 22% of size)
    const rad = size * 0.22;
    const cx = Math.min(Math.max(x, rad), size - rad);
    const cy = Math.min(Math.max(y, rad), size - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad || (x >= rad && x <= size - rad) || (y >= rad && y <= size - rad)
      ? (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad || (x >= rad && x <= size - rad && y >= 0 && y <= size) || (y >= rad && y <= size - rad && x >= 0 && x <= size)
      : false;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = rounded(x, y);
      const t = (x + y) / (2 * size);
      // brand-500 (#6366f1) → violet-600 (#7c3aed)
      const cr = Math.round(0x63 + (0x7c - 0x63) * t);
      const cg = Math.round(0x66 + (0x3a - 0x66) * t);
      const cb = Math.round(0xf1 + (0xed - 0xf1) * t);
      rgba[i] = cr; rgba[i + 1] = cg; rgba[i + 2] = cb; rgba[i + 3] = inside ? 255 : 0;
    }
  }
  // white checkmark: two thick line segments
  const pt = (fx, fy) => [fx * size, fy * size];
  const segs = [pt(0.28, 0.53), pt(0.45, 0.70), pt(0.74, 0.34)];
  const thick = size * 0.075;
  const distToSeg = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const gx = ax + t * dx, gy = ay + t * dy;
    return Math.hypot(px - gx, py - gy);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(distToSeg(x, y, segs[0], segs[1]), distToSeg(x, y, segs[1], segs[2]));
      if (d <= thick) {
        const i = (y * size + x) * 4;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
      }
    }
  }
  return png(size, size, rgba);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', makeIcon(192));
writeFileSync('public/icons/icon-512.png', makeIcon(512));
console.log('icons generated');
